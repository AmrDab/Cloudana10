import { cn } from "@/lib/utils";

/** The Cloudana mark: a 2×2 block grid — one block working (amber), one verified (teal). */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className={cn("shrink-0", className)}>
      <rect x="1" y="1" width="24" height="24" rx="6" fill="none" stroke="#3FD6C2" strokeWidth="1.5" />
      <rect x="6" y="6" width="6" height="6" rx="1.5" fill="#F2A93B" />
      <rect x="14" y="6" width="6" height="6" rx="1.5" fill="#3FD6C2" opacity=".5" />
      <rect x="6" y="14" width="6" height="6" rx="1.5" fill="#3FD6C2" opacity=".5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" fill="#3FD6C2" />
    </svg>
  );
}

/** Mark + wordmark, linking home. */
export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <a href={href} aria-label="Cloudana home" className={cn("flex items-center gap-2 font-head text-base font-semibold tracking-[.06em] text-text", className)}>
      <LogoMark />
      CLOUDANA
    </a>
  );
}
