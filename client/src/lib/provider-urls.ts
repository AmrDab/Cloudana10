/**
 * Provider URL routes.
 */

export function appendSearchParams(params: Record<string, string | number | boolean | null | undefined> = {}): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") search.set(k, String(v));
  });
  const s = search.toString();
  return s ? `?${s}` : "";
}

/** Encode deviceId for URL (deviceId is the unique provider key). */
function encodeProviderId(id: string): string {
  return encodeURIComponent(id);
}

export const providerUrls = {
  list: (sort?: string) => `/providers${appendSearchParams({ sort })}`,
  register: () => "/provider",
  /** Provider detail by deviceId (unique key). */
  detail: (deviceId: string) => `/providers/${encodeProviderId(deviceId)}`,
  detailRaw: (deviceId: string) => `/providers/${encodeProviderId(deviceId)}/raw`,
  detailLogs: (deviceId: string) => `/providers/${encodeProviderId(deviceId)}/logs`,
  detailEdit: (deviceId: string) => `/providers/${encodeProviderId(deviceId)}/edit`,
} as const;
