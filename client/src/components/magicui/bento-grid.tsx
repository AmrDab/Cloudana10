// Magic UI BentoGrid (MIT © Magic UI) — adapted to docs/V2_BRIEF.md: 8px radius, 1px
// --line-2 border, no shadows, hover lifts the surface to --panel-2 (no transforms), CTA always
// visible (touch has no hover), vertical list on mobile.
import { type ComponentPropsWithoutRef, type ReactNode } from "react"
import { ArrowRight as ArrowRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface BentoGridProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode
  className?: string
}

interface BentoCardProps extends ComponentPropsWithoutRef<"div"> {
  name: string
  className?: string
  background: ReactNode
  Icon: React.ElementType
  description: string
  href: string
  cta: string
}

const BentoGrid = ({ children, className, ...props }: BentoGridProps) => {
  return (
    <div className={cn("grid w-full grid-cols-1 gap-4 md:auto-rows-[26rem] md:grid-cols-3", className)} {...props}>
      {children}
    </div>
  )
}

const BentoCard = ({ name, className, background, Icon, description, href, cta, ...props }: BentoCardProps) => (
  <div
    className={cn(
      "group relative flex flex-col overflow-hidden rounded-lg border border-line-2 bg-panel",
      "transition-colors duration-150 ease-settle hover:bg-panel-2",
      className
    )}
    {...props}
  >
    <div className="relative min-h-44 flex-1">{background}</div>
    <div className="flex flex-col gap-2 border-t border-line p-6">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-[20px] leading-[1.15] font-medium text-text">{name}</h3>
      </div>
      <p className="font-sans text-sm leading-[1.55] text-muted-foreground">{description}</p>
      <a
        href={href}
        className="mt-2 inline-flex w-fit items-center gap-2 text-sm font-medium text-ok underline-offset-4 hover:underline"
      >
        {cta}
        <ArrowRightIcon className="size-4" aria-hidden />
      </a>
    </div>
  </div>
)

export { BentoCard, BentoGrid }
