/**
 * Error parsing for the Cloudana API.
 *
 * Current envelope:  { status: "error", error: { code, message, details? } }
 * Legacy shapes still understood (older deployments): { success: false, error: "…" },
 * { error: "…" }, { status: "error", message: "…" }, { status: "error", error: "…" }.
 */

export interface ApiErrorInfo {
  code?: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  code?: string;
  /** HTTP status; 0 when the request never got a response (network/CORS failure). */
  status: number;
  details?: unknown;

  constructor(status: number, info: ApiErrorInfo) {
    super(info.message);
    this.name = "ApiError";
    this.status = status;
    this.code = info.code;
    this.details = info.details;
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** Extract `{ code, message, details }` from any API error body (parsed JSON or raw text). */
export function readApiError(body: unknown, fallback: string): ApiErrorInfo {
  if (typeof body === "string") {
    const text = body.trim();
    return { message: text && text.length <= 300 && !text.startsWith("<") ? text : fallback };
  }
  if (!body || typeof body !== "object") return { message: fallback };

  const b = body as Record<string, unknown>;
  const e = b.error;
  if (e && typeof e === "object") {
    const eo = e as Record<string, unknown>;
    return {
      code: str(eo.code),
      message: str(eo.message) ?? fallback,
      ...(eo.details !== undefined && { details: eo.details }),
    };
  }
  // Legacy: string error; any extra top-level fields (e.g. cooldownMs) become `details`.
  const { error: _e, message: _m, success: _s, status: _st, ...extra } = b;
  return {
    message: str(e) ?? str(b.message) ?? fallback,
    ...(Object.keys(extra).length > 0 && { details: extra }),
  };
}

/** True when a parsed body is an error even though the HTTP status was 2xx. */
function isErrorBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.success === false || (b.status === "error" && b.error !== undefined);
}

/**
 * Read a Response as JSON, throwing `ApiError` for non-2xx responses or error bodies.
 * `fallback` is the message used when the body carries none.
 */
export async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // not JSON — keep the raw text
  }
  if (!res.ok || isErrorBody(body)) {
    throw new ApiError(res.status, readApiError(body, `${fallback} (HTTP ${res.status})`));
  }
  return body as T;
}

/** fetch() + readJson(); a network failure becomes `ApiError` with status 0. */
export async function fetchJson<T>(url: string, fallback: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ApiError(0, { message: `${fallback}: ${e instanceof Error ? e.message : String(e)}` });
  }
  return readJson<T>(res, fallback);
}
