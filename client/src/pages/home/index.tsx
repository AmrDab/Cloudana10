// The homepage: "Paper", a light editorial page (docs/HOMEPAGE.md). The old section files in this folder stay:
// the lab reuses several of them.
import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { captureReferral, WaitlistHost } from "@/components/waitlist";
import { Paper } from "./paper/Paper";

export default function HomePage() {
  useEffect(() => {
    captureReferral();
    document.title = "Cloudana — The proof is the work";
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <Paper />
      <WaitlistHost />
    </MotionConfig>
  );
}
