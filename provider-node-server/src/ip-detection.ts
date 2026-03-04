/**
 * Dynamic IP detection for provider nodes
 * Automatically detects the node's public IP address
 */
import { loggers } from "./logger.js";
import * as os from "os";
import * as https from "https";

/**
 * Cached public IP to avoid repeated external lookups
 */
let cachedPublicIp: string | null = null;

/**
 * Get public IP from external service
 */
async function fetchPublicIpFromService(url: string, timeout = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      req.destroy();
      resolve(null);
    }, timeout);

    const req = https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        clearTimeout(timer);
        const ip = data.trim();
        // Validate IP format (basic IPv4 check)
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
          resolve(ip);
        } else {
          resolve(null);
        }
      });
    });

    req.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/**
 * Get the first non-internal IPv4 address from network interfaces
 */
function getLocalNetworkIp(): string | null {
  try {
    const networkInterfaces = os.networkInterfaces();
    
    // Prioritize interfaces (ethernet/wired first, then wireless)
    const priorityOrder = ["eth", "en", "wlan", "wlp"];
    
    for (const prefix of priorityOrder) {
      for (const [name, nets] of Object.entries(networkInterfaces)) {
        if (!name.toLowerCase().startsWith(prefix)) continue;
        if (!nets) continue;
        
        for (const net of nets) {
          // Skip internal/loopback and IPv6
          if (net.family === "IPv4" && !net.internal) {
            return net.address;
          }
        }
      }
    }
    
    // Fallback: any non-internal IPv4
    for (const nets of Object.values(networkInterfaces)) {
      if (!nets) continue;
      for (const net of nets) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
    
    return null;
  } catch (error) {
    loggers.server.debug({ error }, "Failed to get local network IP");
    return null;
  }
}

/**
 * Detect the node's public IP address dynamically
 * 
 * Strategy:
 * 1. Try to fetch from external services (for true public IP)
 * 2. Fall back to local network interfaces (for private networks)
 * 3. Cache result for performance
 * 
 * @param forceRefresh - Force refresh cached IP
 * @returns Public IP address or null if detection failed
 */
export async function detectPublicIp(forceRefresh = false): Promise<string | null> {
  // Return cached IP if available and not forcing refresh
  if (cachedPublicIp && !forceRefresh) {
    return cachedPublicIp;
  }

  loggers.server.debug("Detecting public IP address...");

  // Try multiple public IP detection services (in parallel for speed)
  const services = [
    "https://api.ipify.org",
    "https://icanhazip.com",
    "https://ifconfig.me/ip",
  ];

  const results = await Promise.all(
    services.map((url) => fetchPublicIpFromService(url, 3000))
  );

  // Use first successful result
  for (const ip of results) {
    if (ip) {
      cachedPublicIp = ip;
      loggers.server.info({ publicIp: ip }, "✓ Public IP detected from external service");
      return ip;
    }
  }

  // Fallback to local network IP
  const localIp = getLocalNetworkIp();
  if (localIp) {
    cachedPublicIp = localIp;
    loggers.server.info(
      { localIp },
      "⚠ Using local network IP (external services unreachable)"
    );
    return localIp;
  }

  loggers.server.warn("Failed to detect any IP address - service URLs may not work");
  return null;
}

/**
 * Get the cached public IP without triggering detection
 */
export function getCachedPublicIp(): string | null {
  return cachedPublicIp;
}

/**
 * Manually set the public IP (useful for testing or manual override)
 */
export function setPublicIp(ip: string): void {
  cachedPublicIp = ip;
  loggers.server.info({ publicIp: ip }, "Public IP manually set");
}
