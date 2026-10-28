/**
 * The handful of API calls the CLI makes, with the API's envelope ({ status: "success", ... } | { status: "error",
 * error: { code, message } }) turned into values and thrown errors.
 * shortcut: responses hand-typed for these calls, generate from GET /v1/doc when the surface grows (B-22).
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

export interface Deployment {
  id: string;
  name: string;
  kind: "static" | "container" | "workstation" | "endpoint";
  status: string;
  /** https://{id}.cloudana.run for sites and containers; null for workstations. */
  url: string | null;
  createdAt?: number;
  logs?: string;
}

export interface Created {
  id: string;
  priceUcldPerHour: number;
  priceUsdPerHour: number;
  deploymentStatus: string;
}

export interface Client {
  create(body: { name: string; kind: "static"; spec: { files: { path: string; contentBase64: string }[] } }): Promise<Created>;
  list(): Promise<Deployment[]>;
  get(id: string): Promise<{ deployment: Deployment; events: { at: number; level: string; message: string }[] }>;
  stop(id: string): Promise<void>;
}

export function client(api: string, apiKey: string, fetchFn: typeof fetch = fetch): Client {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchFn(`${api}/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, ...(body !== undefined && { "Content-Type": "application/json" }), "User-Agent": "cloudana-cli/0.1.0" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: { status?: string; error?: { code?: string; message?: string } } & Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new ApiError("bad_response", `${method} ${path}: HTTP ${res.status}, not JSON`, res.status);
    }
    if (!res.ok || json.status === "error") throw new ApiError(json.error?.code ?? `http_${res.status}`, json.error?.message ?? `HTTP ${res.status}`, res.status);
    return json as T;
  }
  return {
    create: (body) => call<Created>("POST", "/deployments", body),
    list: async () => (await call<{ deployments: Deployment[] }>("GET", "/deployments")).deployments,
    get: (id) => call("GET", `/deployments/${encodeURIComponent(id)}`),
    stop: async (id) => {
      await call("DELETE", `/deployments/${encodeURIComponent(id)}`);
    },
  };
}
