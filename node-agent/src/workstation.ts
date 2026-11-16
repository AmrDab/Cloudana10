// Cloud workstations (docs/WORKSTATIONS.md §1, §5): pure helpers — argv, env, status report, volume schedule.
// Everything here is side-effect free so it can be tested on a machine without Docker or a GPU.
import { randomBytes } from "node:crypto";
import { containerName, ENV_KEY, hardeningArgs, sandboxArgs, sanitizeTenantEnv, userArgs, volumeName, type ContainerSpec } from "./container.ts";
import type { GpuInfo } from "./hardware.ts";
import { gpuTier, requestTier } from "../../shared/gpu-tier.ts";

/**
 * The spec on a `kind: "workstation"` start command. The last four fields come from the environment template;
 * the orchestrator copies them onto the spec it sends the node.
 */
export type WorkstationSpec = ContainerSpec & {
  gpu?: { count: number; minVramGb?: number; class?: string };
  tier?: "on-demand" | "interruptible";
  maxHours?: number;
  access: { web?: { port: number; path?: string }; ssh?: { publicKey: string } };
  /** encrypted: LUKS on the node, key sealed on the start instruction (volumes.ts); needs `encrypted-volumes`. */
  volume?: { sizeGb: number; keepDays: number; encrypted?: boolean };
  workdir?: string; // volume mount point, default /workspace
  sshPort?: number; // container port of sshd, default 22
  tokenEnv?: string; // env var the app reads its web token / password from (JUPYTER_TOKEN, PASSWORD…)
  tokenQuery?: string; // URL query parameter that accepts the token (Jupyter: "token"); absent → token sent as webToken
};

export interface WorkstationPorts {
  web?: number; // host port for access.web.port
  ssh?: number; // host port for sshPort
}

/** Fields of the `running` status report for a workstation. */
export interface WorkstationReport {
  status: "running";
  endpoint?: string;
  webPath?: string; // relay mode, instead of endpoint: its path + query ("/lab?token=…", "/")
  sshEndpoint?: string;
  webToken?: string;
  message?: string;
}

export const DEFAULT_WORKDIR = "/workspace";
/** Used when a stop arrives for a workstation the agent has no record of and the spec carries no keepDays. */
export const DEFAULT_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

const SSH_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/]+={0,3}( [^\r\n\0]*)?$/;
const QUERY_KEY = /^[A-Za-z0-9_-]{1,32}$/;
const WORKDIR = /^\/[A-Za-z0-9._/-]*$/;
const WEB_PATH = /^\/[A-Za-z0-9._~/-]*$/;
/** Templates whose app takes the token in the URL, when the template does not say so itself. */
const KNOWN_TOKEN_QUERY: Record<string, string> = { JUPYTER_TOKEN: "token" };

function port(p: unknown, what: string): number {
  if (!Number.isInteger(p) || (p as number) < 1 || (p as number) > 65535) throw new Error(`invalid ${what}`);
  return p as number;
}

/**
 * Capabilities to announce. Every node does `matmul`, `int8-mlp`, `int8-model` (an API that does not offer it drops it at announce)
 * and `hosting` (static sites). `container` only when the operator
 * opted in (CLOUDANA_ALLOW_CONTAINERS=1), Docker answers and the hardening self-check passed (`containersReady`);
 * `gpu` additionally needs a working nvidia-smi; `any-image` (CLOUDANA_ANY_IMAGE=1) lets the network send images
 * outside its curated list — what GPU endpoints need (docs/V4_ENDPOINTS_CONTRACT.md). With containers the node also
 * announces `egress-v2` (the self-check installed and verified every egress rule, mail ports included) and, when
 * Docker has the gVisor runtime registered (the `sandbox` argument), `sandbox`: every non-GPU container it starts
 * runs under runsc (docs/TRUST_TIERS.md §4–§5). `encrypted-volumes` when the operator opted in and the LUKS round trip
 * passed at boot (volumes.ts encryptedVolumesSelfCheck): workstation volumes that ask for it are encrypted at rest.
 */
export function workTypes(containersReady: boolean, gpus: GpuInfo[], anyImage = false, sandbox = false, encryptedVolumes = false): string[] {
  return [
    "matmul",
    "int8-mlp",
    "int8-model",
    "hosting",
    ...(containersReady ? ["container"] : []),
    ...(containersReady && gpus.length > 0 ? ["gpu"] : []),
    ...(containersReady && anyImage ? ["any-image"] : []),
    ...(containersReady ? ["egress-v2"] : []),
    ...(containersReady && sandbox ? ["sandbox"] : []),
    ...(containersReady && encryptedVolumes ? ["encrypted-volumes"] : []),
  ];
}

/**
 * The Cloudana machine image (images/machine): Ubuntu with sshd, login root by key (root inside gVisor). The API pins
 * one version (client/api template-workstations.ts MACHINE_IMAGE); any published version is recognised here.
 */
export const MACHINE_IMAGE = /^ghcr\.io\/amrdab\/cloudana-machine:\d+\.\d+\.\d+$/;
export const isMachineImage = (image: unknown) => typeof image === "string" && MACHINE_IMAGE.test(image);

/**
 * Capabilities a machine gets back after --cap-drop=ALL, only under gVisor — the smallest set that works, found by
 * images/machine/smoke-test.sh dropping and adding one at a time: without SETUID, SETGID or SYS_CHROOT nobody logs in
 * (sshd's privilege separation and the login itself); without CHOWN an interactive login gets no pty; without
 * DAC_OVERRIDE root cannot apt-get install; without AUDIT_WRITE sshd refuses a pty under runc (gVisor has no audit
 * subsystem and does not need it, but the set must not depend on that). FOWNER, FSETID, KILL and NET_BIND_SERVICE were
 * not needed (Docker lets a container bind ports below 1024). These are capabilities of root inside the gVisor sandbox,
 * not on the host kernel. With --cap-drop=ALL alone sshd starts but every login fails at its privsep chroot.
 */
export const MACHINE_CAPS = ["CHOWN", "DAC_OVERRIDE", "SETGID", "SETUID", "SYS_CHROOT", "AUDIT_WRITE"];

/**
 * A machine (the machine image, no GPU, on a sandbox node) gets MACHINE_CAPS back on top of the full workstation
 * hardening, no-new-privileges included: the tenant logs in as root (by key), so nothing needs a setuid binary — and
 * under gVisor a setuid exec does not raise privileges anyway. Anywhere else (no gVisor, or a GPU) the box gets the
 * plain workstation flags, and the agent refuses to start a machine there at all (deployments.ts).
 */
export function machineArgs(hardening: string[]): string[] {
  return [...hardening, ...MACHINE_CAPS.map((c) => `--cap-add=${c}`)];
}

/** `--mount` for an encrypted volume's directory (a bind mount: Docker fails the start when the directory is missing). */
const BIND_SOURCE = /^\/[A-Za-z0-9._/-]+$/;

/** GPUs a workstation asks for (0 = CPU workstation). */
export const gpuCountOf = (spec: unknown) => {
  const n = (spec as WorkstationSpec | undefined)?.gpu?.count;
  return Number.isInteger(n) && (n as number) > 0 ? (n as number) : 0;
};

/**
 * Lowest `count` free device indices. `nodeGpus` is the GPU count, or the node's GPU list in device order: then only
 * GPUs of the requested tier (shared/gpu-tier.ts) with at least `minVramGb` qualify, so on a mixed node a standard
 * request never gets the H100 and a 40 GB request never gets the 12 GB card. Throws when the node cannot satisfy it.
 */
export function pickGpus(count: number, nodeGpus: number | GpuInfo[], used: Set<number>, minVramGb = 0, tier?: string): number[] {
  if (count <= 0) return [];
  const total = typeof nodeGpus === "number" ? nodeGpus : nodeGpus.length;
  if (total < 1) throw new Error("this node has no usable GPU");
  const want = requestTier(tier);
  const fits = (i: number) => typeof nodeGpus === "number" || (nodeGpus[i].vramGB >= minVramGb && gpuTier(nodeGpus[i]) === want);
  const free: number[] = [];
  for (let i = 0; i < total && free.length < count; i++) if (!used.has(i) && fits(i)) free.push(i);
  if (free.length < count) throw new Error("not enough free GPUs");
  return free;
}

/** 24 random bytes, base64url (32 chars, URL-safe). */
export const newWebToken = () => randomBytes(24).toString("base64url");

export function sshPortOf(spec: WorkstationSpec): number {
  return spec.sshPort === undefined ? 22 : port(spec.sshPort, "sshPort");
}

export function workdirOf(spec: WorkstationSpec): string {
  const w = spec.workdir ?? DEFAULT_WORKDIR;
  // No ":" or "," (they would change the meaning of -v), no "..".
  if (typeof w !== "string" || !WORKDIR.test(w) || w.split("/").includes("..")) throw new Error("invalid workdir");
  return w;
}

export function keepDaysOf(spec: unknown): number {
  const d = (spec as WorkstationSpec | undefined)?.volume?.keepDays;
  return typeof d === "number" && Number.isFinite(d) && d >= 0 ? Math.min(d, 30) : DEFAULT_KEEP_DAYS;
}

/** Shape checks that do not depend on ports or env. Throws with a user-safe message. */
export function validateWorkstation(spec: WorkstationSpec): void {
  if (!spec || typeof spec !== "object") throw new Error("workstation spec missing");
  if (!spec.access || (!spec.access.web && !spec.access.ssh)) throw new Error("workstation needs access.web or access.ssh");
  if (spec.access.web) {
    port(spec.access.web.port, "access.web.port");
    if (spec.access.web.path !== undefined && (typeof spec.access.web.path !== "string" || !WEB_PATH.test(spec.access.web.path)))
      throw new Error("invalid access.web.path");
  }
  if (spec.access.ssh && (typeof spec.access.ssh.publicKey !== "string" || !SSH_KEY.test(spec.access.ssh.publicKey.trim())))
    throw new Error("invalid ssh public key");
  if (spec.tokenEnv !== undefined && (typeof spec.tokenEnv !== "string" || !ENV_KEY.test(spec.tokenEnv)))
    throw new Error("invalid tokenEnv");
  if (spec.tokenQuery !== undefined && (typeof spec.tokenQuery !== "string" || !QUERY_KEY.test(spec.tokenQuery)))
    throw new Error("invalid tokenQuery");
  if (spec.gpu !== undefined && (!Number.isInteger(spec.gpu.count) || spec.gpu.count < 0)) throw new Error("invalid gpu.count");
  sshPortOf(spec);
  workdirOf(spec);
}

/**
 * Env for the container: spec.env, then the opened sealed env, then the SSH key (PUBLIC_KEY + SSH_PUBLIC_KEY,
 * the linuxserver/openssh-server and vast/runpod convention), then the web token under the template's tokenEnv.
 */
export function workstationEnv(spec: WorkstationSpec, sealed: Record<string, string>, token?: string): Record<string, string> {
  const env: Record<string, string> = { ...(spec.env ?? {}), ...sealed };
  if (spec.access.ssh) {
    const key = spec.access.ssh.publicKey.trim();
    env.PUBLIC_KEY = key;
    env.SSH_PUBLIC_KEY = key;
  }
  if (spec.tokenEnv && token) env[spec.tokenEnv] = token;
  return env;
}

/**
 * `docker run` argv for a workstation. An argv array for execFile — never a shell string — so image, command and
 * env values reach Docker verbatim. `devices` are the GPU indices allocated to it (pickGpus), one per gpu.count.
 * `sandbox`: the node announced `sandbox` (CPU workstations run under gVisor; GPU ones do not — sandboxArgs); a machine
 * there gets machineArgs. `volumeSource`: an encrypted volume's open directory (volumes.ts), bind-mounted instead of
 * the Docker volume cld-<id>.
 */
export function workstationRunArgs(
  id: string,
  spec: WorkstationSpec,
  env: Record<string, string>,
  ports: WorkstationPorts,
  devices: number[],
  relayed = false, // web and SSH ports published on 127.0.0.1 only (reached through the relay)
  sandbox = false,
  volumeSource?: string,
): string[] {
  validateWorkstation(spec);
  if (typeof spec.image !== "string" || !spec.image || spec.image.startsWith("-")) throw new Error("invalid image");
  if (!(spec.cpu > 0) || !(spec.memMb > 0)) throw new Error("cpu and memMb must be positive");
  if (spec.command !== undefined && (!Array.isArray(spec.command) || spec.command.some((c) => typeof c !== "string")))
    throw new Error("command must be an array of strings");
  if (volumeSource !== undefined && (!BIND_SOURCE.test(volumeSource) || volumeSource.split("/").includes(".."))) throw new Error("invalid volume source");

  const args = ["run", "-d", "--name", containerName(id), "--restart", "unless-stopped", ...sandboxArgs(sandbox, devices)];
  // Same hardening as plain containers; the user stays the image's (sshd, code-server…) unless the spec pins one.
  const hardening = hardeningArgs(spec.memMb, spec.storageMb);
  const machine = sandbox && devices.length === 0 && isMachineImage(spec.image);
  args.push(...(machine ? machineArgs(hardening) : hardening), "--cpus", String(spec.cpu / 1000), "--shm-size=1g");
  args.push(...userArgs(spec.user, undefined));

  if (devices.length !== gpuCountOf(spec) || devices.some((d) => !Number.isInteger(d) || d < 0))
    throw new Error("GPU devices do not match gpu.count");
  // Explicit indices, never count=N (Docker would hand every workstation GPU 0). The inner quotes keep the
  // comma inside one --gpus field for Docker's CSV parser.
  if (devices.length) args.push("--gpus", `"device=${devices.join(",")}"`);

  if (volumeSource !== undefined) args.push("--mount", `type=bind,source=${volumeSource},target=${workdirOf(spec)}`);
  else args.push("-v", `${volumeName(id)}:${workdirOf(spec)}`);
  if (spec.access.web) {
    if (ports.web === undefined) throw new Error("no host port for web access");
    args.push("-p", `${relayed ? "127.0.0.1:" : ""}${port(ports.web, "host port")}:${spec.access.web.port}`);
  }
  if (spec.access.ssh) {
    if (ports.ssh === undefined) throw new Error("no host port for ssh access");
    args.push("-p", `${relayed ? "127.0.0.1:" : ""}${port(ports.ssh, "host port")}:${sshPortOf(spec)}`);
  }
  // NVIDIA_* / CUDA_VISIBLE_DEVICES from the tenant are dropped; NVIDIA_VISIBLE_DEVICES names exactly these devices.
  for (const [k, v] of Object.entries(sanitizeTenantEnv(env, devices))) {
    if (!ENV_KEY.test(k)) throw new Error(`invalid env key ${JSON.stringify(k)}`);
    args.push("-e", `${k}=${String(v)}`);
  }
  args.push(spec.image, ...(spec.command ?? []));
  return args;
}

/**
 * The `running` report. The token goes in the endpoint URL only when the app accepts it there (tokenQuery, or a
 * known template such as Jupyter); otherwise the endpoint is plain and the token travels as `webToken`.
 * `relayed`: the web port is served through the relay, so instead of an endpoint the report carries `webPath` (the
 * endpoint's path + query; the API puts it after https://<id>.<user-content domain>), and SSH is reached through the
 * relay's byte streams (`cloudana ssh <id>`, docs/V4_RELAY_CONTRACT.md), so no sshEndpoint is reported. The API
 * relays a workstation only on a node that announced `relay-streams`.
 */
export function workstationReport(
  publicHost: string,
  spec: WorkstationSpec,
  ports: WorkstationPorts,
  token?: string,
  relayed = false,
): WorkstationReport {
  const body: WorkstationReport = { status: "running" };
  if (spec.access.web && ports.web !== undefined) {
    const query = spec.tokenQuery ?? (spec.tokenEnv ? KNOWN_TOKEN_QUERY[spec.tokenEnv] : undefined);
    const inUrl = !!token && !!query;
    let path = spec.access.web.path ?? (inUrl ? "/" : "");
    if (inUrl) path += `?${query}=${encodeURIComponent(token!)}`;
    if (relayed) body.webPath = path || "/";
    else body.endpoint = `http://${publicHost}:${ports.web}${path}`;
    if (token && !inUrl) body.webToken = token;
  }
  if (spec.access.ssh && ports.ssh !== undefined && !relayed) body.sshEndpoint = `${publicHost}:${ports.ssh}`;
  return body;
}

/** One entry of .data/volumes.json: a stopped workstation's volume, removed after keepUntil (ms epoch). */
export interface KeptVolume {
  id: string;
  keepUntil: number;
}

export const keepUntil = (now: number, keepDays: number) => now + keepDays * DAY_MS;

/** Volumes whose keep period is over and that no running workstation uses. */
export function dueVolumes(kept: KeptVolume[], now: number, inUse: Set<string>): string[] {
  return kept.filter((v) => v.keepUntil <= now && !inUse.has(v.id)).map((v) => v.id);
}
