/**
 * Container hardening self-check (docs/IMPL_SPEC_2026-10.md "Node capabilities & hardening").
 *
 * Run once at boot when CLOUDANA_ALLOW_CONTAINERS=1. The node announces `container` (and `gpu`) only when
 * every step passes; otherwise it stays a compute + static-hosting node and says why.
 *
 *   1. Docker answers, and its storage driver can enforce `--storage-opt size=` (the per-container disk cap):
 *      overlay2 on xfs mounted with project quotas (pquota/prjquota), or btrfs / zfs. Anything else (overlay2 on
 *      ext4, Docker Desktop's VM) cannot cap a tenant's writable layer, so containers are refused.
 *   2. The user-defined bridge `cld-tenant` exists with inter-container communication off (created that way, and
 *      verified with `docker network inspect` when it already exists — an operator-made network must match).
 *   3. Egress from that bridge to private / link-local / CGNAT ranges is dropped — both forwarded traffic
 *      (DOCKER-USER) and new connections to the host itself (INPUT; replies to connections the host opened, e.g.
 *      the relay forwarding to a container, still pass) — so a tenant cannot reach the LAN, the cloud metadata
 *      service (169.254.169.254) or services on this machine. Rules already present (`iptables -C`) count; missing
 *      ones are installed (`iptables -I`), which needs root / CAP_NET_ADMIN. The old INPUT rule without the
 *      conntrack match (it dropped those replies too) is deleted.
 *      Outbound mail (tcp 25, 465, 587) from that bridge is dropped too, to any destination (docs/TRUST_TIERS.md §4):
 *      spam is the most common abuse of rented boxes and gets the provider's IP blocklisted. With all of these in
 *      place the node announces `egress-v2`.
 *
 * Before 1, Docker must be ≥ 28: older engines let LAN hosts reach ports published on 127.0.0.1, which is how
 * relayed containers are published.
 *
 * preStartCheck() repeats 2 and 3 as pure checks (never installs) before every container start: a flushed
 * firewall or a recreated network while the agent runs must refuse the start, not silently weaken it.
 *
 * gVisor (docs/TRUST_TIERS.md §5): runscAvailable() reports whether the Docker daemon has the `runsc` runtime
 * registered. If so the node announces `sandbox` and runs every non-GPU tenant container with --runtime=runsc;
 * preStartCheck({ runsc: true }) then refuses a non-GPU start once the runtime is gone (no silent downgrade).
 *
 * Every command is an argv array through execFile; nothing is interpolated into a shell.
 */
import { execFile } from "node:child_process";
import { TENANT_NETWORK } from "./container.ts";

/** Destinations a tenant container must never reach. */
export const BLOCKED_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10"];
/** Oldest Docker engine that keeps 127.0.0.1-published ports off the LAN. */
export const MIN_DOCKER_MAJOR = 28;
/** Outbound TCP ports a tenant container must never reach, on any destination: SMTP, SMTPS, mail submission. */
export const BLOCKED_TCP_PORTS = [25, 465, 587];
/** The gVisor runtime name the Docker daemon registers (`runsc install`). */
export const SANDBOX_RUNTIME = "runsc";

export type Exec = (cmd: string, args: string[], timeoutMs?: number) => Promise<string>;

export const realExec: Exec = (cmd, args, timeoutMs = 10_000) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim().split("\n").pop() || `${cmd} failed`));
      else resolve(stdout.toString().trim());
    });
  });

export interface HardeningResult {
  ok: boolean;
  /** Why containers are refused (ok = false). */
  reason?: string;
  /** What was found / done, for the boot log. */
  notes: string[];
}

const SUBNET = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;
/** `docker network inspect` output: "<subnet> [<subnet> ]|<enable_icc option or empty>". */
const NETWORK_FORMAT = '{{range .IPAM.Config}}{{.Subnet}} {{end}}|{{index .Options "com.docker.network.bridge.enable_icc"}}';

/** Subnets and the icc setting of the tenant network. Throws when it is missing or has no IPv4 subnet. */
async function inspectTenantNetwork(exec: Exec): Promise<{ subnets: string[]; iccOff: boolean }> {
  const out = await exec("docker", ["network", "inspect", TENANT_NETWORK, "--format", NETWORK_FORMAT]);
  const [subnetPart = "", icc = ""] = out.split("|");
  const subnets = subnetPart.split(/\s+/).filter((s) => SUBNET.test(s));
  if (subnets.length === 0) throw new Error(`network ${TENANT_NETWORK} has no IPv4 subnet`);
  return { subnets, iccOff: icc.trim() === "false" };
}

/** The IPv4 subnet(s) of the tenant network, creating the network when it is missing; icc must be off. */
async function ensureTenantNetwork(exec: Exec, notes: string[]): Promise<string[]> {
  let net: { subnets: string[]; iccOff: boolean };
  try {
    net = await inspectTenantNetwork(exec);
    notes.push(`network ${TENANT_NETWORK} present`);
  } catch (err) {
    if (/no IPv4 subnet/.test((err as Error).message)) throw err;
    await exec("docker", ["network", "create", "--driver", "bridge", "--opt", "com.docker.network.bridge.enable_icc=false", TENANT_NETWORK], 30_000);
    notes.push(`network ${TENANT_NETWORK} created (icc off)`);
    net = await inspectTenantNetwork(exec);
  }
  if (!net.iccOff) throw new Error(`network ${TENANT_NETWORK} allows inter-container traffic (recreate it with --opt com.docker.network.bridge.enable_icc=false)`);
  return net.subnets;
}

/**
 * Whether Docker's storage driver enforces `--storage-opt size=`: btrfs and zfs always; overlay2 only on xfs
 * with project quotas (the Docker root's mount options carry pquota/prjquota). Returns the reason when not.
 */
export async function storageQuotaSupported(exec: Exec): Promise<{ ok: true; note: string } | { ok: false; reason: string }> {
  const info = await exec("docker", ["info", "--format", "{{.Driver}}|{{.DockerRootDir}}|{{range .DriverStatus}}{{index . 0}}={{index . 1}};{{end}}"]);
  const [driver = "", root = "", status = ""] = info.split("|");
  if (driver === "btrfs" || driver === "zfs") return { ok: true, note: `storage driver ${driver} (quotas native)` };
  if (driver !== "overlay2") return { ok: false, reason: `storage driver ${driver || "unknown"} cannot cap container disk (--storage-opt size)` };
  const backing = /Backing Filesystem=([^;]*)/.exec(status)?.[1]?.trim().toLowerCase();
  if (backing !== "xfs") return { ok: false, reason: `overlay2 on ${backing ?? "unknown"} cannot cap container disk; use xfs mounted with pquota, or btrfs/zfs` };
  let opts = "";
  try {
    opts = await exec("findmnt", ["-no", "OPTIONS", "-T", root || "/var/lib/docker"]);
  } catch {
    return { ok: false, reason: "cannot read the Docker root's mount options (findmnt)" };
  }
  if (!/\b(pquota|prjquota)\b/.test(opts)) return { ok: false, reason: `overlay2 on xfs without project quotas (${root} mounted without pquota)` };
  return { ok: true, note: "storage driver overlay2 on xfs with pquota" };
}

/** iptables rules for one tenant subnet: [chain, ...rule]. */
export function egressRules(subnet: string): string[][] {
  return [
    ...BLOCKED_RANGES.map((dst) => ["DOCKER-USER", "-s", subnet, "-d", dst, "-j", "DROP"]),
    ...BLOCKED_TCP_PORTS.map((port) => ["DOCKER-USER", "-s", subnet, "-p", "tcp", "--dport", String(port), "-j", "DROP"]),
    ["INPUT", "-s", subnet, "-m", "conntrack", "!", "--ctstate", "ESTABLISHED,RELATED", "-j", "DROP"],
  ];
}

/** The INPUT rule agents before the relay installed: it also dropped container replies to the host. */
export const oldInputRule = (subnet: string) => ["INPUT", "-s", subnet, "-j", "DROP"];

async function ensureRule(exec: Exec, rule: string[]): Promise<"present" | "installed"> {
  const [chain, ...spec] = rule;
  try {
    await exec("iptables", ["-C", chain, ...spec]);
    return "present";
  } catch {
    await exec("iptables", ["-I", chain, ...spec]);
    return "installed";
  }
}

export async function hardeningSelfCheck(exec: Exec = realExec): Promise<HardeningResult> {
  const notes: string[] = [];
  try {
    await exec("docker", ["info"], 3000);
  } catch {
    return { ok: false, reason: "docker is not reachable", notes };
  }
  let version: string;
  try {
    version = (await exec("docker", ["version", "--format", "{{.Server.Version}}"])).trim();
  } catch (err) {
    return { ok: false, reason: `cannot read the Docker server version: ${(err as Error).message}`, notes };
  }
  if (!(Number(/^(\d+)\./.exec(version)?.[1]) >= MIN_DOCKER_MAJOR)) {
    return { ok: false, reason: `Docker ${version || "(unknown version)"} is too old: containers need Docker ≥ ${MIN_DOCKER_MAJOR}`, notes };
  }
  notes.push(`docker ${version}`);
  try {
    const quota = await storageQuotaSupported(exec);
    if (!quota.ok) return { ok: false, reason: quota.reason, notes };
    notes.push(quota.note);
  } catch (err) {
    return { ok: false, reason: `storage driver: ${(err as Error).message}`, notes };
  }
  let subnets: string[];
  try {
    subnets = await ensureTenantNetwork(exec, notes);
  } catch (err) {
    return { ok: false, reason: `tenant network: ${(err as Error).message}`, notes };
  }
  let installed = 0;
  for (const subnet of subnets) {
    for (const rule of egressRules(subnet)) {
      try {
        if ((await ensureRule(exec, rule)) === "installed") installed++;
      } catch (err) {
        return {
          ok: false,
          reason: `cannot install egress DROP rule (${rule.join(" ")}): ${(err as Error).message} — run the agent as root with NET_ADMIN, or pre-install the rules`,
          notes,
        };
      }
    }
  }
  // Only after the new rule is in place, so the host is never unprotected. -D removes one copy: repeat while present.
  let removed = 0;
  for (const subnet of subnets) {
    const [chain, ...spec] = oldInputRule(subnet);
    for (let i = 0; i < 16; i++) {
      try {
        await exec("iptables", ["-C", chain, ...spec]);
      } catch {
        break; // not (or no longer) present
      }
      try {
        await exec("iptables", ["-D", chain, ...spec]);
        removed++;
      } catch (err) {
        return { ok: false, reason: `cannot delete the old INPUT rule (${[chain, ...spec].join(" ")}): ${(err as Error).message}`, notes };
      }
    }
  }
  notes.push(`egress rules for ${subnets.join(", ")}: ${installed ? `${installed} installed` : "all present"}${removed ? `, ${removed} old INPUT rule(s) removed` : ""}`);
  return { ok: true, notes };
}

/**
 * Whether the Docker daemon has the gVisor runtime registered (`docker info` Runtimes has `runsc`). This is the
 * registration only: a broken runsc makes `docker run` fail (the start is reported failed), never run unsandboxed.
 */
export async function runscAvailable(exec: Exec = realExec): Promise<boolean> {
  try {
    const runtimes: unknown = JSON.parse(await exec("docker", ["info", "--format", "{{json .Runtimes}}"]));
    return !!runtimes && typeof runtimes === "object" && Object.hasOwn(runtimes, SANDBOX_RUNTIME);
  } catch {
    return false;
  }
}

/**
 * Before each container start: the tenant network still exists with icc off and every egress rule is still
 * present (`iptables -C` only — nothing is installed here). `runsc`: this start must run under gVisor (the node
 * announced `sandbox` and it is not a GPU container), so the runtime must still be registered. Refuse otherwise.
 */
export async function preStartCheck(exec: Exec = realExec, opts: { runsc?: boolean } = {}): Promise<HardeningResult> {
  const notes: string[] = [];
  if (opts.runsc && !(await runscAvailable(exec))) {
    return { ok: false, reason: `the ${SANDBOX_RUNTIME} runtime (gVisor) is no longer registered with Docker, and this node announced \`sandbox\``, notes };
  }
  let net: { subnets: string[]; iccOff: boolean };
  try {
    net = await inspectTenantNetwork(exec);
  } catch (err) {
    return { ok: false, reason: `tenant network: ${(err as Error).message}`, notes };
  }
  if (!net.iccOff) return { ok: false, reason: `network ${TENANT_NETWORK} allows inter-container traffic`, notes };
  for (const subnet of net.subnets) {
    for (const [chain, ...spec] of egressRules(subnet)) {
      try {
        await exec("iptables", ["-C", chain, ...spec]);
      } catch {
        return { ok: false, reason: `egress rule missing: iptables -C ${chain} ${spec.join(" ")}`, notes };
      }
    }
  }
  return { ok: true, notes };
}
