/**
 * HTTP middleware for Cloudana Provider Node
 * 
 * Provides:
 * - Request/response logging with correlation IDs
 * - Performance timing
 * - Error handling
 */
import type { Context, Next } from "hono";
import { logRequest, logResponse } from "./logger.js";
import { randomBytes } from "node:crypto";

/**
 * Generate unique request ID for correlation
 */
function generateRequestId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Logging middleware - logs all incoming requests and outgoing responses
 */
export async function loggingMiddleware(c: Context, next: Next) {
  const start = Date.now();
  const requestId = c.req.header("x-request-id") || generateRequestId();
  
  // Set request ID in response headers
  c.header("x-request-id", requestId);
  
  // Log incoming request
  logRequest({
    method: c.req.method,
    path: c.req.path,
    query: c.req.url.includes("?") ? c.req.url.split("?")[1] : undefined,
    headers: {
      "user-agent": c.req.header("user-agent") || "unknown",
      "content-type": c.req.header("content-type") || "unknown",
    },
    requestId,
  });
  
  // Store requestId in context for use in handlers
  c.set("requestId", requestId);
  
  // Execute request
  await next();
  
  // Log response
  const duration = Date.now() - start;
  logResponse({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
    requestId,
  });
}

/**
 * Error handling middleware - catches and logs errors
 */
export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    const requestId = c.get("requestId") as string | undefined;
    
    // Log error
    console.error({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      method: c.req.method,
      path: c.req.path,
      requestId,
    });
    
    // Return error response
    return c.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Internal server error",
        requestId,
      },
      500
    );
  }
}

/**
 * Get request ID from context
 */
export function getRequestId(c: Context): string | undefined {
  return c.get("requestId") as string | undefined;
}
