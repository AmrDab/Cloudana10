/**
 * SDL (Stack Definition Language) parser for awesome-akash templates.
 * Parses SDL v2.0 YAML/JSON templates and extracts services, resources, ports, env vars.
 */
import yaml from "js-yaml";
import { log } from "../lib/logger.js";

const L = log.orchestratorEvent;

/** Expose entry: port mapping with optional global exposure */
export interface ParsedExpose {
  port: number;
  as: number;
  global?: boolean;
}

/** Parsed service definition */
export interface ParsedService {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  env?: string[];
  expose: ParsedExpose[];
  resources: {
    cpu: { units: number };
    memory: { size: string }; // e.g. "15Gb", "1Gi"
    storage: Array<{ size: string; class?: string; persistent?: boolean }>;
    gpu?: { units: number; vendor?: string };
  };
}

/** Parsed SDL manifest (awesome-akash format) */
export interface ParsedManifest {
  version: string;
  services: ParsedService[];
}

/** Resource requirements for placement matching */
export interface ResourceRequirements {
  cpu: bigint;
  memoryBytes: bigint;
  storageBytes: bigint;
  gpuCount: bigint;
}

/** Parse memory size string to bytes */
function parseMemoryToBytes(size: string): number {
  const sizeString = String(size || "512Mi").trim().toLowerCase();
  const sizeMatch = sizeString.match(/^(\d+(?:\.\d+)?)\s*(gi?b?|mi?b?|ti?b?|ki?b?)?$/i);
  if (!sizeMatch) return 512 * 1024 * 1024; // default 512Mi
  const numericValue = parseFloat(sizeMatch[1]);
  const sizeUnit = (sizeMatch[2] || "mi").toLowerCase();
  if (sizeUnit.startsWith("t")) return Math.floor(numericValue * 1024 * 1024 * 1024 * 1024);
  if (sizeUnit.startsWith("g")) return Math.floor(numericValue * 1024 * 1024 * 1024);
  if (sizeUnit.startsWith("m")) return Math.floor(numericValue * 1024 * 1024);
  if (sizeUnit.startsWith("k")) return Math.floor(numericValue * 1024);
  return Math.floor(numericValue);
}

/** Parse storage size string to bytes */
function parseStorageToBytes(size: string): number {
  return parseMemoryToBytes(size);
}

/**
 * Parse SDL YAML or JSON string into structured manifest.
 */
export function parseSDL(sdlYamlOrJson: string): ParsedManifest {
  L.info(`[SDL Parser] Starting SDL parse...`);
  
  if (!sdlYamlOrJson || typeof sdlYamlOrJson !== "string") {
    L.error(`[SDL Parser] ERROR: SDL content must be a non-empty string. Received type: ${typeof sdlYamlOrJson}`);
    throw new Error("SDL content must be a non-empty string");
  }

  const sdlContent = sdlYamlOrJson.trim();
  L.info(`[SDL Parser] Content length: ${sdlContent.length} characters`);
  L.info(`[SDL Parser] Content preview: ${sdlContent.slice(0, 100)}...`);
  
  let rawSdlData: Record<string, unknown>;

  try {
    if (sdlContent.startsWith("{")) {
      L.info(`[SDL Parser] Detected JSON format`);
      rawSdlData = JSON.parse(sdlContent) as Record<string, unknown>;
    } else {
      L.info(`[SDL Parser] Detected YAML format`);
      const loadedYaml = yaml.load(sdlContent);
      if (loadedYaml == null || typeof loadedYaml !== "object" || Array.isArray(loadedYaml)) {
        L.error(`[SDL Parser] ERROR: Parsed SDL must be an object. Got: ${typeof loadedYaml}, isArray: ${Array.isArray(loadedYaml)}`);
        throw new Error("Parsed SDL must be an object");
      }
      rawSdlData = loadedYaml as Record<string, unknown>;
    }
  } catch (error) {
    L.error(`[SDL Parser] ERROR: Failed to parse SDL - ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  const version = String(rawSdlData.version ?? "2.0");
  L.info(`[SDL Parser] Version: ${version}`);
  
  const servicesRaw = rawSdlData.services as Record<string, unknown>;
  const profilesRaw = rawSdlData.profiles as Record<string, unknown>;
  const deploymentRaw = rawSdlData.deployment as Record<string, unknown>;

  if (!servicesRaw || typeof servicesRaw !== "object") {
    L.error(`[SDL Parser] ERROR: SDL must have 'services'. Found: ${typeof servicesRaw}`);
    L.error(`[SDL Parser] SDL structure keys: ${Object.keys(rawSdlData).join(', ')}`);
    throw new Error("SDL must have 'services'");
  }
  
  L.info(`[SDL Parser] Found ${Object.keys(servicesRaw).length} service(s): ${Object.keys(servicesRaw).join(', ')}`)

  const computeProfiles = (profilesRaw?.compute as Record<string, unknown>) ?? {};
  const placementProfiles = (profilesRaw?.placement as Record<string, unknown>) ?? {};
  const deployment = (deploymentRaw ?? {}) as Record<string, Record<string, { profile: string; count: number }>>;

  const services: ParsedService[] = [];

  for (const [svcName, svcRaw] of Object.entries(servicesRaw)) {
    const srv = svcRaw as Record<string, unknown>;
    if (!srv || typeof srv !== "object") continue;

    const image = String(srv.image ?? "alpine:latest");
    const env = Array.isArray(srv.env) ? (srv.env as string[]) : [];

    const exposeRaw = (srv.expose ?? []) as Array<Record<string, unknown>>;
    const expose: ParsedExpose[] = exposeRaw.map((e) => {
      const port = Number(e.port ?? e.as ?? 80);
      const as = Number(e.as ?? e.port ?? port);
      const to = (e.to ?? []) as Array<{ global?: boolean }>;
      const global = to.some((t) => t && t.global === true);
      return { port, as, global };
    });

    // Resolve profile for this service from deployment section
    let profileName = svcName;
    for (const [_deploySvc, placementMap] of Object.entries(deployment)) {
      for (const [_placement, config] of Object.entries(placementMap ?? {})) {
        if (config?.profile) {
          profileName = config.profile;
          break;
        }
      }
    }

    const computeProfile = (computeProfiles[profileName] ?? computeProfiles[svcName]) as Record<string, unknown> | undefined;
    const resourcesRaw = (computeProfile?.resources ?? {}) as Record<string, unknown>;

    const cpuRaw = resourcesRaw.cpu as Record<string, unknown> | number | undefined;
    let cpuUnits = typeof cpuRaw === "number" ? cpuRaw : Number((cpuRaw as Record<string, unknown>)?.units ?? 1000);
    // Ensure valid number (avoid NaN)
    if (isNaN(cpuUnits) || cpuUnits <= 0) {
      L.warn(`Invalid CPU units for service ${svcName}, using default 1000`);
      cpuUnits = 1000;
    }

    const memRaw = resourcesRaw.memory as Record<string, string> | string | undefined;
    const memSize = typeof memRaw === "string" ? memRaw : String((memRaw as Record<string, string>)?.size ?? "512Mi");

    // Handle storage as either array (Akash v2.0) or object format
    const storageRaw = resourcesRaw.storage;
    let storage: Array<{ size: string; class?: string; persistent?: boolean }>;
    
    if (Array.isArray(storageRaw)) {
      // Array format: [{size: "1Gi", class: "default", persistent: true}, ...]
      storage = storageRaw.map((st) => {
        if (typeof st === "string") return { size: st };
        const s = st as Record<string, unknown>;
        const persistentVal = s.persistent;
        const persistent = persistentVal === true || String(persistentVal) === "true";
        return {
          size: String(s.size ?? "1Gi"),
          class: typeof s.class === "string" ? s.class : undefined,
          persistent,
        };
      });
    } else if (storageRaw && typeof storageRaw === "object") {
      // Object format: {size: "512Mi", class: "default"}
      const s = storageRaw as Record<string, unknown>;
      const persistentVal = s.persistent;
      const persistent = persistentVal === true || String(persistentVal) === "true";
      storage = [{
        size: String(s.size ?? "1Gi"),
        class: typeof s.class === "string" ? s.class : undefined,
        persistent,
      }];
    } else {
      // Default fallback
      storage = [{ size: "1Gi" }];
    }

    const gpuRaw = resourcesRaw.gpu as Record<string, unknown> | undefined;
    const gpuUnits = gpuRaw ? Number(gpuRaw.units ?? 0) : 0;

    services.push({
      name: svcName,
      image,
      command: Array.isArray(srv.command) ? (srv.command as string[]) : undefined,
      args: Array.isArray(srv.args) ? (srv.args as string[]) : undefined,
      env: env.length > 0 ? env : undefined,
      expose,
      resources: {
        cpu: { units: Math.max(1, cpuUnits) },
        memory: { size: memSize },
        storage,
        ...(gpuUnits > 0 && { gpu: { units: gpuUnits } }),
      },
    });
  }

  if (services.length === 0) {
    throw new Error("SDL must define at least one service");
  }

  L.info(`SDL parsed: ${services.length} service(s), version ${version}`);

  return {
    version,
    services,
  };
}

/**
 * Validate parsed SDL structure.
 */
export function validateSDL(parsed: ParsedManifest): { valid: boolean; errors: string[] } {
  L.info(`[SDL Validator] Starting validation...`);
  const errors: string[] = [];

  if (!parsed.version || (parsed.version !== "2.0" && parsed.version !== "2.1")) {
    const err = `SDL version must be 2.0 or 2.1 (found: ${parsed.version})`;
    L.error(`[SDL Validator] ERROR: ${err}`);
    errors.push(err);
  }

  if (!parsed.services || parsed.services.length === 0) {
    const err = "SDL must have at least one service";
    L.error(`[SDL Validator] ERROR: ${err}`);
    errors.push(err);
  }

  for (const svc of parsed.services ?? []) {
    if (!svc.image) {
      const err = `Service ${svc.name}: missing image`;
      L.error(`[SDL Validator] ERROR: ${err}`);
      errors.push(err);
    }
    if (!svc.resources?.cpu?.units) {
      const err = `Service ${svc.name}: missing CPU units`;
      L.error(`[SDL Validator] ERROR: ${err}`);
      errors.push(err);
    }
    if (!svc.resources?.memory?.size) {
      const err = `Service ${svc.name}: missing memory size`;
      L.error(`[SDL Validator] ERROR: ${err}`);
      errors.push(err);
    }
  }

  const result = {
    valid: errors.length === 0,
    errors,
  };
  
  if (result.valid) {
    L.success(`[SDL Validator] ✓ Validation passed`);
  } else {
    L.error(`[SDL Validator] ✗ Validation failed with ${errors.length} error(s)`);
  }
  
  return result;
}

/**
 * Extract resource requirements from parsed SDL for placement matching.
 * Aggregates across all services (first service for single-service workloads).
 */
export function extractResources(parsed: ParsedManifest): ResourceRequirements {
  if (!parsed.services || parsed.services.length === 0) {
    return {
      cpu: BigInt(1000),
      memoryBytes: BigInt(512 * 1024 * 1024),
      storageBytes: BigInt(10 * 1024 * 1024 * 1024),
      gpuCount: BigInt(0),
    };
  }

  let cpu = 0;
  let memoryBytes = 0;
  let storageBytes = 0;
  let gpuCount = 0;

  for (const svc of parsed.services) {
    cpu += svc.resources.cpu.units;
    memoryBytes += parseMemoryToBytes(svc.resources.memory.size);
    for (const st of svc.resources.storage ?? []) {
      storageBytes += parseStorageToBytes(st.size);
    }
    gpuCount += svc.resources.gpu?.units ?? 0;
  }

  return {
    cpu: BigInt(Math.max(1, cpu)),
    memoryBytes: BigInt(Math.max(512 * 1024 * 1024, memoryBytes)),
    storageBytes: BigInt(Math.max(1024 * 1024 * 1024, storageBytes)),
    gpuCount: BigInt(gpuCount),
  };
}

/**
 * Try to parse SDL from workload metadata (IPFS JSON).
 * Metadata may have: sdl (string), manifest (string), or raw services/profiles.
 */
export function parseSDLFromMetadata(metadata: Record<string, unknown>): ParsedManifest | null {
  L.info(`[SDL Parser] Attempting to parse SDL from metadata...`);
  L.info(`[SDL Parser] Metadata keys: ${Object.keys(metadata).join(', ')}`);
  
  const sdlStr = metadata.sdl ?? metadata.manifest;
  if (typeof sdlStr === "string" && sdlStr.trim()) {
    L.info(`[SDL Parser] Found SDL/manifest string (length: ${sdlStr.length})`);
    try {
      const result = parseSDL(sdlStr);
      L.success(`[SDL Parser] ✓ Successfully parsed from SDL/manifest string`);
      return result;
    } catch (e) {
      L.error(`[SDL Parser] ✗ Failed to parse sdl/manifest string:`, e instanceof Error ? e.message : e);
      L.error(`[SDL Parser] Content preview: ${String(sdlStr).slice(0, 200)}...`);
      return null;
    }
  }

  // Check if metadata is already a valid SDL-like structure
  if (metadata.version && metadata.services && typeof metadata.services === "object") {
    L.info(`[SDL Parser] Metadata appears to be SDL-like structure, attempting JSON stringify...`);
    try {
      const result = parseSDL(JSON.stringify(metadata));
      L.success(`[SDL Parser] ✓ Successfully parsed from metadata structure`);
      return result;
    } catch (e) {
      L.error(`[SDL Parser] ✗ Failed to parse metadata as SDL structure:`, e instanceof Error ? e.message : e);
      return null;
    }
  }

  L.warn(`[SDL Parser] ⚠ No valid SDL format found in metadata`);
  return null;
}
