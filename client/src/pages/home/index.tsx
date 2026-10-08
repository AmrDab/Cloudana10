// The homepage: a zoomable universe map centred on Proof (docs/UNIVERSE_SPEC.md). The old section files in this
// folder stay: the lab reuses several of them.
import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { captureReferral, WaitlistHost } from "@/components/waitlist";
import { Universe } from "./universe/Universe";

export default function HomePage() {
  useEffect(() => {
    captureReferral();
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <Universe />
      <WaitlistHost />
    </MotionConfig>
  );
}
