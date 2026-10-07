import { execFile } from "node:child_process";

export type ContainerSpec = {
  image: string;
  command?: string[];
  env?: Record<string, string>;
  ports: { container: number; protocol?: "tcp" }[];
  cpu: number; // millicores
  memMb: number;
  storageMb: number;
  /** "uid[:gid]" (numeric). Plain containers default to DEFAULT_USER; workstations to the image's user. */
  user?: string;
};

export function docker(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim().split("\n").pop() || "docker failed"));
      else resolve(stdout.toString().trim());
    });
  });
}

/** True when a Docker daemon answers `docker info` within 3 s. */
export async function dockerAvailable(): Promise<boolean> {
  try {
    await docker(["info"], 3000);
    return true;
  } catch {
    return false;
  }
}

export const containerName = (id: string) => `cld-${id}`;

export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const USER = /^\d{1,7}(:\d{1,7})?$/;

// ── Hardening (docs/IMPL_SPEC_2026-10.md "Node capabilities & hardening") ──────────────────────────────
/** User-defined bridge every tenant container joins; hardening.ts creates it and installs the egress rules. */
export const TENANT_NETWORK = "cld-tenant";
export const PIDS_LIMIT = 512;
/** Non-root default for plain containers (workstations run the image's user: sshd, code-server…). */
export const DEFAULT_USER = "1000:1000";
/** Tenant env keys that could steal GPUs or drivers from the host; always stripped and set by the agent. */
const STRIPPED_ENV = /^(NVIDIA_|CUDA_VISIBLE_DEVICES$)/;

/**
 * Flags every tenant container gets: memory and swap capped at the same value (no swap), and the writable layer
 * capped at storageMb (`--storage-opt size=`; needs a quota-capable storage driver — hardening.ts checks).
 */
export function hardeningArgs(memMb: number, storageMb: number): string[] {
  const mem = `${Math.floor(memMb)}m`;
  if (!(storageMb > 0)) throw new Error("storageMb must be positive");
  return [
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    `--pids-limit=${PIDS_LIMIT}`,
    "--memory", mem,
    "--memory-swap", mem,
    "--storage-opt", `size=${Math.floor(storageMb)}m`,
    "--network", TENANT_NETWORK,
  ];
}

/**
 * Tenant env as it reaches `docker run`: NVIDIA_* / CUDA_VISIBLE_DEVICES from the spec or sealed env are dropped,
 * and NVIDIA_VISIBLE_DEVICES is set explicitly to the GPU indices allocated to this container ("none" without any),
 * so a tenant cannot ask the NVIDIA runtime for `all`.
 */
export function sanitizeTenantEnv(env: Record<string, string>, gpuDevices: number[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (!STRIPPED_ENV.test(k)) out[k] = v;
  out.NVIDIA_VISIBLE_DEVICES = gpuDevices.length ? gpuDevices.join(",") : "none";
  return out;
}

/**
 * Local image allowlist: CLOUDANA_IMAGE_ALLOWLIST is a comma-separated list of regexes matched against the whole
 * image reference. null = not configured (only the API's imageAllowed flag decides).
 */
export function imageAllowedLocally(image: string, allowlist: string | undefined): boolean | null {
  const patterns = (allowlist ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (patterns.length === 0) return null;
  return patterns.some((p) => {
    try {
      return new RegExp(`^(?:${p})$`).test(image);
    } catch {
      return false;
    }
  });
}

/** Whether to run `image`: the API's flag, or a local allowlist match. */
export function imageAllowed(image: string, apiFlag: unknown, allowlist = process.env.CLOUDANA_IMAGE_ALLOWLIST): boolean {
  return apiFlag === true || imageAllowedLocally(image, allowlist) === true;
}

export function userArgs(user: string | undefined, fallback: string | undefined): string[] {
  const u = user ?? fallback;
  if (u === undefined) return [];
  if (!USER.test(u)) throw new Error("invalid user (want numeric uid[:gid])");
  return ["--user", u];
}

/** Build the `docker run` argv for a plain container. `hostPorts[i]` maps to `spec.ports[i].container`. */
export function dockerRunArgs(id: string, spec: ContainerSpec, env: Record<string, string>, hostPorts: number[]): string[] {
  if (typeof spec.image !== "string" || !spec.image || spec.image.startsWith("-")) throw new Error("invalid image");
  if (!(spec.cpu > 0) || !(spec.memMb > 0)) throw new Error("cpu and memMb must be positive");
  // Plain containers never run as root (the API refuses it too); only workstations keep the image's user.
  if (spec.user !== undefined && /^0(:\d{1,7})?$/.test(spec.user)) throw new Error("containers cannot run as root (uid 0)");
  const args = ["run", "-d", "--name", containerName(id), "--restart", "unless-stopped"];
  args.push(...hardeningArgs(spec.memMb, spec.storageMb), "--cpus", String(spec.cpu / 1000));
  args.push(...userArgs(spec.user, DEFAULT_USER));
  spec.ports.forEach((p, i) => {
    if (!Number.isInteger(p.container) || p.container < 1 || p.container > 65535) throw new Error("invalid container port");
    args.push("-p", `${hostPorts[i]}:${p.container}`);
  });
  for (const [k, v] of Object.entries(sanitizeTenantEnv(env))) {
    if (!ENV_KEY.test(k)) throw new Error(`invalid env key ${JSON.stringify(k)}`);
    args.push("-e", `${k}=${String(v)}`);
  }
  args.push(spec.image, ...(spec.command ?? []).map(String));
  return args;
}

/** Image pulls can be slow; allow 10 minutes. */
export const dockerRun = (args: string[]) => docker(args, 10 * 60_000);

export async function dockerRemove(id: string): Promise<void> {
  try {
    await docker(["rm", "-f", containerName(id)], 30_000);
  } catch {} // already gone is fine
}

export async function dockerRunning(id: string): Promise<boolean> {
  try {
    const out = await docker(["ps", "--filter", `name=^${containerName(id)}$`, "--format", "{{.Names}}"], 10_000);
    return out.split("\n").includes(containerName(id));
  } catch {
    return false;
  }
}

/** Volume names match container names: `cld-<id>`. */
export const volumeName = containerName;

/** Create the workstation volume, or reuse it when it already exists. */
export async function dockerVolumeEnsure(id: string): Promise<"created" | "reused"> {
  try {
    await docker(["volume", "inspect", volumeName(id)], 10_000);
    return "reused";
  } catch {
    await docker(["volume", "create", volumeName(id)], 30_000);
    return "created";
  }
}

/** Remove the workstation volume. true = removed or already gone; false = still there (in use, Docker down…). */
export async function dockerVolumeRemove(id: string): Promise<boolean> {
  try {
    await docker(["volume", "rm", volumeName(id)], 60_000);
    return true;
  } catch (err) {
    return /no such volume/i.test((err as Error).message);
  }
}

/** GPU device indices from `docker inspect … {{json .HostConfig.DeviceRequests}}`. null: unknown (no ids, or `all`). */
export function parseDeviceRequests(json: string): number[] | null {
  let reqs: unknown;
  try {
    reqs = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(reqs)) return reqs === null ? [] : null;
  const ids: number[] = [];
  for (const r of reqs as { Count?: number; DeviceIDs?: string[] | null }[]) {
    if (r?.Count === -1) return null; // --gpus all: indices not listed
    for (const d of r?.DeviceIDs ?? []) {
      if (!/^\d+$/.test(d)) return null; // UUIDs: cannot map to indices
      ids.push(Number(d));
    }
  }
  return ids.sort((a, b) => a - b);
}

/** GPU indices the running container `cld-<id>` was started with; null when Docker cannot say. */
export async function dockerGpuDevices(id: string): Promise<number[] | null> {
  try {
    return parseDeviceRequests(await docker(["inspect", "--format", "{{json .HostConfig.DeviceRequests}}", containerName(id)], 10_000));
  } catch {
    return null;
  }
}

/** The Docker operations DeploymentManager uses — injectable so selftests run without Docker. */
export const realDocker = {
  run: dockerRun,
  remove: dockerRemove,
  running: dockerRunning,
  volumeEnsure: dockerVolumeEnsure,
  volumeRemove: dockerVolumeRemove,
  gpuDevices: dockerGpuDevices,
};
export type DockerOps = typeof realDocker;
