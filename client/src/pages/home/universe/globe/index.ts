// The globe engine for the homepage universe (docs/UNIVERSE_SPEC.md "v2"). Shell contract:
//   if (!webglAvailable()) → use the list view (or the 2D engine); else createGlobeEngine({ canvas, ... }).
// The canvas must be fresh (never had a 2D context) and sized by CSS; the engine adds a sibling overlay canvas
// for markers/labels and removes it on destroy().
export { createGlobeEngine } from "./engine";

/** True when this browser can create a WebGL context (cheap probe on a throwaway canvas). */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
