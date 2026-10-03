// Scroll-driven backdrop: one fixed photo per band, cross-faded as the band enters the viewport, with thin
// "data strings" drawn over it. Nothing to click; reduced motion = no fades, static strings.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Photo = { src: string; alt: string; position?: string };

const Ctx = createContext<{ setActive: (i: number) => void } | null>(null);

export function Backdrop({ photos, children }: { photos: Photo[]; children: ReactNode }) {
  const [active, setActive] = useState(-1); // -1 = no photo (hero, waitlist, footer)
  const value = useMemo(() => ({ setActive }), []);
  return (
    <Ctx.Provider value={value}>
      <div aria-hidden data-active={active} className="pointer-events-none fixed inset-0 -z-10 bg-bg">
        {photos.map((p, i) => (
          <img
            key={p.src}
            src={p.src}
            alt=""
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-settle motion-reduce:transition-none",
              active === i ? "opacity-100" : "opacity-0",
            )}
            style={{ objectPosition: p.position ?? "center" }}
          />
        ))}
        {/* Readability scrim: the photos are cinematic, the type must still win. */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,9,13,.86)_0%,rgba(7,9,13,.62)_45%,rgba(7,9,13,.28)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,13,.75)_0%,transparent_22%,transparent_78%,rgba(7,9,13,.8)_100%)]" />
        {active >= 0 && <Strings active={active} />}
      </div>
      {children}
    </Ctx.Provider>
  );
}

/** Marks a band as owning photo `index`; -1 clears the photo. */
export function useBackdrop(index: number) {
  const ctx = useContext(Ctx);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !ctx) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && ctx.setActive(index)),
      { rootMargin: "-45% 0px -45% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ctx, index]);
  return ref;
}

// Five great-circle-ish strings; odd bands mirror them so each photo gets its own geometry.
const PATHS = [
  "M-60,620 C240,520 420,700 720,560 S1180,380 1500,460",
  "M-60,700 C300,760 520,520 860,640 S1240,760 1500,620",
  "M-60,480 C200,420 480,600 760,440 S1120,300 1500,380",
  "M-60,560 C260,640 560,420 900,520 S1260,640 1500,540",
  "M-60,420 C160,520 440,380 740,480 S1140,560 1500,300",
];

function Strings({ active }: { active: number }) {
  const mirror = active % 2 === 1;
  return (
    <svg
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full [will-change:transform]"
    >
      <defs>
        <linearGradient id="str" x1="0" x2="1">
          <stop offset="0" stopColor="#F2A93B" stopOpacity=".0" />
          <stop offset=".25" stopColor="#F2A93B" stopOpacity=".9" />
          <stop offset=".75" stopColor="#3FD6C2" stopOpacity=".9" />
          <stop offset="1" stopColor="#3FD6C2" stopOpacity=".0" />
        </linearGradient>
      </defs>
      <g transform={mirror ? "translate(1440 0) scale(-1 1)" : undefined} fill="none" stroke="url(#str)" strokeLinecap="round">
        {PATHS.map((d, i) => (
          <g key={d}>
            <path d={d} strokeWidth="7" opacity=".10" />
            <path d={d} strokeWidth="3" opacity=".22" />
            <path d={d} strokeWidth="1" opacity=".8" className={i < 2 ? "string" : undefined} style={i < 2 ? { animationDelay: `${i * -12}s` } : undefined} />
          </g>
        ))}
      </g>
      <style>{`
        .string { stroke-dasharray: 14 26 220 40; animation: str-flow 36s linear infinite; }
        @keyframes str-flow { to { stroke-dashoffset: -300; } }
        @media (prefers-reduced-motion: reduce) { .string { animation: none; stroke-dasharray: none; } }
      `}</style>
    </svg>
  );
}
