/**
 * Cloudana → Akash SDL Converter
 *
 * Converts Cloudana workload manifests into valid Akash SDL (Stack Definition Language) YAML.
 *
 * Akash SDL structure:
 * - `services`   — Docker images, ports, environment, commands
 * - `profiles`   — Resource requirements (CPU, memory, storage, GPU) and placement
 * - `deployment` — Maps services to placement profiles with replicas
 *
 * @see https://akash.network/docs/getting-started/stack-definition-language/
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CloudanaWorkload {
  /** Service/workload name (used as SDL service key, must be lowercase alphanumeric) */
  name?: string;
  /** Docker image reference (e.g. "nginx:latest", "ghcr.io/org/app:v1.2") */
  image: string;
  /** Container command override */
  command?: string[];
  /** Container args */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** CPU resource requirements */
  cpu?: CloudanaCpuRequirement;
  /** Memory resource requirements */
  memory?: CloudanaMemoryRequirement;
  /** Storage resource requirements */
  storage?: CloudanaStorageRequirement[];
  /** GPU resource requirements (optional) */
  gpu?: CloudanaGpuRequirement;
  /** Service port exposures */
  ports?: CloudanaPort[];
  /** Number of replicas */
  replicas?: number;
  /** Provider placement preferences */
  placement?: CloudanaPlacement;
  /** Maximum price per block in uakt (default: 1000 uakt/block ≈ $0.08/month per unit) */
  maxPriceUakt?: number;
}

export interface CloudanaCpuRequirement {
  /** Number of CPU cores / millicores (e.g. 0.5 = 500m, 1 = 1 core) */
  units: number;
}

export interface CloudanaMemoryRequirement {
  /** Memory size with optional unit suffix: Mi, Gi, etc. */
  size: string;
}

export interface CloudanaStorageRequirement {
  /** Storage size with optional unit suffix: Gi, Mi, etc. */
  size: string;
  /** Storage class (default: "default") */
  class?: "default" | "beta1" | "beta2" | "beta3";
  /** Mount path inside the container */
  mount?: string;
  /** Whether this is ephemeral (temporary) storage (default: false) */
  readOnly?: boolean;
}

export interface CloudanaGpuRequirement {
  /** Number of GPU units */
  units: number;
  /** GPU vendor (nvidia or amd) */
  vendor?: "nvidia" | "amd";
  /** Specific GPU model attributes (e.g. "rtx3080") */
  model?: string;
}

export interface CloudanaPort {
  /** Container port number */
  port: number;
  /** External port (default: same as port) */
  as?: number;
  /** "global" exposes to internet, "local" keeps internal (default: global) */
  global?: boolean;
  /** Protocol: TCP or UDP (default: TCP) */
  proto?: "TCP" | "UDP" | "http" | "https";
}

export interface CloudanaPlacement {
  /** Placement group name (default: "cloudana") */
  name?: string;
  /**
   * Preferred attributes (e.g. region: us-west).
   * Providers that match attributes get priority.
   */
  attributes?: Record<string, string>;
  /**
   * Require bids to be signed by specific auditors.
   * Use Akash foundation address for verified providers:
   * akash1365yvmc4s7awdyj3n2sav7xfx76adc6dnmlx63
   */
  signedBy?: string[];
}

export interface SDLConversionResult {
  /** Generated SDL YAML string */
  sdlYaml: string;
  /** Service name used in SDL (normalized) */
  serviceName: string;
  /** Placement group name used in SDL */
  placementName: string;
  /** Summary of resource allocation for logging */
  summary: {
    image: string;
    cpu: string;
    memory: string;
    storage: string;
    gpu?: string;
    ports: number[];
    replicas: number;
    estimatedPriceUakt: number;
  };
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CPU_UNITS = 0.5;
const DEFAULT_MEMORY_SIZE = "512Mi";
const DEFAULT_STORAGE_SIZE = "1Gi";
const DEFAULT_REPLICAS = 1;
const DEFAULT_PLACEMENT_NAME = "cloudana";
/** Default max price per block in uakt (~10 AKT/month for a small workload) */
const DEFAULT_MAX_PRICE_UAKT = 1000;
/** Akash Foundation auditor address for signed provider verification */
const AKASH_AUDITOR_ADDRESS = "akash1365yvmc4s7awdyj3n2sav7xfx76adc6dnmlx63";

// ─── Normalization Helpers ────────────────────────────────────────────────────

/**
 * Normalize a workload name to a valid SDL service key.
 * Must be lowercase letters, numbers, and hyphens only.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63) || "app";
}

/**
 * Normalize CPU units. Akash accepts:
 * - Decimal: 0.5, 1, 2
 * - Millicores: 500m, 1000m
 *
 * We always output decimal format.
 */
function normalizeCpu(cpu?: CloudanaCpuRequirement): string {
  if (!cpu) return DEFAULT_CPU_UNITS.toString();
  const units = cpu.units;
  if (units <= 0) throw new Error(`Invalid CPU units: ${units}`);
  return units.toString();
}

/**
 * Normalize memory size. Akash accepts: Mi, Gi (binary) or MB, GB.
 * We normalize to binary units.
 */
function normalizeMemory(memory?: CloudanaMemoryRequirement): string {
  if (!memory) return DEFAULT_MEMORY_SIZE;
  const size = memory.size.trim();
  // Validate has a unit
  if (!/^\d+(\.\d+)?\s*(Ki|Mi|Gi|Ti|K|M|G|T|KB|MB|GB|TB)?$/i.test(size)) {
    throw new Error(`Invalid memory size: ${size}. Use format like "512Mi" or "2Gi"`);
  }
  return normalizeByteUnit(size);
}

/**
 * Normalize storage size. Same format as memory.
 */
function normalizeStorage(size: string): string {
  const s = size.trim();
  if (!/^\d+(\.\d+)?\s*(Ki|Mi|Gi|Ti|K|M|G|T|KB|MB|GB|TB)?$/i.test(s)) {
    throw new Error(`Invalid storage size: ${s}. Use format like "1Gi" or "10Gi"`);
  }
  return normalizeByteUnit(s);
}

/**
 * Normalize byte unit strings to Akash-compatible format.
 * Converts SI (MB, GB) to binary (Mi, Gi).
 */
function normalizeByteUnit(size: string): string {
  return size
    .replace(/\s+/g, "")
    .replace(/KB$/i, "Ki")
    .replace(/MB$/i, "Mi")
    .replace(/GB$/i, "Gi")
    .replace(/TB$/i, "Ti");
}

/**
 * Compute an estimated price based on resources.
 * Rough heuristic: 1 CPU ≈ 100 uakt/block, 1Gi RAM ≈ 50 uakt/block.
 */
function estimatePrice(workload: CloudanaWorkload): number {
  const cpuUnits = workload.cpu?.units ?? DEFAULT_CPU_UNITS;
  const memGi = parseMemoryToGi(workload.memory?.size ?? DEFAULT_MEMORY_SIZE);
  const gpuUnits = workload.gpu?.units ?? 0;
  const base = Math.ceil(cpuUnits * 100 + memGi * 50 + gpuUnits * 2000);
  return Math.max(base, 100); // minimum 100 uakt/block
}

function parseMemoryToGi(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti|K|M|G|T)?i?$/i);
  if (!match) return 0.5;
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? "Mi").toLowerCase();
  const unitMap: Record<string, number> = {
    ki: 1 / (1024 * 1024),
    mi: 1 / 1024,
    gi: 1,
    ti: 1024,
    k: 1 / (1024 * 1024),
    m: 1 / 1024,
    g: 1,
    t: 1024,
  };
  return value * (unitMap[unit] ?? 1 / 1024);
}

// ─── SDL Builder ──────────────────────────────────────────────────────────────

/**
 * Convert a Cloudana workload manifest to an Akash SDL YAML string.
 *
 * @param workload - Cloudana workload requirements
 * @returns SDL YAML and metadata
 *
 * @example
 * const { sdlYaml } = convertToSDL({
 *   image: "nginx:latest",
 *   cpu: { units: 0.5 },
 *   memory: { size: "256Mi" },
 *   ports: [{ port: 80, global: true }],
 * });
 */
export function convertToSDL(workload: CloudanaWorkload): SDLConversionResult {
  const serviceName = normalizeName(workload.name ?? "app");
  const placementName = normalizeName(
    workload.placement?.name ?? DEFAULT_PLACEMENT_NAME
  );

  const cpuStr = normalizeCpu(workload.cpu);
  const memoryStr = normalizeMemory(workload.memory);
  const storageItems = workload.storage?.length
    ? workload.storage
    : [{ size: DEFAULT_STORAGE_SIZE }];
  const replicas = workload.replicas ?? DEFAULT_REPLICAS;
  const maxPrice = workload.maxPriceUakt ?? estimatePrice(workload);

  // ── services section ───────────────────────────────────────────────────────
  const servicesSection = buildServicesSection(serviceName, workload);

  // ── profiles section ───────────────────────────────────────────────────────
  const profilesSection = buildProfilesSection(
    serviceName,
    placementName,
    { cpuStr, memoryStr, storageItems, gpu: workload.gpu },
    workload.placement,
    maxPrice
  );

  // ── deployment section ─────────────────────────────────────────────────────
  const deploymentSection = buildDeploymentSection(serviceName, placementName, replicas);

  const sdlYaml = [
    "version: \"2.0\"",
    "",
    servicesSection,
    "",
    profilesSection,
    "",
    deploymentSection,
    "",
  ].join("\n");

  const portNumbers = (workload.ports ?? []).map((p) => p.port);
  const storageSize = storageItems.map((s) => normalizeStorage(s.size)).join(", ");

  return {
    sdlYaml,
    serviceName,
    placementName,
    summary: {
      image: workload.image,
      cpu: cpuStr,
      memory: memoryStr,
      storage: storageSize,
      gpu: workload.gpu
        ? `${workload.gpu.units}x ${workload.gpu.vendor ?? "nvidia"}`
        : undefined,
      ports: portNumbers,
      replicas,
      estimatedPriceUakt: maxPrice,
    },
  };
}

// ─── Section Builders ─────────────────────────────────────────────────────────

function buildServicesSection(serviceName: string, workload: CloudanaWorkload): string {
  const lines: string[] = ["services:"];
  lines.push(`  ${serviceName}:`);
  lines.push(`    image: ${workload.image}`);

  // Command override
  if (workload.command?.length) {
    lines.push("    command:");
    lines.push(`      - sh`);
    lines.push(`      - "-c"`);
    lines.push(`      - ${JSON.stringify(workload.command.join(" "))}`);
  }

  // Args
  if (workload.args?.length) {
    lines.push("    args:");
    for (const arg of workload.args) {
      lines.push(`      - ${JSON.stringify(arg)}`);
    }
  }

  // Environment variables
  if (workload.env && Object.keys(workload.env).length > 0) {
    lines.push("    env:");
    for (const [key, value] of Object.entries(workload.env)) {
      // Quote values that contain special chars
      const safeValue = /[:#\[\]{},|>&*?!'"@%@`]/.test(value)
        ? JSON.stringify(value)
        : value;
      lines.push(`      - ${key}=${safeValue}`);
    }
  }

  // Port exposures
  if (workload.ports?.length) {
    lines.push("    expose:");
    for (const p of workload.ports) {
      const external = p.as ?? p.port;
      const global = p.global !== false; // default: true
      const proto = (p.proto ?? "TCP").toUpperCase();
      lines.push(`      - port: ${p.port}`);
      lines.push(`        as: ${external}`);
      lines.push(`        proto: ${proto}`);
      lines.push(`        to:`);
      if (global) {
        lines.push(`          - global: true`);
      } else {
        lines.push(`          - service: ${serviceName}`);
      }
    }
  }

  return lines.join("\n");
}

function buildProfilesSection(
  serviceName: string,
  placementName: string,
  resources: {
    cpuStr: string;
    memoryStr: string;
    storageItems: CloudanaStorageRequirement[];
    gpu?: CloudanaGpuRequirement;
  },
  placement?: CloudanaPlacement,
  maxPrice = DEFAULT_MAX_PRICE_UAKT
): string {
  const lines: string[] = ["profiles:"];

  // Compute profile
  lines.push("  compute:");
  lines.push(`    ${serviceName}:`);
  lines.push(`      resources:`);
  lines.push(`        cpu:`);
  lines.push(`          units: ${resources.cpuStr}`);
  lines.push(`        memory:`);
  lines.push(`          size: ${resources.memoryStr}`);

  // Storage — first item is ephemeral, subsequent are persistent
  lines.push(`        storage:`);
  for (let i = 0; i < resources.storageItems.length; i++) {
    const item = resources.storageItems[i];
    const sizeStr = normalizeStorage(item.size);
    const storageClass = item.class ?? "default";

    if (i === 0 && storageClass === "default") {
      // Ephemeral storage (no class attribute needed)
      lines.push(`          - size: ${sizeStr}`);
    } else {
      lines.push(`          - size: ${sizeStr}`);
      lines.push(`            class: ${storageClass}`);
      if (item.mount) {
        lines.push(`            mount: ${item.mount}`);
      }
      if (item.readOnly) {
        lines.push(`            readOnly: true`);
      }
    }
  }

  // GPU (optional)
  if (resources.gpu && resources.gpu.units > 0) {
    lines.push(`        gpu:`);
    lines.push(`          units: ${resources.gpu.units}`);
    lines.push(`          attributes:`);
    lines.push(`            vendor:`);
    const vendor = resources.gpu.vendor ?? "nvidia";
    lines.push(`              ${vendor}:`);
    if (resources.gpu.model) {
      lines.push(`                - model: ${resources.gpu.model}`);
    } else {
      lines.push(`                - model: "*"`);
    }
  }

  // Placement profile
  lines.push("");
  lines.push("  placement:");
  lines.push(`    ${placementName}:`);

  // Attributes (optional provider requirements)
  const attrs = placement?.attributes ?? {};
  if (Object.keys(attrs).length > 0) {
    lines.push(`      attributes:`);
    for (const [k, v] of Object.entries(attrs)) {
      lines.push(`        ${k}: ${v}`);
    }
  }

  // Signed-by requirements (use Akash auditor by default for verified providers)
  const auditors = placement?.signedBy ?? [];
  if (auditors.length > 0) {
    lines.push(`      signedBy:`);
    lines.push(`        anyOf:`);
    for (const addr of auditors) {
      lines.push(`          - "${addr}"`);
    }
  }

  // Pricing
  lines.push(`      pricing:`);
  lines.push(`        ${serviceName}:`);
  lines.push(`          denom: uakt`);
  lines.push(`          amount: ${maxPrice}`);

  return lines.join("\n");
}

function buildDeploymentSection(
  serviceName: string,
  placementName: string,
  replicas: number
): string {
  return [
    "deployment:",
    `  ${serviceName}:`,
    `    ${placementName}:`,
    `      profile: ${serviceName}`,
    `      count: ${replicas}`,
  ].join("\n");
}

// ─── Preset Builders ─────────────────────────────────────────────────────────

/**
 * Quick SDL builder for a simple HTTP web service.
 */
export function buildWebServiceSDL(
  image: string,
  port = 80,
  opts: Partial<CloudanaWorkload> = {}
): SDLConversionResult {
  return convertToSDL({
    name: opts.name ?? "web",
    image,
    cpu: opts.cpu ?? { units: 0.5 },
    memory: opts.memory ?? { size: "512Mi" },
    storage: opts.storage ?? [{ size: "1Gi" }],
    ports: opts.ports ?? [{ port, as: port, global: true, proto: "TCP" }],
    env: opts.env,
    replicas: opts.replicas ?? 1,
    placement: opts.placement,
    maxPriceUakt: opts.maxPriceUakt,
  });
}

/**
 * Quick SDL builder for a GPU compute workload.
 */
export function buildGpuWorkloadSDL(
  image: string,
  gpuUnits: number,
  opts: Partial<CloudanaWorkload> = {}
): SDLConversionResult {
  return convertToSDL({
    name: opts.name ?? "gpu-worker",
    image,
    cpu: opts.cpu ?? { units: 4 },
    memory: opts.memory ?? { size: "8Gi" },
    storage: opts.storage ?? [{ size: "50Gi" }],
    gpu: opts.gpu ?? { units: gpuUnits, vendor: "nvidia" },
    ports: opts.ports ?? [],
    env: opts.env,
    replicas: opts.replicas ?? 1,
    placement: opts.placement,
    maxPriceUakt: opts.maxPriceUakt,
  });
}

/**
 * Validate that a Cloudana workload can be converted to SDL.
 * Returns a list of validation errors (empty = valid).
 */
export function validateWorkload(workload: CloudanaWorkload): string[] {
  const errors: string[] = [];

  if (!workload.image || workload.image.trim() === "") {
    errors.push("image is required");
  }

  if (workload.cpu && workload.cpu.units <= 0) {
    errors.push(`cpu.units must be positive (got ${workload.cpu.units})`);
  }

  if (workload.cpu && workload.cpu.units > 32) {
    errors.push(`cpu.units exceeds Akash max of 32 (got ${workload.cpu.units})`);
  }

  if (workload.replicas !== undefined && workload.replicas < 1) {
    errors.push(`replicas must be >= 1 (got ${workload.replicas})`);
  }

  if (workload.replicas !== undefined && workload.replicas > 100) {
    errors.push(`replicas exceeds maximum of 100 (got ${workload.replicas})`);
  }

  for (const port of workload.ports ?? []) {
    if (port.port < 1 || port.port > 65535) {
      errors.push(`invalid port number: ${port.port}`);
    }
    if (port.as !== undefined && (port.as < 1 || port.as > 65535)) {
      errors.push(`invalid external port number: ${port.as}`);
    }
  }

  return errors;
}
