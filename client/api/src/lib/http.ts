/**
 * One response envelope for the whole API.
 *
 *   success → 2xx  { status: "success", ...data }
 *   failure → 4xx/5xx { status: "error", error: { code, message, details? } }
 *
 * `code` is a stable machine-readable identifier clients can branch on;
 * `message` is for humans and may change.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";

export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "payload_too_large"
  | "unprocessable"
  | "upstream_failed"
  | "not_configured"
  | "internal";

const STATUS_FOR: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  unprocessable: 422,
  upstream_failed: 502,
  not_configured: 503,
  internal: 500,
};

export interface ApiErrorBody {
  status: "error";
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function ok<T extends Record<string, unknown>>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ status: "success" as const, ...data }, status);
}

export function fail(c: Context, code: ErrorCode, message: string, details?: unknown) {
  const body: ApiErrorBody = { status: "error", error: { code, message, ...(details !== undefined && { details }) } };
  return c.json(body, STATUS_FOR[code]);
}

/** Zod issues → a single readable message plus the structured issue list. */
export function failValidation(c: Context, err: ZodError) {
  const first = err.issues[0];
  const where = first?.path.length ? `${first.path.join(".")}: ` : "";
  return fail(c, "validation_failed", `${where}${first?.message ?? "Validation failed"}`, err.issues);
}

/** Read and validate a JSON body in one step. */
export async function parseJson<T>(
  c: Context,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: ZodError } },
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: fail(c, "bad_request", "Invalid JSON body") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: failValidation(c, parsed.error) };
  return { ok: true, data: parsed.data };
}

/** Message for logs/clients from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
