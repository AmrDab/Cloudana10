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

export const providerUrls = {
  list: (sort?: string) => `/providers${appendSearchParams({ sort })}`,
  detail: (owner: string) => `/providers/${owner}`,
  detailRaw: (owner: string) => `/providers/${owner}/raw`,
  detailEdit: (owner: string) => `/providers/${owner}/edit`,
} as const;
