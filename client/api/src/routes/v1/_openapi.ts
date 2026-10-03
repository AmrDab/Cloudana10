/**
 * Router plumbing shared by every v1 router: envelope-shaped validation errors,
 * envelope-shaped malformed-JSON errors, and response-doc helpers.
 */
import { OpenAPIHono, type z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { fail, failValidation } from "../../lib/http.js";
import type { AuthVariables } from "../../middleware/auth.js";
import { ErrorEnvelopeSchema } from "../../schemas/common.schema.js";

export const BEARER_AUTH = [{ BearerAuth: [] as string[] }];

export function createRouter<V extends object = AuthVariables>() {
  const router = new OpenAPIHono<{ Variables: V }>({
    defaultHook: (result, c) => {
      if (!result.success) return failValidation(c, result.error);
    },
  });
  // The body validator throws HTTPException(400) on unparseable JSON; answer it
  // in the envelope. Anything else keeps propagating to the app's handler.
  router.onError((err, c) => {
    if (err instanceof HTTPException && err.status === 400) return fail(c, "bad_request", "Invalid JSON body");
    throw err;
  });
  return router;
}

export function json<T extends z.ZodTypeAny>(schema: T, description: string) {
  return { description, content: { "application/json": { schema } } };
}

type ErrorResponseDoc = {
  description: string;
  content?: { "application/json": { schema: typeof ErrorEnvelopeSchema } };
};

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "Bad request or validation failed",
  401: "Missing or invalid bearer token",
  403: "Forbidden",
  404: "Not found",
  413: "Payload too large",
  422: "Unprocessable",
  429: "Rate limited",
  500: "Internal error",
  502: "Upstream service failed",
  503: "Not configured / unavailable",
};

/**
 * A route's `responses`: the given success docs plus the error envelope for each
 * listed status. The numeric index in the return type lets handlers return the
 * plain `Response` produced by ok()/fail().
 */
export function responses<T extends Record<number, { description: string }>>(
  success: T,
  ...errorStatuses: number[]
): T & Record<number, ErrorResponseDoc> {
  const out: Record<number, unknown> = { ...success };
  for (const s of errorStatuses) {
    out[s] = { description: ERROR_DESCRIPTIONS[s] ?? "Error", content: { "application/json": { schema: ErrorEnvelopeSchema } } };
  }
  return out as T & Record<number, ErrorResponseDoc>;
}
