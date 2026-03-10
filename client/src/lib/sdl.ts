import yaml from "js-yaml";

/**
 * Parse deploy config string (YAML or JSON) into a JSON object.
 * Use this when the user provides YAML (e.g. version: "2.0" ...) or raw JSON.
 */
export function parseDeployToJson(raw: string): Record<string, unknown> {
  const s = raw?.trim() || "";
  if (!s) throw new Error("Deploy configuration is empty.");

  if (s.startsWith("{")) {
    return JSON.parse(s) as Record<string, unknown>;
  }

  const loaded = yaml.load(s);
  if (loaded == null || typeof loaded !== "object" || Array.isArray(loaded)) {
    throw new Error("Parsed deploy config must be an object.");
  }
  return loaded as Record<string, unknown>;
}

/**
 * Standalone SDL validation function
 * Input: JSON object (SDL structure)
 * Output: boolean (true if valid, false if invalid)
 */

interface SDLInput {
  version?: string;
  services?: Record<string, any>;
  profiles?: {
    compute?: Record<string, any>;
    placement?: Record<string, any>;
  };
  deployment?: Record<string, Record<string, any>>;
  endpoints?: Record<string, any>;
}

export function validateSDL(json: any): boolean {
  // Must be an object
  // if (!json || typeof json !== "object" || Array.isArray(json)) {
  //   return false;
  // }

  // Version must be "2.0" or "2.1"
  if (!json.version || (json.version !== "2.0" && json.version !== "2.1")) {
    console.log("version error", json.version);
    return false;
  }

  // Must have services
  if (!json.services || typeof json.services !== "object" || Array.isArray(json.services)) {
    console.log("services error", json.services);
    return false;
  }

  // Must have profiles
  if (!json.profiles || typeof json.profiles !== "object" || Array.isArray(json.profiles)) {
    return false;
  }

  // Must have compute and placement profiles
  if (!json.profiles.compute || typeof json.profiles.compute !== "object" || Array.isArray(json.profiles.compute)) {
    console.log("compute error", json.profiles.compute);
    return false;
  }

  if (!json.profiles.placement || typeof json.profiles.placement !== "object" || Array.isArray(json.profiles.placement)) {
    console.log("placement error", json.profiles.placement);
    return false;
  }

  // Must have deployment
  if (!json.deployment || typeof json.deployment !== "object" || Array.isArray(json.deployment)) {
    console.log("deployment error", json.deployment);
    return false;
  }

  const serviceNames = Object.keys(json.services);
  const deploymentNames = Object.keys(json.deployment);

  // Every service must have a deployment entry
  for (const serviceName of serviceNames) {
    if (!json.deployment[serviceName]) {
      return false;
    }

    const service = json.services[serviceName];
    
    // Service must have image
    if (!service || typeof service !== "object" || !service.image || typeof service.image !== "string") {
      return false;
    }

    // Validate deployment for this service
    const serviceDeployments = json.deployment[serviceName];
    if (!serviceDeployments || typeof serviceDeployments !== "object" || Array.isArray(serviceDeployments)) {
      return false;
    }

    for (const deploymentName of Object.keys(serviceDeployments)) {
      const deployment = serviceDeployments[deploymentName];
      
      // Deployment must have profile and count
      if (!deployment || typeof deployment !== "object" || 
          !deployment.profile || typeof deployment.profile !== "string" ||
          typeof deployment.count !== "number" || deployment.count < 1) {
        return false;
      }

      const profileName = deployment.profile;

      // Profile must exist in compute
      if (!json.profiles.compute[profileName]) {
        return false;
      }

      // Placement must exist
      if (!json.profiles.placement[deploymentName]) {
        return false;
      }

      const compute = json.profiles.compute[profileName];
      const placement = json.profiles.placement[deploymentName];

      // Compute must have resources
      if (!compute.resources || typeof compute.resources !== "object") {
        return false;
      }

      // Resources must have cpu, memory, storage
      if (!compute.resources.cpu || typeof compute.resources.cpu !== "object") {
        return false;
      }

      if (typeof compute.resources.cpu.units === "undefined") {
        return false;
      }

      if (!compute.resources.memory || typeof compute.resources.memory !== "object" || 
          !compute.resources.memory.size || typeof compute.resources.memory.size !== "string") {
        return false;
      }

      if (!compute.resources.storage) {
        return false;
      }

      // Storage validation
      const storages = Array.isArray(compute.resources.storage) 
        ? compute.resources.storage 
        : [compute.resources.storage];

      for (const storage of storages) {
        if (!storage || typeof storage !== "object") {
          return false;
        }

        if (!storage.size || typeof storage.size !== "string") {
          return false;
        }

        // RAM storage cannot be persistent
        if (storage.attributes?.class === "ram" && storage.attributes?.persistent) {
          return false;
        }

        // Persistent storage must have mount in service params
        const isPersistent = storage.attributes?.persistent === true || 
                            storage.attributes?.persistent === "true";
        
        if (isPersistent && storage.name) {
          if (!service.params?.storage?.[storage.name]?.mount) {
            return false;
          }
        }
      }

      // GPU validation
      if (compute.resources.gpu) {
        const gpu = compute.resources.gpu;
        const hasUnits = gpu.units !== undefined && gpu.units !== 0;
        const hasAttributes = gpu.attributes !== undefined;
        const hasVendor = hasAttributes && gpu.attributes?.vendor !== undefined;

        // If units > 0, must have attributes and vendor
        if (hasUnits && (!hasAttributes || !hasVendor)) {
          return false;
        }

        // If has attributes but units is 0, invalid
        if (hasAttributes && !hasUnits) {
          return false;
        }
      }

      // Placement must have pricing
      if (!placement.pricing || typeof placement.pricing !== "object" || Array.isArray(placement.pricing)) {
        return false;
      }

      // Pricing must exist for this profile
      if (!placement.pricing[profileName]) {
        return false;
      }

      const pricing = placement.pricing[profileName];

      // Pricing must have amount and denom
      if (typeof pricing.amount === "undefined" || !pricing.denom || typeof pricing.denom !== "string") {
        return false;
      }

      // Denom must be valid (uakt or ibc/...)
      if (pricing.denom !== "uakt" && !pricing.denom.startsWith("ibc/")) {
        return false;
      }
    }
  }
  
  console.log("validate service storage references");
  // Validate service storage references
  for (const serviceName of serviceNames) {
    const service = json.services[serviceName];
    const serviceDeployments = json.deployment[serviceName];

    if (service.params?.storage && typeof service.params.storage === "object") {
      for (const deploymentName of Object.keys(serviceDeployments)) {
        const deployment = serviceDeployments[deploymentName];
        const compute = json.profiles.compute[deployment.profile];
        const storages = Array.isArray(compute.resources.storage) 
          ? compute.resources.storage 
          : [compute.resources.storage];

        for (const storageName of Object.keys(service.params.storage)) {
          // Storage name must exist in compute resources
          const storageExists = storages.some((s: any) => s.name === storageName || (!s.name && !storageName));
          if (!storageExists) {
            return false;
          }
        }
      }
    }
  }
  console.log("validate expose and endpoints");
  // Validate expose and endpoints
  const endpointsUsed = new Set<string>();

  for (const serviceName of serviceNames) {
    const service = json.services[serviceName];
    
    if (service.expose && Array.isArray(service.expose)) {
      for (const expose of service.expose) {
        if (!expose || typeof expose !== "object") {
          return false;
        }

        // Must have port
        if (typeof expose.port !== "number" || expose.port < 1 || expose.port > 65535) {
          return false;
        }

        // If has 'to' array, validate it
        if (expose.to && Array.isArray(expose.to)) {
          for (const to of expose.to) {
            if (to && typeof to === "object") {
              // If IP is declared, must be global
              if (to.ip && !to.global) {
                return false;
              }

              // If IP is declared, endpoint must exist
              if (to.ip) {
                if (!json.endpoints || !json.endpoints[to.ip]) {
                  return false;
                }
                endpointsUsed.add(to.ip);
              }
            }
          }
        }
      }
    }
  }
  console.log("validate endpoints used");
  // All declared endpoints must be used
  if (json.endpoints && typeof json.endpoints === "object" && !Array.isArray(json.endpoints)) {
    for (const endpointName of Object.keys(json.endpoints)) {
      if (!endpointsUsed.has(endpointName)) {
        return false;
      }

      const endpoint = json.endpoints[endpointName];
      if (!endpoint || typeof endpoint !== "object" || endpoint.kind !== "ip") {
        return false;
      }
    }
  }

  console.log("validate sdl success");
  return true;
}
