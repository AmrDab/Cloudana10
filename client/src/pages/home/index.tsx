// The homepage: globe hero, then six bold bands over a scroll-driven photo backdrop, then status + waitlist.
// Nothing interactive here except CTAs — the live instruments live at /lab.
import { useEffect, type ReactNode, type RefObject } from "react";
import { MotionConfig } from "motion/react";
import { captureReferral, WaitlistHost } from "@/components/waitlist";
import { SiteNav } from "./nav";
import { Hero } from "./hero";
import { Backdrop, useBackdrop, type Photo } from "./backdrop";
import { Statement, Roles, Pays, ServicesBand, SecurityBand, ProvideBand } from "./bands";
import { StatusGates } from "./status";
import { WaitlistSection } from "./waitlist";
import { SiteFooter } from "./footer";

// Photos: client/public/bg/*.webp (licensed; see client/public/bg/ATTRIBUTION.md).
const PHOTOS: Photo[] = [
  { src: "/bg/valley.webp", alt: "", position: "center 60%" },
  { src: "/bg/fiber.webp", alt: "" },
  { src: "/bg/aurora.webp", alt: "", position: "center 30%" },
  { src: "/bg/datacenter.webp", alt: "" },
  { src: "/bg/ocean.webp", alt: "" },
  { src: "/bg/city.webp", alt: "" },
];

/** Bands with no photo (hero, status, waitlist, footer) clear the backdrop. */
function Solid({ children }: { children: ReactNode }) {
  const ref = useBackdrop(-1);
  return <div ref={ref as RefObject<HTMLDivElement>}>{children}</div>;
}

export default function HomePage() {
  useEffect(() => {
    captureReferral();
    document.title = "Cloudana — The proof is the work";
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <Backdrop photos={PHOTOS}>
        <div className="min-h-dvh overflow-x-clip text-text">
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2">
            Skip to content
          </a>
          <SiteNav />
          <main id="main">
            <Solid><Hero /></Solid>
            <Statement />
            <Roles />
            <Pays />
            <ServicesBand />
            <SecurityBand />
            <ProvideBand />
            <Solid>
              <StatusGates />
              <WaitlistSection />
            </Solid>
          </main>
          <Solid><SiteFooter /></Solid>
          <WaitlistHost />
        </div>
      </Backdrop>
    </MotionConfig>
  );
}
