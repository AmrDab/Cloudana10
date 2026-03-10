/**
 * Rate limiting middleware to prevent DoS attacks.
 */
import type { Context, Next } from "hono";
import { loggers } from "../logger.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window duration in ms */
  windowMs: number;
  /** Whether to skip rate limiting for health checks */
  skipHealthCheck?: boolean;
}

const defaultConfig: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
  skipHealthCheck: true,
};

/**
 * In-memory store for rate limit tracking.
 * In production, use Redis or similar for distributed rate limiting.
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Cleanup old entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // Clean every minute

/**
 * Get client identifier (IP address or forwarded IP)
 */
function getClientId(c: Context): string {
  // Check X-Forwarded-For header (when behind proxy/load balancer)
  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  
  // Check X-Real-IP header
  const realIp = c.req.header("X-Real-IP");
  if (realIp) {
    return realIp;
  }
  
  // Fallback to direct connection IP
  return "unknown";
}

/**
 * Rate limiting middleware factory
 */
export function rateLimiter(config: Partial<RateLimitConfig> = {}) {
  const cfg = { ...defaultConfig, ...config };
  
  return async (c: Context, next: Next) => {
    const path = c.req.path;
    
    // Skip rate limiting for health checks if configured
    if (cfg.skipHealthCheck && (path === "/health" || path === "/metrics")) {
      return next();
    }
    
    const clientId = getClientId(c);
    const now = Date.now();
    
    // Get or create rate limit entry
    let entry = rateLimitStore.get(clientId);
    
    if (!entry || entry.resetAt < now) {
      // Create new window
      entry = {
        count: 1,
        resetAt: now + cfg.windowMs,
      };
      rateLimitStore.set(clientId, entry);
      
      // Set rate limit headers
      c.header("X-RateLimit-Limit", String(cfg.maxRequests));
      c.header("X-RateLimit-Remaining", String(cfg.maxRequests - 1));
      c.header("X-RateLimit-Reset", new Date(entry.resetAt).toISOString());
      
      return next();
    }
    
    // Increment counter
    entry.count++;
    
    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(cfg.maxRequests));
    c.header("X-RateLimit-Remaining", String(Math.max(0, cfg.maxRequests - entry.count)));
    c.header("X-RateLimit-Reset", new Date(entry.resetAt).toISOString());
    
    // Check if limit exceeded
    if (entry.count > cfg.maxRequests) {
      loggers.http.warn(
        { clientId, count: entry.count, path },
        `Rate limit exceeded for ${clientId}`
      );
      
      return c.json(
        {
          status: "error",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        },
        429
      );
    }
    
    return next();
  };
}

/**
 * Stricter rate limiter for deploy endpoint (more expensive operation)
 */
export function deployRateLimiter() {
  return rateLimiter({
    maxRequests: 100,
    windowMs: 60 * 1000, // 10 deploys per minute max
    skipHealthCheck: false,
  });
}
