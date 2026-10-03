// React host for the globe scene: lazy-loads Three.js, renders only while on screen and the tab is
// visible, and draws a single still frame under prefers-reduced-motion.
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Globe } from "./scene";

export function NetworkGlobe({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let globe: Globe | null = null;
    let raf = 0, visible = false, last = 0, disposed = false;

    const loop = (now: number) => {
      raf = 0;
      if (!globe || !visible || document.hidden) return;
      globe.frame(Math.min((now - last) / 1000, 0.05));
      last = now;
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (raf || !globe || reduce) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
    });
    const onVis = () => !document.hidden && start();

    import("./scene").then(({ createGlobe }) => {
      if (disposed) return;
      globe = createGlobe(el, { reduce });
      globe.frame(0);
      if (reduce) return;
      io.observe(el);
      document.addEventListener("visibilitychange", onVis);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      globe?.dispose();
    };
  }, []);
  return <div ref={ref} aria-hidden className={cn("relative aspect-square", className)} />;
}
