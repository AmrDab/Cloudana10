/**
 * Security middleware for HTTP security headers and basic protections.
 */
import type { Context, Next } from "hono";

/**
 * Add security headers to all responses
 */
export async function securityHeaders(c: Context, next: Next) {
  await next();
  
  // Prevent MIME type sniffing
  c.header("X-Content-Type-Options", "nosniff");
  
  // Enable XSS filter
  c.header("X-XSS-Protection", "1; mode=block");
  
  // Prevent clickjacking
  c.header("X-Frame-Options", "DENY");
  
  // Strict transport security (HTTPS only, 1 year)
  // Only set if connection is HTTPS
  const protocol = c.req.header("X-Forwarded-Proto") || "http";
  if (protocol === "https") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  
  // Content Security Policy
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; object-src 'none'"
  );
  
  // Referrer policy
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // Permissions policy (disable unnecessary features)
  c.header(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()"
  );
}

/**
 * Validate request body size to prevent DoS
 */
export function requestSizeLimit(maxSizeBytes: number = 10 * 1024 * 1024) {
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header("Content-Length");
    
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > maxSizeBytes) {
        return c.json(
          {
            status: "error",
            message: `Request body too large. Max size: ${maxSizeBytes} bytes`,
          },
          413
        );
      }
    }
    
    return next();
  };
}

/**
 * API key authentication middleware (for owner-only endpoints)
 */
export function requireApiKey() {
  return async (c: Context, next: Next) => {
    const apiKey = c.req.header("X-API-Key");
    const configuredKey = process.env.PROVIDER_API_KEY;
    
    if (!configuredKey) {
      // If no API key configured, allow (for development)
      return next();
    }
    
    if (!apiKey || apiKey !== configuredKey) {
      return c.json(
        {
          status: "error",
          message: "Unauthorized: Invalid or missing API key",
        },
        401
      );
    }
    
    return next();
  };
}

/**
 * Basic input sanitization for string inputs
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, "") // Remove angle brackets
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .trim();
}

/**
 * Validate namespace name to prevent injection
 */
export function isValidNamespace(namespace: string): boolean {
  // K8s namespace naming rules: lowercase alphanumeric + dashes, max 63 chars
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) && namespace.length <= 63;
}

/**
 * Validate workload/instance ID format
 */
export function isValidId(id: string): boolean {
  // Only allow alphanumeric and underscores/dashes
  return /^[a-zA-Z0-9_-]+$/.test(id) && id.length <= 64;
}
