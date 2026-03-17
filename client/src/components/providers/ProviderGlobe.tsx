import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Globe from "react-globe.gl";
import { useLocation } from "wouter";
import { providerUrls } from "@/lib/provider-urls";
import type { ClientProviderList } from "@/lib/provider-types";
import { getProviderDisplayName } from "@/lib/provider-utils";

const EARTH_IMG = "//unpkg.com/three-globe@2.31.1/example/img/earth-night.jpg";
const ATMOSPHERE_COLOR = "#00ffff";

type Props = {
  providers: ClientProviderList[];
  initialZoom?: number;
  initialCoordinates?: [number, number];
};

interface PointData {
  lat: number;
  lng: number;
  name: string;
  owner: string;
  deviceId: string;
  region: string;
  countryCode: string;
  isOnline: boolean;
}

interface RingData {
  lat: number;
  lng: number;
}

export function ProviderGlobe({
  providers,
  initialZoom = 1,
  initialCoordinates,
}: Props) {
  const globeRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 500 });
  const [hovered, setHovered] = useState<PointData | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [, setLocation] = useLocation();

  // Convert providers to globe point data
  const pointsData = useMemo<PointData[]>(() => {
    return (providers || [])
      .map((p) => ({
        lat: parseFloat(String(p.ipLat)),
        lng: parseFloat(String(p.ipLon)),
        name: getProviderDisplayName(p.name, p.owner),
        owner: p.owner,
        deviceId: p.deviceId ?? p.owner,
        region: p.ipRegion || "",
        countryCode: p.ipCountryCode || "",
        isOnline: !!p.isOnline,
      }))
      .filter((p) => !isNaN(p.lat) && !isNaN(p.lng));
  }, [providers]);

  // Rings for active providers — pulsing glow rings
  const ringsData = useMemo<RingData[]>(() => {
    return pointsData.filter((p) => p.isOnline).map((p) => ({ lat: p.lat, lng: p.lng }));
  }, [pointsData]);

  // Responsive sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initial camera + globe material
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const altitude = initialCoordinates ? Math.max(0.4, 3 - initialZoom * 0.5) : 2.2;
    const lat = initialCoordinates ? initialCoordinates[1] : 20;
    const lng = initialCoordinates ? initialCoordinates[0] : 0;
    setTimeout(() => {
      globe.pointOfView({ lat, lng, altitude }, 0);
      // Dim the globe slightly so provider lights pop
      const globeMat = globe.globeMaterial();
      if (globeMat) {
        globeMat.bumpScale = 10;
        globeMat.emissive = { r: 0.02, g: 0.02, b: 0.05 };
        globeMat.emissiveIntensity = 0.4;
      }
    }, 100);
  }, [initialCoordinates, initialZoom]);

  // Mouse tracking for tooltip
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }, []);

  const handlePointHover = useCallback((point: object | null) => {
    setHovered(point as PointData | null);
  }, []);

  const handlePointClick = useCallback(
    (point: object) => {
      const p = point as PointData;
      setLocation(providerUrls.detail(p.deviceId));
    },
    [setLocation]
  );

  const isDetailView = !!initialCoordinates;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full min-h-[480px]"
      onMouseMove={handleMouseMove}
    >
      <Globe
        ref={globeRef}
        width={dims.w}
        height={dims.h}
        globeImageUrl={EARTH_IMG}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor={ATMOSPHERE_COLOR}
        atmosphereAltitude={0.18}
        showAtmosphere={true}
        animateIn={true}
        // === Provider dots — larger, glowing ===
        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointColor={(d: any) => (d.isOnline ? "#22c55e" : "#ef4444")}
        pointAltitude={0.02}
        pointRadius={0.7}
        pointResolution={8}
        pointLabel=""
        onPointHover={handlePointHover}
        onPointClick={handlePointClick}
        enablePointerInteraction={true}
        // === Pulsing rings on active nodes ===
        ringsData={ringsData}
        ringLat="lat"
        ringLng="lng"
        ringColor={() => "#00ffcc"}
        ringMaxRadius={3}
        ringPropagationSpeed={2}
        ringRepeatPeriod={1400}
        ringAltitude={0.015}
        // === Rotation ===
        autoRotate={!isDetailView}
        autoRotateSpeed={0.3}
      />

      {/* Tooltip overlay */}
      {hovered && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg border border-cyan-500/20 bg-card/90 px-3 py-2.5 shadow-2xl backdrop-blur-md"
          style={{
            left: Math.min(mouse.x + 14, dims.w - 200),
            top: Math.max(mouse.y - 70, 8),
          }}
        >
          <div className="space-y-1">
            <div className="font-semibold text-sm">{hovered.name}</div>
            {(hovered.region || hovered.countryCode) && (
              <div className="text-muted-foreground text-xs">
                {[hovered.region, hovered.countryCode].filter(Boolean).join(", ")}
              </div>
            )}
            <div
              className={`text-xs font-semibold mt-1 ${
                hovered.isOnline ? "text-green-400" : "text-red-400"
              }`}
            >
              {hovered.isOnline ? "● Active" : "● Inactive"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
