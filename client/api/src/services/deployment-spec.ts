/**
 * Deployment specs and protocol price (docs/V3_CONTRACT.md §3).
 *
 *   StaticSpec    { files: { path, contentBase64 }[] }   index.html required; ≤ 2 MB decoded
 *   ContainerSpec { image, command?, env?, ports[], cpu (millicores), memMb, storageMb }   ≤ 32 KB as JSON
 *   WorkstationSpec = ContainerSpec & { gpu?, tier, maxHours, access, volume?, workdir? }   (docs/WORKSTATIONS.md §1)
 *
 * Price per hour (µCLD): static = PRICE_HOSTING_UCLD_PER_HOUR; container =
 *   ceil(cpu/1000 × CPU + memMb/1024 × MEM + storageMb/1024 × STORAGE), at least PRICE_HOSTING_UCLD_PER_HOUR.
 * Workstation = (container formula + gpu.count × GPU price of its class + volume.sizeGb × VOLUME)
 *   × (1 − INTERRUPTIBLE_DISCOUNT if interruptible), ceil, same floor. Class "any" is priced as consumer.
 */
import { z } from "@hono/zod-openapi";
import { getEnv } from "../config/env.js";

export const STATIC_MAX_BYTES = 2 * 1024 * 1024;
export const CONTAINER_SPEC_MAX_BYTES = 32 * 1024;
/**
 * D1 caps a row at 2,000,000 bytes, so the stored spec_json must stay under it
 * (base64 inflates by 4/3 — in practice ≈ 1.4 MB of decoded files).
 */
export const SPEC_JSON_MAX_BYTES = 1_900_000;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const FilePath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => !p.startsWith("/") && !p.startsWith("\\"), "path must be relative (no leading /)")
  .refine((p) => !p.split(/[\\/]/).includes(".."), "path must not contain ..")
  .refine((p) => !/[\0-\x1f]/.test(p), "path must not contain control characters");

export const StaticSpecSchema = z.object({
  files: z
    .array(z.object({ path: FilePath, contentBase64: z.string().regex(BASE64, "contentBase64 must be base64") }))
    .min(1)
    .max(1000),
});

const EnvKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, "env keys must match [A-Za-z_][A-Za-z0-9_]*");

export const ContainerSpecSchema = z.object({
  image: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]*$/, "image must be a Docker image reference"),
  command: z.array(z.string().max(1024)).max(32).optional(),
  env: z.record(EnvKey, z.string().max(4096)).optional(),
  ports: z
    .array(z.object({ container: z.number().int().min(1).max(65535), protocol: z.literal("tcp").optional() }))
    .min(1)
    .max(8),
  cpu: z.number().int().min(100).max(64_000),
  memMb: z.number().int().min(64).max(262_144),
  storageMb: z.number().int().min(64).max(1_048_576),
  /** The browser will PATCH sealedEnv after assignment: hold the start until it arrives. */
  expectsSecrets: z.boolean().optional(),
});

/** ssh-ed25519 / ssh-rsa / ecdsa-sha2-nistp* <base64> [comment] — printable ASCII only (it becomes an env value). */
export const SSH_PUBLIC_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/]+={0,3}( [ -~]{1,256})?$/;

const WorkstationFields = z.object({
  gpu: z
    .object({
      count: z.number().int().min(0).max(8),
      minVramGb: z.number().min(0).max(1024).optional(),
      class: z.enum(["any", "consumer", "datacenter"]).optional(),
    })
    .optional(),
  tier: z.enum(["on-demand", "interruptible"]),
  maxHours: z.number().int().min(1).max(720),
  access: z.object({
    web: z
      .object({
        port: z.number().int().min(1).max(65535),
        path: z.string().max(200).regex(/^\/[!-~]*$/, "path must start with /").optional(),
      })
      .optional(),
    ssh: z
      .object({
        publicKey: z.string().max(8192).regex(SSH_PUBLIC_KEY, "ssh publicKey must be 'ssh-ed25519|ssh-rsa|ecdsa-sha2-… <base64> [comment]'"),
        /** Login user shown in the ssh command. Default "root". */
        user: z.string().regex(/^[a-z_][a-z0-9_.-]{0,31}$/).optional(),
      })
      .optional(),
  }),
  volume: z.object({ sizeGb: z.number().int().min(1).max(500), keepDays: z.number().int().min(0).max(30) }).optional(),
  // Template run fields for the node agent (§5/§6); copied from the template at create when absent.
  /** Where the volume is mounted. Agent default /workspace. */
  workdir: z.string().max(200).regex(/^\/[A-Za-z0-9._\-/]*$/, "workdir must be an absolute path").optional(),
  /** Container port sshd listens on. Agent default 22. */
  sshPort: z.number().int().min(1).max(65535).optional(),
  /** Env var the node fills with a random web token (Jupyter, code-server). */
  tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, "tokenEnv must be an env key").optional(),
  /** How the token rides in the URL, e.g. "token" → ?token=<t>. Absent: the token cannot go in the URL (webToken). */
  tokenQuery: z.string().regex(/^[A-Za-z0-9_\-]{1,64}$/, "tokenQuery must be a query parameter name").optional(),
});

export const WorkstationSpecSchema = ContainerSpecSchema.merge(WorkstationFields).superRefine((s, ctx) => {
  if (!s.access.web && !s.access.ssh) {
    ctx.addIssue({ code: "custom", path: ["access"], message: "access.web or access.ssh is required" });
  }
  if (s.access.web && !s.ports.some((p) => p.container === s.access.web!.port)) {
    ctx.addIssue({ code: "custom", path: ["access", "web", "port"], message: "access.web.port must be one of ports" });
  }
});

export type StaticSpec = z.infer<typeof StaticSpecSchema>;
export type ContainerSpec = z.infer<typeof ContainerSpecSchema>;
export type WorkstationSpec = z.infer<typeof WorkstationSpecSchema>;
/** Stored kind (deployments.kind). A workstation is stored as "container" with deployments.workstation = 1. */
export type DeploymentKind = "static" | "container";
/** Kind as the API speaks it. */
export type ApiKind = DeploymentKind | "workstation";

/** Decoded byte length of a base64 string without decoding it. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export type SpecCheck =
  | { ok: true; spec: StaticSpec | ContainerSpec | WorkstationSpec }
  | { ok: false; code: "validation_failed" | "payload_too_large"; message: string; details?: unknown };

/** Validate a spec for its kind (shape, index.html, size limits). */
export function checkSpec(kind: ApiKind, raw: unknown): SpecCheck {
  if (kind === "static") {
    const parsed = StaticSpecSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    const files = parsed.data.files;
    const paths = new Set<string>();
    for (const f of files) {
      if (paths.has(f.path)) return { ok: false, code: "validation_failed", message: `spec.files: duplicate path "${f.path}"` };
      paths.add(f.path);
    }
    if (!paths.has("index.html")) return { ok: false, code: "validation_failed", message: "spec.files must include index.html" };
    const total = files.reduce((s, f) => s + base64Bytes(f.contentBase64), 0);
    if (total > STATIC_MAX_BYTES) {
      return { ok: false, code: "payload_too_large", message: `site is ${total} bytes; the limit is ${STATIC_MAX_BYTES}` };
    }
    if (JSON.stringify(parsed.data).length > SPEC_JSON_MAX_BYTES) {
      return { ok: false, code: "payload_too_large", message: `encoded site exceeds ${SPEC_JSON_MAX_BYTES} bytes (≈1.4 MB of files)` };
    }
    return { ok: true, spec: parsed.data };
  }
  const parsed = (kind === "workstation" ? WorkstationSpecSchema : ContainerSpecSchema).safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  if (JSON.stringify(parsed.data).length > CONTAINER_SPEC_MAX_BYTES) {
    return { ok: false, code: "payload_too_large", message: `container spec exceeds ${CONTAINER_SPEC_MAX_BYTES} bytes` };
  }
  return { ok: true, spec: parsed.data };
}

function invalid(err: z.ZodError): SpecCheck {
  const first = err.issues[0];
  const where = `spec${first?.path.length ? "." + first.path.join(".") : ""}: `;
  return { ok: false, code: "validation_failed", message: `${where}${first?.message ?? "invalid"}`, details: err.issues };
}

/** Protocol price in µCLD per hour. */
export function priceUcldPerHour(kind: ApiKind, spec: StaticSpec | ContainerSpec | WorkstationSpec): number {
  const env = getEnv();
  const min = env.PRICE_HOSTING_UCLD_PER_HOUR;
  if (kind === "static") return min;
  const c = spec as ContainerSpec;
  let raw =
    (c.cpu / 1000) * env.PRICE_CPU_UCLD_PER_HOUR +
    (c.memMb / 1024) * env.PRICE_MEM_UCLD_PER_GB_HOUR +
    (c.storageMb / 1024) * env.PRICE_STORAGE_UCLD_PER_GB_HOUR;
  if (kind === "workstation") {
    const w = spec as WorkstationSpec;
    const perGpu = w.gpu?.class === "datacenter" ? env.PRICE_GPU_DATACENTER_UCLD_PER_HOUR : env.PRICE_GPU_CONSUMER_UCLD_PER_HOUR;
    raw += (w.gpu?.count ?? 0) * perGpu + (w.volume?.sizeGb ?? 0) * env.PRICE_VOLUME_UCLD_PER_GB_HOUR;
    if (w.tier === "interruptible") raw *= 1 - env.INTERRUPTIBLE_DISCOUNT;
  }
  return Math.max(min, Math.ceil(raw - 1e-9));
}

/**
 * Spec as shown to its owner: container env values are replaced by the key list;
 * static file contents are replaced by their sizes (keeps list responses small).
 */
export function redactSpec(kind: DeploymentKind, spec: StaticSpec | ContainerSpec): Record<string, unknown> {
  if (kind === "static") {
    return { files: (spec as StaticSpec).files.map((f) => ({ path: f.path, bytes: base64Bytes(f.contentBase64) })) };
  }
  const { env, ...rest } = spec as ContainerSpec;
  return { ...rest, ...(env && { envKeys: Object.keys(env) }) };
}

/**
 * Endpoints the orchestrator may probe. Outside DEV_MODE, loopback / private / link-local hosts are
 * refused so a node cannot point the orchestrator's prober at internal services (SSRF). Hostnames
 * are not resolved here, so a public name that resolves to a private address is not caught.
 */
export function endpointAllowed(url: string, devMode: boolean): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (devMode) return true;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  if (host.includes(":")) {
    return !(host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:"));
  }
  return true;
}
