import { useEffect, useRef, useCallback } from "react";
import createGlobe from "cobe";
import type { ClientProviderList } from "@/lib/provider-types";
import { cn } from "@/lib/utils";

interface ProviderGlobeProps {
  providers: ClientProviderList[];
  className?: string;
}

export function ProviderGlobe({ providers, className }: ProviderGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerInteracting = useRef<number | null>(null);
  const pointerInteractionMovement = useRef(0);
  const phiRef = useRef(0);
  const widthRef = useRef(0);

  const onlineCount = providers.filter((p) => p.isOnline).length;

  // Build marker list from provider lat/lon
  const markers = providers
    .filter((p) => p.ipLat && p.ipLon)
    .map((p) => ({
      location: [parseFloat(p.ipLat), parseFloat(p.ipLon)] as [number, number],
      size: p.isOnline ? 0.07 : 0.03,
    }));

  const onResize = useCallback(() => {
    if (canvasRef.current) {
      widthRef.current = canvasRef.current.offsetWidth;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    window.addEventListener("resize", onResize);
    onResize();

    const globe = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: widthRef.current * 2,
      height: widthRef.current * 2,
      phi: 0,
      theta: 0.25,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      baseColor: [0.15, 0.15, 0.2],
      markerColor: [0.4, 0.7, 1],
      glowColor: [0.08, 0.12, 0.25],
      markers,
      onRender: (state) => {
        // Auto-rotate unless user is dragging
        if (!pointerInteracting.current) {
          phiRef.current += 0.003;
        }
        state.phi = phiRef.current + pointerInteractionMovement.current;
        state.width = widthRef.current * 2;
        state.height = widthRef.current * 2;
      },
    });

    // Fade in the canvas
    setTimeout(() => {
      if (canvas) canvas.style.opacity = "1";
    }, 0);

    return () => {
      globe.destroy();
      window.removeEventListener("resize", onResize);
    };
  }, [markers.length]); // re-init when provider count changes

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      <canvas
        ref={canvasRef}
        className="w-full max-w-[350px] aspect-square transition-opacity duration-1000 opacity-0"
        style={{ contain: "layout paint size" }}
        onPointerDown={(e) => {
          pointerInteracting.current =
            e.clientX - pointerInteractionMovement.current;
          (e.target as HTMLCanvasElement).style.cursor = "grabbing";
        }}
        onPointerUp={(e) => {
          pointerInteracting.current = null;
          (e.target as HTMLCanvasElement).style.cursor = "grab";
        }}
        onPointerOut={(e) => {
          pointerInteracting.current = null;
          (e.target as HTMLCanvasElement).style.cursor = "grab";
        }}
        onMouseMove={(e) => {
          if (pointerInteracting.current !== null) {
            const delta = e.clientX - pointerInteracting.current;
            pointerInteractionMovement.current = delta / 200;
          }
        }}
        onTouchMove={(e) => {
          if (pointerInteracting.current !== null && e.touches[0]) {
            const delta = e.touches[0].clientX - pointerInteracting.current;
            pointerInteractionMovement.current = delta / 100;
          }
        }}
      />

      {/* Provider count overlay */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-card/80 backdrop-blur-md border border-white/10 px-4 py-1.5 text-sm">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-muted-foreground">
          <strong className="text-foreground">{onlineCount}</strong>{" "}
          provider{onlineCount !== 1 ? "s" : ""} online
        </span>
      </div>
    </div>
  );
}
