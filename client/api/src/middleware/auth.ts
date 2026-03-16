/**
 * JWT authentication middleware for Cloudana API.
 * Protects sensitive endpoints (build-provider, deploy, admin operations).
 */
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";

const JWT_SECRET = process.env.JWT_SECRET || "cloudana-dev-secret-change-in-production";

export interface JWTPayload {
  sub: string;         // wallet address
  role: "user" | "provider" | "admin";
  iat: number;
  exp: number;
}

/**
 * Middleware: require a valid JWT Bearer token.
 * Sets c.set("jwtPayload", payload) on success.
 */
export const requireAuth = createMiddleware(async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ status: "error", message: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verify(token, JWT_SECRET) as JWTPayload;
    c.set("jwtPayload", payload);
    return next();
  } catch {
    return c.json({ status: "error", message: "Invalid or expired token" }, 401);
  }
});

/**
 * Middleware: require a specific role.
 * Must be used AFTER requireAuth.
 */
export function requireRole(...roles: JWTPayload["role"][]) {
  return createMiddleware(async (c: Context, next: Next) => {
    const payload = c.get("jwtPayload") as JWTPayload | undefined;
    if (!payload || !roles.includes(payload.role)) {
      return c.json({ status: "error", message: "Insufficient permissions" }, 403);
    }
    return next();
  });
}

/**
 * Generate a JWT token for a wallet address.
 * Used by the auth/login endpoint after wallet signature verification.
 */
export async function generateToken(walletAddress: string, role: JWTPayload["role"] = "user"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    sub: walletAddress.toLowerCase(),
    role,
    iat: now,
    exp: now + 24 * 60 * 60, // 24 hours
  };
  return sign(payload, JWT_SECRET);
}
