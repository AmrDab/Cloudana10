// Section ids on the homepage, plus the old anchors (/#services …, still linked from the lab's nav) that map onto them.

export const SECTIONS = ["network", "how", "run", "provide", "verify", "cld", "security", "waitlist"] as const;

const LEGACY: Record<string, (typeof SECTIONS)[number]> = {
  services: "run",
  pays: "cld",
  status: "network",
};

/** The section a URL hash points at, or null when it names nothing on the page. */
export function sectionFor(hash: string): string | null {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  const target = LEGACY[id] ?? id;
  return (SECTIONS as readonly string[]).includes(target) ? target : null;
}
