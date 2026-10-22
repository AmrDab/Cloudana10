/**
 * Deployment specs and protocol price (docs/V3_CONTRACT.md §3).
 *
 *   StaticSpec    { files: { path, contentBase64 }[] }   index.html required; ≤ 2 MB decoded
 *   ContainerSpec { image, command?, env?, ports[], cpu (millicores), memMb, storageMb, placement? }   ≤ 32 KB as JSON
 *   WorkstationSpec = ContainerSpec & { gpu?, tier, maxHours, access, volume?, workdir? }   (docs/WORKSTATIONS.md §1)
 *
 * Price per hour, in US dollars (docs/PRICES_USD.md), converted to µCLD at USD_PER_CLD when the deployment is
 * created: static = PRICE_HOSTING; container = cpu/1000 × CPU + memMb/1024 × MEM + storageMb/1024 × STORAGE
 *   + gpu.count × the GPU price of its tier, at least PRICE_HOSTING.
 * Workstation = (container formula + volume.sizeGb × VOLUME) × (1 − INTERRUPTIBLE_DISCOUNT if interruptible).
 */
import { z } from "@hono/zod-openapi";
import { getEnv } from "../config/env.js";
import { WORKSTATION_TEMPLATES } from "./template-workstations.js";
import { GPU_TIERS, requestTier, type GpuTier } from "../../../../shared/gpu-tier.js";

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

/** A fleet id as routes/v1/fleets.ts issues it. */
export const FLEET_ID = /^flt_[0-9a-f]{16}$/;

const EnvKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, "env keys must match [A-Za-z_][A-Za-z0-9_]*");

const GpuSpec = z.object({
  count: z.number().int().min(0).max(8),
  minVramGb: z.number().min(0).max(1024).optional(),
  /** standard | large | h100 (default standard). Legacy any / consumer / datacenter are accepted and mapped (requestTier). */
  class: z.enum([...GPU_TIERS, "any", "consumer", "datacenter"]).optional(),
});

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
  /** Container user as "uid[:gid]" (numeric). Plain containers default to 1000:1000 on the node; workstations to the image's user. */
  user: z.string().regex(/^\d{1,7}(:\d{1,7})?$/, "user must be numeric uid[:gid]").optional(),
  /** GPUs handed to the container (explicit device indices on the node); priced per GPU-hour by class. */
  gpu: GpuSpec.optional(),
  /** The node reports `running` only once GET path answers 2xx/3xx (within startupGraceSec); probes GET it too. */
  health: z
    .object({
      path: z.string().max(200).regex(/^\/[A-Za-z0-9._~/?=&%-]*$/, "health.path must start with / and be a plain path").optional(),
      startupGraceSec: z.number().int().min(10).max(1800).optional(),
    })
    .optional(),
  /** B-9: run only on nodes of this fleet — the owner's own or a partner's, chosen by its id; never a single node. */
  placement: z.object({ fleetId: z.string().regex(FLEET_ID, "fleetId must be a fleet id (flt_ + 16 hex)") }).optional(),
});

/** GPU endpoint (docs/V4_ENDPOINTS_CONTRACT.md): a container spec with one port, replicas and visitor auth. */
export const EndpointSpecSchema = ContainerSpecSchema.omit({ ports: true }).extend({
  port: z.number().int().min(1).max(65535),
  replicas: z.number().int().min(1).max(8).default(1),
  auth: z.enum(["public", "key"]).default("key"),
});

/** ssh-ed25519 / ssh-rsa / ecdsa-sha2-nistp* <base64> [comment] — printable ASCII only (it becomes an env value). */
export const SSH_PUBLIC_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/]+={0,3}( [ -~]{1,256})?$/;

const WorkstationFields = z.object({
  tier: z.enum(["on-demand", "interruptible"]),
  maxHours: z.number().int().min(1).max(720),
  access: z.object({
    web: z
      .object({
        port: z.number().int().min(1).max(65535),
        // Same alphabet the node agent accepts (node-agent/src/workstation.ts WEB_PATH): a spec the API takes must never fail on the node.
        path: z.string().max(200).regex(/^\/[A-Za-z0-9._~/-]*$/, "path must start with / and use only [A-Za-z0-9._~/-]").optional(),
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
export type EndpointSpec = z.infer<typeof EndpointSpecSchema>;
/** Stored kind (deployments.kind). Workstations and endpoints are stored as "container" (workstation = 1 / replicas > 0). */
export type DeploymentKind = "static" | "container";
/** Kind as the API speaks it. */
export type ApiKind = DeploymentKind | "workstation" | "endpoint";

/** The container spec each replica of an endpoint runs (what the node receives). */
export function replicaSpec(e: EndpointSpec): ContainerSpec {
  const { port, replicas, auth, ...container } = e;
  void replicas;
  void auth;
  return { ...container, ports: [{ container: port }], health: { path: "/", startupGraceSec: 600, ...e.health } };
}

/** Decoded byte length of a base64 string without decoding it. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export type SpecCheck =
  | { ok: true; spec: StaticSpec | ContainerSpec | WorkstationSpec | EndpointSpec }
  | { ok: false; code: "validation_failed" | "payload_too_large"; message: string; details?: unknown };

/** Validate a spec for its kind (shape, index.html, size limits). */
export function checkSpec(kind: ApiKind, raw: unknown): SpecCheck {
  if (kind === "static") {
    // The static schema would strip it silently, and the owner would believe the site pinned.
    if (raw && typeof raw === "object" && "placement" in raw) {
      return { ok: false, code: "validation_failed", message: "spec.placement: static sites cannot be pinned to a fleet (any hosting node serves them); remove it" };
    }
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
  const parsed = (kind === "workstation" ? WorkstationSpecSchema : kind === "endpoint" ? EndpointSpecSchema : ContainerSpecSchema).safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  // One vocabulary from here on: the stored spec (and what nodes receive) names a tier.
  if (parsed.data.gpu) parsed.data.gpu.class = requestTier(parsed.data.gpu.class);
  // Workstations take no sealed secrets (the node issues their access token): a start held for a seal that can never
  // land would wait a day, pin the slot and fail — refuse the flag outright.
  if (kind === "workstation" && (parsed.data as { expectsSecrets?: boolean }).expectsSecrets !== undefined) {
    if ((parsed.data as { expectsSecrets?: boolean }).expectsSecrets === true) {
      return { ok: false, code: "validation_failed", message: "spec.expectsSecrets: workstations take no sealed secrets (the node issues the access token); remove it" };
    }
    delete (parsed.data as { expectsSecrets?: boolean }).expectsSecrets;
  }
  // Plain containers never run as root (the node refuses it too); workstations keep the image's user model.
  if (kind !== "workstation" && parsed.data.user && /^0(:|$)/.test(parsed.data.user)) {
    return { ok: false, code: "validation_failed", message: "spec.user: containers cannot run as root (uid 0)" };
  }
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

/** US dollars per GPU-hour for a tier. */
export function gpuPriceUsd(tier: GpuTier): number {
  const env = getEnv();
  return tier === "h100" ? env.PRICE_GPU_H100_USD_PER_HOUR : tier === "large" ? env.PRICE_GPU_LARGE_USD_PER_HOUR : env.PRICE_GPU_STANDARD_USD_PER_HOUR;
}

/** Protocol price in US dollars per hour (per replica for an endpoint). */
export function priceUsdPerHour(kind: ApiKind, spec: StaticSpec | ContainerSpec | WorkstationSpec | EndpointSpec): number {
  const env = getEnv();
  const min = env.PRICE_HOSTING_USD_PER_HOUR;
  if (kind === "static") return min;
  const c = spec as ContainerSpec;
  let usd =
    (c.cpu / 1000) * env.PRICE_CPU_USD_PER_HOUR +
    (c.memMb / 1024) * env.PRICE_MEM_USD_PER_GB_HOUR +
    (c.storageMb / 1024) * env.PRICE_STORAGE_USD_PER_GB_HOUR +
    (c.gpu?.count ?? 0) * gpuPriceUsd(requestTier(c.gpu?.class));
  if (kind === "workstation") {
    const w = spec as WorkstationSpec;
    usd += (w.volume?.sizeGb ?? 0) * env.PRICE_VOLUME_USD_PER_GB_HOUR;
    if (w.tier === "interruptible") usd *= 1 - env.INTERRUPTIBLE_DISCOUNT;
  }
  return Math.max(min, usd);
}

/** µCLD for a dollar amount at the reference rate, rounded up (a float sliver never adds a µCLD). */
export function usdToUcld(usd: number): number {
  return Math.ceil((usd * 1e6) / getEnv().USD_PER_CLD - 1e-6);
}

/** Protocol price in µCLD per hour: the dollar price at the reference rate (per replica for an endpoint). */
export function priceUcldPerHour(kind: ApiKind, spec: StaticSpec | ContainerSpec | WorkstationSpec | EndpointSpec): number {
  return usdToUcld(priceUsdPerHour(kind, spec));
}

/**
 * Spec as shown to its owner: container env values are replaced by the key list;
 * static file contents are replaced by their sizes (keeps list responses small).
 */
export function redactSpec(kind: DeploymentKind, spec: StaticSpec | ContainerSpec | EndpointSpec): Record<string, unknown> {
  if (kind === "static") {
    return { files: (spec as StaticSpec).files.map((f) => ({ path: f.path, bytes: base64Bytes(f.contentBase64) })) };
  }
  const { env, ...rest } = spec as ContainerSpec | EndpointSpec;
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

let curatedImages: Set<string> | null = null;
/** Curated images (workstation templates) plus IMAGE_ALLOWLIST (comma-separated regexes, optional env). */
export function imageAllowed(image: string): boolean {
  curatedImages ??= new Set(WORKSTATION_TEMPLATES.map((t) => t.image).filter((i): i is string => !!i));
  if (curatedImages.has(image)) return true;
  const extra = process.env.IMAGE_ALLOWLIST?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return extra.some((re) => {
    try {
      return new RegExp(`^(?:${re})$`).test(image);
    } catch {
      return false;
    }
  });
}
