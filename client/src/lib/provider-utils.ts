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

export function uniqueGpuModels(models: { model: string }[]): string[] {
  return unique(models.map((x) => x.model).filter(Boolean));
}
