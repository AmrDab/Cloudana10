/**
 * Encrypted workstation volumes (docs/WORKSTATIONS.md §11.3, docs/TRUST_TIERS.md §6 "Disk"): LUKS2 on a file.
 *
 * A volume is `<dir>/cld-<id>.img`, a sparse file of the volume's size, formatted LUKS2 (aes-xts-plain64, 512-bit) with
 * the deployment's key as its passphrase, opened as /dev/mapper/cld-<id> (cryptsetup attaches a loop device itself),
 * holding one ext4 filesystem mounted at `<dir>/mnt/cld-<id>`. The container gets `<mount>/data` as a bind mount.
 * Docker never sees a plain volume, and the provider's disk only ever holds ciphertext.
 *
 * The key: 32 random bytes (64 hex chars) per deployment and node, made by the API, sealed to this node's key with
 * volumeKeyAad(id) (shared/sealed.ts) and carried on the start instruction. The agent opens it, hands it to cryptsetup
 * on stdin (never argv, never a file) and keeps no copy; while the volume is open the kernel holds the LUKS master key,
 * as dm-crypt must. Because the passphrase is already a random 256-bit key, LUKS's PBKDF is set to its cheapest
 * (pbkdf2, 1000 iterations) — key stretching would protect nothing and costs a second and up to 1 GB of RAM per open.
 *
 * Wipe (purge, or keepDays over): unmount, close, `cryptsetup erase` (destroys every keyslot, so the master key and with
 * it the data are gone even if the file's blocks survive on an SSD), then delete the file.
 *
 * Needs root (losetup, dm-crypt, mount — the agent already needs root for iptables) and cryptsetup + e2fsprogs. When the
 * agent runs in a container, `<dir>` must be bind-mounted at the same path with rshared propagation so the host's
 * Docker daemon sees the mounts (node-agent/README.md "Encrypted volumes").
 *
 * Every command is an argv array through an injectable exec (selftests pass a fake), nothing through a shell.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, renameSync, rmSync, rmdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

/** Announced when the boot self-check passed (CLOUDANA_ENCRYPTED_VOLUMES=1 and a real format/open/mount round trip). */
export const ENCRYPTED_VOLUMES_CAPABILITY = "encrypted-volumes";
/** Where backing files and mount points live unless CLOUDANA_VOLUME_DIR says otherwise. */
export const DEFAULT_VOLUME_DIR = "/var/lib/cloudana/volumes";
/** Owner of the fresh filesystem's `data` directory: the usual uid of workstation images (the machine image re-owns it to root). */
export const VOLUME_OWNER = "1000:1000";

export type ExecIn = (cmd: string, args: string[], opts?: { input?: string; timeoutMs?: number }) => Promise<string>;

export const realExecIn: ExecIn = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: opts.timeoutMs ?? 60_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim().split("\n").pop() || `${cmd} failed`));
      else resolve(stdout.toString().trim());
    });
    child.stdin?.end(opts.input ?? "");
  });

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[0-9a-f]{64}$/;
/** No "," (it would split a --mount field), no spaces, absolute. */
const DIR = /^\/[A-Za-z0-9._/-]+$/;

/** A fresh volume key: 32 random bytes as 64 lowercase hex chars (the API makes the real ones; the self-check its own). */
export const newVolumeKey = () => randomBytes(32).toString("hex");
export const isVolumeKey = (k: unknown): k is string => typeof k === "string" && KEY.test(k);

/** cryptsetup argv. The key is always read from stdin (`--key-file -`). */
export const luksFormatArgs = (file: string) => [
  "luksFormat", "--type", "luks2", "--batch-mode", "--cipher", "aes-xts-plain64", "--key-size", "512",
  "--pbkdf", "pbkdf2", "--pbkdf-force-iterations", "1000", "--key-file", "-", file,
];
export const luksOpenArgs = (file: string, name: string) => ["open", "--type", "luks2", "--key-file", "-", file, name];
export const luksCloseArgs = (name: string) => ["close", name];
export const luksEraseArgs = (file: string) => ["erase", "--batch-mode", file];
export const mkfsArgs = (dev: string) => ["-q", "-m", "0", dev];
export const mountArgs = (dev: string, dir: string) => ["-o", "nosuid,nodev", dev, dir];

const ignorable = (err: unknown, re: RegExp) => re.test((err as Error).message ?? "");

export class EncryptedVolumes {
  constructor(
    readonly dir: string,
    private exec: ExecIn = realExecIn,
    private log: (msg: string) => void = () => {},
  ) {
    if (!DIR.test(dir) || dir.split("/").includes("..")) throw new Error(`invalid volume directory ${JSON.stringify(dir)}`);
  }

  paths(id: string) {
    if (!ID.test(id)) throw new Error("invalid deployment id");
    const name = `cld-${id}`;
    const mnt = path.posix.join(this.dir, "mnt", name);
    return {
      img: path.posix.join(this.dir, `${name}.img`),
      tmp: path.posix.join(this.dir, `${name}.img.new`),
      mnt,
      data: path.posix.join(mnt, "data"),
      mapper: name,
      dev: `/dev/mapper/${name}`,
    };
  }

  /** The directory a workstation's container gets as its volume (exists only while the volume is open). */
  dataDir(id: string): string {
    return this.paths(id).data;
  }

  /** Whether this node holds an encrypted volume for `id` (open or closed). */
  has(id: string): boolean {
    const p = this.paths(id);
    return existsSync(p.img) || existsSync(p.mnt);
  }

  /**
   * Open the volume (creating it on first use: format, filesystem, then an atomic rename, so an interrupted create
   * never leaves a half-made volume under the real name) and mount it. Returns the directory to bind into the
   * container. A wrong key fails in `cryptsetup open` and nothing is mounted. The container must already be gone.
   */
  async prepare(id: string, sizeMb: number, key: string): Promise<string> {
    if (!isVolumeKey(key)) throw new Error("volume key must be 64 hex characters");
    if (!Number.isInteger(sizeMb) || sizeMb < 32 || sizeMb > 1024 * 1024) throw new Error("invalid volume size");
    const p = this.paths(id);
    await this.close(id); // a stale mount or mapping from a run that ended badly
    if (!existsSync(p.img)) {
      mkdirSync(this.dir, { recursive: true });
      rmSync(p.tmp, { force: true });
      const fd = openSync(p.tmp, "w", 0o600);
      try {
        ftruncateSync(fd, sizeMb * 1024 * 1024); // sparse: the provider's disk fills as the tenant writes
      } finally {
        closeSync(fd);
      }
      try {
        await this.exec("cryptsetup", luksFormatArgs(p.tmp), { input: key, timeoutMs: 120_000 });
        await this.exec("cryptsetup", luksOpenArgs(p.tmp, p.mapper), { input: key });
        try {
          await this.exec("mkfs.ext4", mkfsArgs(p.dev), { timeoutMs: 600_000 });
        } finally {
          await this.exec("cryptsetup", luksCloseArgs(p.mapper)).catch(() => undefined);
        }
      } catch (err) {
        rmSync(p.tmp, { force: true });
        throw new Error(`could not create the encrypted volume: ${(err as Error).message}`);
      }
      renameSync(p.tmp, p.img);
      this.log(`volume cld-${id}: encrypted volume created (${sizeMb} MiB, LUKS2)`);
    }
    try {
      await this.exec("cryptsetup", luksOpenArgs(p.img, p.mapper), { input: key });
    } catch (err) {
      throw new Error(`could not open the encrypted volume (wrong key?): ${(err as Error).message}`);
    }
    try {
      mkdirSync(p.mnt, { recursive: true });
      await this.exec("mount", mountArgs(p.dev, p.mnt));
      // Made after the mount, inside the encrypted filesystem: unmounted, <mnt>/data does not exist, so a container
      // Docker restarts on its own (after a reboot) fails to start instead of writing to the provider's plain disk.
      if (!existsSync(p.data)) {
        mkdirSync(p.data);
        await this.exec("chown", [VOLUME_OWNER, p.data]);
      }
    } catch (err) {
      await this.close(id);
      throw new Error(`could not mount the encrypted volume: ${(err as Error).message}`);
    }
    return p.data;
  }

  /** Unmount and close (the kernel forgets the key). Best-effort; true when nothing of it is left open. */
  async close(id: string): Promise<boolean> {
    const p = this.paths(id);
    if (!this.has(id)) return true; // never an encrypted volume on this node
    let ok = true;
    try {
      await this.exec("umount", [p.mnt]);
    } catch (err) {
      if (!ignorable(err, /not mounted|no mount point|mountpoint not found|no such file/i)) {
        ok = false;
        this.log(`volume cld-${id}: umount failed: ${(err as Error).message}`);
      }
    }
    try {
      await this.exec("cryptsetup", luksCloseArgs(p.mapper));
    } catch (err) {
      if (!ignorable(err, /doesn't exist|does not exist|not active|no such/i)) {
        ok = false;
        this.log(`volume cld-${id}: cryptsetup close failed: ${(err as Error).message}`);
      }
    }
    return ok;
  }

  /** Destroy the volume: close, erase every keyslot, delete the file. true when the file is gone. */
  async wipe(id: string): Promise<boolean> {
    const p = this.paths(id);
    if (!this.has(id) && !existsSync(p.tmp)) return true;
    await this.close(id);
    if (existsSync(p.img)) {
      try {
        await this.exec("cryptsetup", luksEraseArgs(p.img));
      } catch (err) {
        this.log(`volume cld-${id}: cryptsetup erase failed (deleting the file anyway): ${(err as Error).message}`);
      }
      rmSync(p.img, { force: true });
    }
    rmSync(p.tmp, { force: true });
    try {
      rmdirSync(p.mnt); // only when empty: a mount that would not let go keeps its directory
    } catch {}
    const gone = !existsSync(p.img);
    if (gone) this.log(`volume cld-${id}: encrypted volume erased and deleted`);
    return gone;
  }
}

/**
 * Boot self-check, run only when the operator set CLOUDANA_ENCRYPTED_VOLUMES=1 and containers are on: root, then a real
 * round trip on a 64 MiB scratch volume (create, mount, write, close, reopen with the same key, read, wipe). Passing
 * means this node can do everything a machine's volume needs, so it may announce `encrypted-volumes`.
 */
export async function encryptedVolumesSelfCheck(vol: EncryptedVolumes, isRoot: boolean): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isRoot) return { ok: false, reason: "the agent is not root (cryptsetup, loop devices and mount need it)" };
  const id = "selfcheck";
  const key = newVolumeKey();
  try {
    await vol.wipe(id);
    const data = await vol.prepare(id, 64, key);
    writeFileSync(path.join(data, "probe"), "cloudana");
    if (!(await vol.close(id))) throw new Error("the scratch volume did not close");
    const again = await vol.prepare(id, 64, key);
    if (readFileSync(path.join(again, "probe"), "utf8") !== "cloudana") throw new Error("data did not survive a close and reopen");
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  } finally {
    await vol.wipe(id).catch(() => undefined);
  }
}
