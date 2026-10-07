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
 *      (DOCKER-USER) and traffic to the host itself (INPUT) — so a tenant cannot reach the LAN, the cloud
 *      metadata service (169.254.169.254) or services on this machine. Rules already present (`iptables -C`)
 *      count; missing ones are installed (`iptables -I`), which needs root / CAP_NET_ADMIN.
 *
 * preStartCheck() repeats 2 and 3 as pure checks (never installs) before every container start: a flushed
 * firewall or a recreated network while the agent runs must refuse the start, not silently weaken it.
 *
 * Every command is an argv array through execFile; nothing is interpolated into a shell.
 */
import { execFile } from "node:child_process";
import { TENANT_NETWORK } from "./container.ts";

/** Destinations a tenant container must never reach. */
export const BLOCKED_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10"];

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
    ["INPUT", "-s", subnet, "-j", "DROP"],
  ];
}

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
  notes.push(`egress rules for ${subnets.join(", ")}: ${installed ? `${installed} installed` : "all present"}`);
  return { ok: true, notes };
}

/**
 * Before each container start: the tenant network still exists with icc off and every egress rule is still
 * present (`iptables -C` only — nothing is installed here). Refuse otherwise.
 */
export async function preStartCheck(exec: Exec = realExec): Promise<HardeningResult> {
  const notes: string[] = [];
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
