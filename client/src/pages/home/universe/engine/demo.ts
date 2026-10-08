// Throwaway dev harness: mount the engine on a canvas with console callbacks. Not used by the shell.

import type { UGraph, UniverseEngine } from "../types";
import { createEngine } from "./engine";

export function mountDemo(canvas: HTMLCanvasElement, graph: UGraph): UniverseEngine {
  const reducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const engine = createEngine({
    canvas,
    graph,
    reducedMotion,
    callbacks: {
      onSelect: (node) => console.log("select", node?.id ?? null),
      onHover: () => {},
      onCamera: () => {},
      onReveal: (node) => console.log("reveal", node.id),
    },
  });
  engine.start();
  return engine;
}
