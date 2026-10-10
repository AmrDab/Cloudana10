import { useId } from "react";
import { cn } from "@/lib/utils";

/** The Cloudana mark: a cloud drawn as two interlocking traces, each ending in a node — chain blue into verified teal. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  const g = useId();
  return (
    <svg width={size} height={size} viewBox="4 3 24 24" aria-hidden="true" className={cn("cld-mark shrink-0", className)}>
      <defs>
        <linearGradient id={g} x1="5" y1="24" x2="27" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5B8DEF" />
          <stop offset="1" stopColor="#3FD6C2" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${g})`} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 14.5H10a4.75 4.75 0 0 0 0 9.5h7" />
        <path d="M13.5 19.5H22a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 10.2 12" />
      </g>
      <circle cx="19" cy="14.5" r="2" fill="var(--c-bg)" stroke="#3FD6C2" strokeWidth="1.6" />
      <circle cx="13.5" cy="19.5" r="2" fill="var(--c-bg)" stroke="#5B8DEF" strokeWidth="1.6" />
    </svg>
  );
}

/** Mark + wordmark, linking home. */
export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <a href={href} aria-label="Cloudana home" className={cn("flex items-center gap-2 font-head text-base font-semibold tracking-[.06em] text-text", className)}>
      <LogoMark size={26} />
      CLOUDANA
    </a>
  );
}
