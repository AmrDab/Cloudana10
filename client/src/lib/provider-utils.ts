/**
 * Helpers for provider list/detail (bytes, truncate, etc.)
 */

export function bytesToShrink(bytes: number): { value: number; unit: string } {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let u = 0;
  let v = bytes;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return { value: v, unit: units[u] };
}

export function roundDecimal(x: number, d: number): number {
  const m = 10 ** d;
  return Math.round(x * m) / m;
}

export function truncate(str: string, head = 6, tail = 4): string {
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}...${str.slice(-tail)}`;
}

/** Whether a string looks like a URI (IPFS, http, etc.) - not a human-readable name */
export function looksLikeUri(s: string | null | undefined): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim().toLowerCase();
  return t.startsWith("http://") || t.startsWith("https://") || t.startsWith("ipfs://") || t.startsWith("ipfs/") || t.includes("/ipfs/");
}

/**
 * Display name for a provider. Never use hostUri (IPFS/URL) as the name.
 * Prefer actual name from metadata; otherwise "Unnamed Provider" or truncated owner.
 */
export function getProviderDisplayName(name: string | null | undefined, owner: string): string {
  if (name && typeof name === "string" && name.trim() && !looksLikeUri(name)) return name.trim();
  if (owner && owner.startsWith("0x")) return `${owner.slice(0, 6)}…${owner.slice(-4)}`;
  return "Unnamed Provider";
}

export function hasParentWithClass(el: HTMLElement | null, className: string): boolean {
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.classList?.contains(className)) return true;
    cur = cur.parentElement;
  }
  return false;
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function uniqueGpuModels(models: { model: string }[] | undefined | null): string[] {
  if (!models || !Array.isArray(models)) return [];
  return unique(models.map((gpuModel) => gpuModel.model).filter(Boolean));
}
