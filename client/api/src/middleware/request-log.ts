/**
 * Structured request logging with a correlation id.
 *
 * One JSON line per request so Cloudflare / container logs can be filtered
 * and joined. The id is Cloudflare's `cf-ray` when present (searchable in the
 * dashboard), otherwise a random one; it is echoed as `X-Request-Id` so a
 * client can quote it in a bug report.
 */
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { clientIp } from "./rate-limit.js";

export type RequestLogVariables = { requestId: string };

function newId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export const requestLog = createMiddleware(async (c: Context, next: Next) => {
  const id = c.req.header("cf-ray") ?? newId();
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  const started = Date.now();

  let thrown: unknown;
  try {
    await next();
  } catch (err) {
    thrown = err;
  }

  const status = thrown ? 500 : c.res.status;
  const line = {
    t: new Date(started).toISOString(),
    id,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status,
    ms: Date.now() - started,
    ip: clientIp(c),
    ua: c.req.header("user-agent")?.slice(0, 120),
    ...(thrown !== undefined ? { error: thrown instanceof Error ? thrown.message : String(thrown) } : {}),
  };
  // Health probes are noise; everything else is one line.
  if (line.path !== "/health") (status >= 500 ? console.error : console.log)(JSON.stringify(line));

  if (thrown) throw thrown;
});
