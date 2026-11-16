// Encrypted volumes + machines selftest: cryptsetup/mount argv and order against a fake exec, key handling (stdin only,
// sealed per deployment), the manager's start/stop/purge of an encrypted machine volume, and the machine run flags.
// Needs neither root, cryptsetup nor Docker.
import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { open, publicKeyOf, seal, sealedEnvAad, volumeKeyAad } from "../../shared/sealed.ts";
import type { DockerOps } from "./container.ts";
import { DeploymentManager, NODE_CANNOT_SERVE, type StatusBody } from "./deployments.ts";
import {
  EncryptedVolumes,
  encryptedVolumesSelfCheck,
  luksFormatArgs,
  newVolumeKey,
  type ExecIn,
} from "./volumes.ts";
import { MACHINE_CAPS, workTypes, workstationRunArgs, type WorkstationSpec } from "./workstation.ts";

let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ volumes selftest failed: ${msg}`);
    process.exit(1);
  }
  passed++;
}
async function rejects(p: Promise<unknown>, re: RegExp, msg: string) {
  try {
    await p;
  } catch (err) {
    return check(re.test((err as Error).message), `${msg} (got "${(err as Error).message}")`);
  }
  check(false, `${msg} (did not throw)`);
}
function throws(fn: () => unknown, re: RegExp, msg: string) {
  try {
    fn();
  } catch (err) {
    return check(re.test((err as Error).message), `${msg} (got "${(err as Error).message}")`);
  }
  check(false, `${msg} (did not throw)`);
}

/** A POSIX-style absolute temp dir (on Windows: the drive-relative form Node resolves on the current drive). */
function tempDir(prefix: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  return process.platform === "win32" ? d.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/") : d;
}

/** cryptsetup / mount / umount / mkfs / chown as a state machine: a LUKS file opens only with the key it was formatted with. */
function fakeExec() {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const luks = new Map<string, string>(); // backing file (without .new) → key
  const active = new Set<string>(); // mapper names
  const mounted = new Set<string>();
  const state = { failOn: null as RegExp | null };
  const base = (f: string) => f.replace(/\.new$/, "");
  const exec: ExecIn = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, input: opts.input });
    const line = `${cmd} ${args.join(" ")}`;
    if (state.failOn?.test(line)) throw new Error(`fake failure: ${line}`);
    if (cmd === "cryptsetup") {
      const op = args[0];
      if (op === "luksFormat") luks.set(base(args.at(-1)!), opts.input!);
      if (op === "open") {
        if (luks.get(base(args.at(-2)!)) !== opts.input) throw new Error("No key available with this passphrase.");
        active.add(args.at(-1)!);
      }
      if (op === "close" && !active.delete(args[1])) throw new Error(`Device ${args[1]} is not active.`);
      if (op === "erase") luks.delete(base(args.at(-1)!));
    }
    // The filesystem's content (the data directory) is moved aside on umount and back on mount, as a real mount hides it.
    const stash = (mnt: string) => `${mnt}.fake-fs`;
    if (cmd === "mount") {
      const mnt = args.at(-1)!;
      mounted.add(mnt);
      if (existsSync(stash(mnt))) renameSync(stash(mnt), path.join(mnt, "data"));
    }
    if (cmd === "umount") {
      if (!mounted.delete(args[0])) throw new Error(`umount: ${args[0]}: not mounted.`);
      if (existsSync(path.join(args[0], "data"))) renameSync(path.join(args[0], "data"), stash(args[0]));
    }
    if (cmd === "cryptsetup" && args[0] === "erase") rmSync(stash(base(args.at(-1)!).replace(/\/cld-([^/]+)\.img$/, "/mnt/cld-$1")), { recursive: true, force: true });
    return "";
  };
  return { exec, calls, luks, active, mounted, state };
}

const PRIV = "0x" + "11".repeat(32);
const PUB = publicKeyOf(PRIV);
const SSH = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0 me@laptop";
const MACHINE = "ghcr.io/amrdab/cloudana-machine:1.0.0";
const machineSpec: WorkstationSpec = {
  image: MACHINE,
  ports: [{ container: 22 }],
  cpu: 1000,
  memMb: 2048,
  storageMb: 10240,
  tier: "on-demand",
  maxHours: 4,
  gpu: { count: 0 },
  access: { ssh: { publicKey: SSH } },
  volume: { sizeGb: 10, keepDays: 3, encrypted: true },
  workdir: "/root",
  sshPort: 22,
};

/**
 * client/api/src/lib/sealed.ts sealV2(pub(0x11…11), "ab"×32, volumeKeyAad("golden"), eph 0x22…22, nonce 0x33…33):
 * the API seals volume keys with its own copy of the v2 format; client/api/tests/machines.test.ts makes this same string.
 */
const GOLDEN_SEALED_BY_API =
  "AgRGbX/K5WPlywmg0YcLtYA0SARheHmhSUnPIihfG64/J2coF2w8ZDH47tpFONw3yGXieE86nnfQRPM+QHeX4SeKMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMznwGn6DISiLMaVRE1uA14dwv8bpJsZDxmVK0/keSlIu2V6TGt4/q9ElUEfolH9HN3H4fjStNtCQ/tyEv9LTqrhdz2g3NUusVRg4wAWr4Isck=";

async function main() {
  // ── The API's sealed volume key opens here ────────────────────────────────────────────────────────────
  check(open(PRIV, GOLDEN_SEALED_BY_API, volumeKeyAad("golden")) === "ab".repeat(32), "a volume key sealed by the API opens with shared/sealed.ts");
  throws(() => open(PRIV, GOLDEN_SEALED_BY_API, sealedEnvAad("golden")), /./, "the API's volume key does not open as env");

  // ── argv ───────────────────────────────────────────────────────────────────────────────────────────
  const fmt = luksFormatArgs("/v/cld-x.img");
  check(fmt.join(" ").includes("--key-file -") && fmt.includes("luks2") && fmt.includes("pbkdf2") && fmt.at(-1) === "/v/cld-x.img", "luksFormat: LUKS2, key from stdin, cheap PBKDF (the key is random)");
  check(workTypes(true, [], false, true, true).includes("encrypted-volumes") && !workTypes(false, [], false, true, true).includes("encrypted-volumes") && !workTypes(true, [], false, true).includes("encrypted-volumes"), "encrypted-volumes only with containers and the self-check");
  throws(() => new EncryptedVolumes("relative/dir"), /invalid volume directory/, "volume dir must be absolute");
  throws(() => new EncryptedVolumes("/a,b"), /invalid volume directory/, "no comma in the volume dir (it would split --mount)");

  // ── EncryptedVolumes against the fake ─────────────────────────────────────────────────────────────────
  const dir = tempDir("cld-vol-selftest-");
  const f = fakeExec();
  const logs: string[] = [];
  const vol = new EncryptedVolumes(dir, f.exec, (m) => logs.push(m));
  const key = newVolumeKey();
  check(/^[0-9a-f]{64}$/.test(key) && key !== newVolumeKey(), "fresh 256-bit hex keys");
  const p = vol.paths("m1");
  try {
    await rejects(vol.prepare("m1", 1024, "short"), /64 hex/, "bad key refused");
    await rejects(vol.prepare("../x", 1024, key), /invalid deployment id/, "bad id refused");
    await rejects(vol.prepare("m1", 8, key), /invalid volume size/, "tiny volume refused");
    check(f.calls.length === 0, "nothing ran for refused inputs");

    const data = await vol.prepare("m1", 1024, key);
    const ops = f.calls.map((c) => `${c.cmd} ${c.args[0]}`);
    check(
      ops.join("|") === "cryptsetup luksFormat|cryptsetup open|mkfs.ext4 -q|cryptsetup close|cryptsetup open|mount -o|chown 1000:1000",
      `first prepare: format, open, mkfs, close, open, mount, chown (got ${ops.join("|")})`,
    );
    check(f.calls[0].args.at(-1) === p.tmp && f.calls[4].args.at(-2) === p.img, "formatted under the temporary name, opened under the real one");
    check(f.calls.filter((c) => c.input === key).length === 3, "the key went to cryptsetup on stdin, three times (format, open, open)");
    check(f.calls.every((c) => !c.args.join(" ").includes(key)), "the key never appears in any argv");
    check(!logs.join("\n").includes(key), "the key never reaches the log");
    check(data === p.data && existsSync(p.img) && !existsSync(p.tmp) && existsSync(p.data), "volume file in place, data directory inside the mount");
    check(f.calls.some((c) => c.cmd === "mount" && c.args.join(" ") === `-o nosuid,nodev /dev/mapper/cld-m1 ${p.mnt}`), "mounted nosuid,nodev from /dev/mapper/cld-<id>");

    // Reopen: no format, no mkfs; the stale mapping is closed first.
    f.calls.length = 0;
    await vol.prepare("m1", 1024, key);
    const again = f.calls.map((c) => `${c.cmd} ${c.args[0]}`).join("|");
    check(again === "umount " + p.mnt + "|cryptsetup close|cryptsetup open|mount -o", `reopen: close the old mapping, open, mount (got ${again})`);

    // Wrong key: open fails, nothing is mounted.
    await vol.close("m1");
    f.calls.length = 0;
    await rejects(vol.prepare("m1", 1024, newVolumeKey()), /wrong key/, "a wrong key does not open the volume");
    check(!f.calls.some((c) => c.cmd === "mount") && f.mounted.size === 0, "nothing mounted with a wrong key");

    // Close: tolerant of "not mounted" / "not active"; reports a real failure.
    check((await vol.close("m1")) === true, "closing an already closed volume is fine");
    await vol.prepare("m1", 1024, key);
    f.state.failOn = /^umount/;
    check((await vol.close("m1")) === false && logs.some((l) => /umount failed/.test(l)), "a umount that fails is reported");
    f.state.failOn = null;
    await vol.close("m1");

    // A mount failure closes the mapping again.
    f.state.failOn = /^mount/;
    await rejects(vol.prepare("m1", 1024, key), /could not mount/, "mount failure surfaces");
    check(f.active.size === 0, "mapping closed after a mount failure");
    f.state.failOn = null;

    // A format failure leaves nothing behind.
    f.state.failOn = /luksFormat/;
    await rejects(vol.prepare("m2", 1024, key), /could not create/, "format failure surfaces");
    check(!existsSync(vol.paths("m2").img) && !existsSync(vol.paths("m2").tmp), "no file left after a failed create");
    f.state.failOn = null;

    // Wipe: close, erase the header, delete the file. Idempotent; nothing to do for a volume that never existed.
    await vol.prepare("m1", 1024, key);
    f.calls.length = 0;
    check((await vol.wipe("m1")) === true && !existsSync(p.img) && !f.luks.has(p.img), "wipe: file deleted, keyslots erased");
    check(f.calls.map((c) => `${c.cmd} ${c.args[0]}`).join("|") === `umount ${p.mnt}|cryptsetup close|cryptsetup erase`, "wipe order: umount, close, erase");
    f.calls.length = 0;
    check((await vol.wipe("m1")) === true && (await vol.wipe("never")) === true && f.calls.length === 0, "wipe of nothing runs nothing");

    // Boot self-check.
    check((await encryptedVolumesSelfCheck(vol, false)).ok === false, "self-check refuses a non-root agent");
    check((await encryptedVolumesSelfCheck(vol, true)).ok === true && !vol.has("selfcheck"), "self-check round trip passes and cleans up");
    f.state.failOn = /^mount/;
    const bad = await encryptedVolumesSelfCheck(vol, true);
    check(bad.ok === false && /mount/.test(bad.reason), "self-check reports what failed");
    f.state.failOn = null;

    // ── Machine run flags ────────────────────────────────────────────────────────────────────────────────
    const args = workstationRunArgs("m3", machineSpec, { PUBLIC_KEY: SSH }, { ssh: 42001 }, [], false, true, p.data);
    check(args.includes("--runtime=runsc") && args.includes("--cap-drop=ALL"), "machine: runsc and every capability dropped first");
    check(MACHINE_CAPS.every((c) => args.includes(`--cap-add=${c}`)) && args.filter((a) => a.startsWith("--cap-add")).length === MACHINE_CAPS.length, "machine: exactly MACHINE_CAPS added back");
    check(args.includes("--security-opt=no-new-privileges") && args.includes("--pids-limit=512") && args.includes("--network"), "machine: the rest of the workstation hardening stays, no-new-privileges included");
    check(args.includes(`type=bind,source=${p.data},target=/root`) && !args.some((a) => a.startsWith("cld-m3:")), "encrypted volume bind-mounted at the workdir, no Docker volume");
    const plain = workstationRunArgs("m4", machineSpec, {}, { ssh: 42001 }, [], false, false);
    check(plain.includes("--security-opt=no-new-privileges") && !plain.some((a) => a.startsWith("--cap-add")), "machine image without sandbox: plain workstation flags");
    const other = workstationRunArgs("m5", { ...machineSpec, image: "runpod/pytorch:2.4.0" }, {}, { ssh: 42001 }, [], false, true);
    check(other.includes("--security-opt=no-new-privileges") && !other.some((a) => a.startsWith("--cap-add")), "another image on a sandbox node: plain workstation flags");
    const gpu = workstationRunArgs("m6", { ...machineSpec, gpu: { count: 1 } }, {}, { ssh: 42001 }, [0], false, true);
    check(!gpu.some((a) => a.startsWith("--cap-add")), "machine image with a GPU: no extra capabilities");
    throws(() => workstationRunArgs("m7", machineSpec, {}, { ssh: 42001 }, [], false, true, "/v/a,readonly"), /invalid volume source/, "a comma in the bind source is refused");

    // ── Manager: an encrypted machine from start to purge ──────────────────────────────────────────────────
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "cld-vol-mgr-"));
    const runs: string[][] = [];
    const ensured: string[] = [];
    const dockerRemovedVolumes: string[] = [];
    const dk: DockerOps = {
      run: async (a) => (runs.push(a), ""),
      remove: async () => {},
      running: async () => true,
      volumeEnsure: async (id) => (ensured.push(id), "created"),
      volumeRemove: async (id) => (dockerRemovedVolumes.push(id), true),
      gpuDevices: async () => null,
      logs: async () => "",
    };
    const reports: { id: string; body: StatusBody }[] = [];
    const mlogs: string[] = [];
    const base = {
      dataDir,
      publicHost: "203.0.113.7",
      ports: [43100, 43150] as [number, number],
      privateKey: PRIV,
      containersReady: true,
      hardening: async () => ({ ok: true, notes: [] }),
      docker: dk,
      log: (m: string) => mlogs.push(m),
      report: async (id: string, body: StatusBody) => (reports.push({ id, body }), true),
    };
    const m = new DeploymentManager({ ...base, sandbox: true, volumes: vol });
    const last = () => reports.at(-1)!;
    try {
      const k1 = newVolumeKey();
      const sealed = seal(PUB, k1, volumeKeyAad("mach1"));
      await m.handle({ id: "mach1", action: "start", kind: "workstation", spec: machineSpec, imageAllowed: true, volumeKey: sealed });
      check(last().id === "mach1" && last().body.status === "running", `encrypted machine runs (${JSON.stringify(last().body)})`);
      const run = runs.at(-1)!;
      check(run.includes(`type=bind,source=${vol.dataDir("mach1")},target=/root`) && run.includes("--cap-add=SYS_CHROOT"), "manager: bind-mounted encrypted volume, machine capabilities");
      check(!ensured.includes("mach1"), "no Docker volume made for an encrypted volume");
      check(f.luks.get(vol.paths("mach1").img) === k1, "the volume is keyed with the key the API sealed");
      check(!mlogs.join("\n").includes(k1) && !run.join(" ").includes(k1), "the opened key is in neither the log nor the docker argv");

      // Stop: closed (unmounted, mapping gone), kept for keepDays.
      await m.handle({ id: "mach1", action: "stop", kind: "workstation", spec: null });
      check(last().body.status === "stopped" && !f.active.has("cld-mach1") && f.mounted.size === 0, "stop closes the volume");
      check(existsSync(vol.paths("mach1").img) && m.keptVolumes().some((v) => v.id === "mach1"), "stop keeps the encrypted file for keepDays");
      // Purge: erased and deleted.
      await m.handle({ id: "mach1", action: "purge", kind: "workstation", spec: null });
      check(!existsSync(vol.paths("mach1").img) && !m.keptVolumes().some((v) => v.id === "mach1"), "purge erases and deletes the volume");

      // No key, a key sealed for another deployment, a key sealed as env: refused, nothing run.
      const before = runs.length;
      await m.handle({ id: "mach2", action: "start", kind: "workstation", spec: machineSpec, imageAllowed: true });
      check(last().id === "mach2" && last().body.status === "failed" && /no volume key/.test(last().body.message!), "start without a volume key fails");
      await m.handle({ id: "mach3", action: "start", kind: "workstation", spec: machineSpec, imageAllowed: true, volumeKey: seal(PUB, newVolumeKey(), volumeKeyAad("other")) });
      check(last().id === "mach3" && /could not open the volume key/.test(last().body.message!), "a key sealed for another deployment does not open");
      await m.handle({ id: "mach4", action: "start", kind: "workstation", spec: machineSpec, imageAllowed: true, volumeKey: seal(PUB, newVolumeKey(), sealedEnvAad("mach4")) });
      check(last().id === "mach4" && /could not open the volume key/.test(last().body.message!), "a payload sealed as env is not a volume key");
      check(runs.length === before, "docker run never called without a usable key");

      // A plain workstation on the same node: Docker volume as before, cryptsetup untouched.
      f.calls.length = 0;
      await m.handle({ id: "plain1", action: "start", kind: "workstation", spec: { ...machineSpec, image: "runpod/pytorch:2.4.0", volume: { sizeGb: 10, keepDays: 0 } }, imageAllowed: true });
      check(last().body.status === "running" && ensured.includes("plain1") && runs.at(-1)!.includes("cld-plain1:/root"), "unencrypted volume: Docker volume as before");
      await m.handle({ id: "plain1", action: "stop", kind: "workstation", spec: null });
      check(f.calls.length === 0 && dockerRemovedVolumes.includes("plain1"), "no cryptsetup for a plain volume; keepDays 0 removes it");
      await m.closeAll();

      // A node without encrypted volumes, or without the sandbox: cannot serve (the API re-places it).
      const noVol = new DeploymentManager({ ...base, sandbox: true });
      await noVol.handle({ id: "mach5", action: "start", kind: "workstation", spec: machineSpec, imageAllowed: true, volumeKey: sealed });
      check(last().id === "mach5" && last().body.message!.startsWith(NODE_CANNOT_SERVE) && /encrypted volumes/.test(last().body.message!), "no encrypted volumes → cannot serve");
      const noSandbox = new DeploymentManager({ ...base, volumes: vol });
      await noSandbox.handle({ id: "mach6", action: "start", kind: "workstation", spec: machineSpec, imageAllowed: true, volumeKey: seal(PUB, newVolumeKey(), volumeKeyAad("mach6")) });
      check(last().id === "mach6" && last().body.message!.startsWith(NODE_CANNOT_SERVE) && /gVisor/.test(last().body.message!), "no sandbox → a machine cannot be served");
      check(runs.length === before + 1, "docker run only for the plain workstation");
      await noVol.closeAll();
      await noSandbox.closeAll();
    } finally {
      await m.closeAll();
      rmSync(dataDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`✓ volumes selftest passed — ${passed} checks`);
}

main().catch((err) => {
  console.error(`✗ volumes selftest failed: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
