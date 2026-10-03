import { execFile } from "node:child_process";

export type ContainerSpec = {
  image: string;
  command?: string[];
  env?: Record<string, string>;
  ports: { container: number; protocol?: "tcp" }[];
  cpu: number; // millicores
  memMb: number;
  storageMb: number;
};

function docker(args: string[], timeoutMs: number): Promise<string> {
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

/** Build the `docker run` argv. `hostPorts[i]` maps to `spec.ports[i].container`. */
export function dockerRunArgs(id: string, spec: ContainerSpec, env: Record<string, string>, hostPorts: number[]): string[] {
  if (typeof spec.image !== "string" || !spec.image || spec.image.startsWith("-")) throw new Error("invalid image");
  if (!(spec.cpu > 0) || !(spec.memMb > 0)) throw new Error("cpu and memMb must be positive");
  const args = ["run", "-d", "--name", containerName(id), "--restart", "unless-stopped"];
  args.push("--memory", `${Math.floor(spec.memMb)}m`, "--cpus", String(spec.cpu / 1000));
  spec.ports.forEach((p, i) => {
    if (!Number.isInteger(p.container) || p.container < 1 || p.container > 65535) throw new Error("invalid container port");
    args.push("-p", `${hostPorts[i]}:${p.container}`);
  });
  for (const [k, v] of Object.entries(env)) {
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
