/**
 * IPFS pinning route (server-side Pinata secret).
 *
 * POST /ipfs/pin  body: { content: object, name?: string }
 *   200 { status: "success", cid, url }
 *   400/413/502/503 error envelope
 *
 * Must be mounted behind requireAuth (reads c.get("jwtPayload")); that and the
 * rate limit are applied in middleware/security.ts.
 */
import { createRoute } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { ok, fail, errorMessage } from "../../lib/http.js";
import { log } from "../../lib/logger.js";
import type { AuthVariables } from "../../middleware/auth.js";
import {
  pinJson,
  MAX_PIN_BYTES,
  PinningNotConfiguredError,
  PinPayloadTooLargeError,
} from "../../services/ipfs-pin.service.js";
import { PinRequestSchema, PinResponseSchema } from "../../schemas/ipfs.schema.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

const L = log.ipfs;

export const ipfsRouter = createRouter();

/** Reject oversized bodies from the declared length before the body is read. */
const declaredSizeLimit = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (declared > MAX_PIN_BYTES + 1024) {
    return fail(c, "payload_too_large", `Request body too large (limit ${MAX_PIN_BYTES} bytes)`);
  }
  await next();
});

const pinRoute = createRoute({
  method: "post",
  path: "/ipfs/pin",
  tags: ["IPFS"],
  security: BEARER_AUTH,
  middleware: [declaredSizeLimit] as const,
  request: { body: { required: true, content: { "application/json": { schema: PinRequestSchema } } } },
  responses: responses({ 200: json(PinResponseSchema, "Content pinned") }, 400, 401, 413, 429, 502, 503),
});

ipfsRouter.openapi(pinRoute, async (c) => {
  const { content, name } = c.req.valid("json");
  const caller = c.get("jwtPayload")?.sub ?? "unknown";
  L.info(`[ipfs/pin] sub=${caller} name=${name ?? "(none)"}`);

  try {
    const { cid, url } = await pinJson(content, name);
    L.info(`[ipfs/pin] sub=${caller} cid=${cid}`);
    return ok(c, { cid, url });
  } catch (err) {
    const error = errorMessage(err);
    if (err instanceof PinPayloadTooLargeError) return fail(c, "payload_too_large", error);
    if (err instanceof PinningNotConfiguredError) return fail(c, "not_configured", error);
    L.error(`[ipfs/pin] sub=${caller} failed: ${error}`);
    return fail(c, "upstream_failed", "Failed to pin content to IPFS");
  }
});
