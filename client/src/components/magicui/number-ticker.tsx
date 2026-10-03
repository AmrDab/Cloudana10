// Magic UI NumberTicker (MIT © Magic UI) — adapted to docs/V2_BRIEF.md §1 motion rules:
// counts up over 800ms on first paint only; later updates cross-fade the digits in 250ms;
// reduced motion renders the final value. Tabular nums so digits never shift layout.
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { animate, useInView, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  startValue?: number
  delay?: number
  decimalPlaces?: number
}

export function NumberTicker({
  value,
  startValue = 0,
  delay = 0,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: "0px" })
  const reduce = useReducedMotion()
  const shown = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !isInView) return
    const fmt = (v: number) =>
      Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(Number(v.toFixed(decimalPlaces)))

    if (shown.current === value) return
    // Later updates (and reduced motion): swap the digits with a 250ms cross-fade.
    if (shown.current !== null || reduce) {
      shown.current = value
      el.textContent = fmt(value)
      if (!reduce) el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 250, easing: "cubic-bezier(.2,.8,.2,1)" })
      return
    }
    shown.current = value
    let finished = false
    const controls = animate(startValue, value, {
      duration: 0.8,
      delay,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => {
        el.textContent = fmt(v)
      },
      onComplete: () => {
        finished = true
      },
    })
    // Only an interrupted count-up restarts; a finished one lets later updates cross-fade.
    return () => {
      controls.stop()
      if (!finished) shown.current = null
    }
  }, [isInView, value, startValue, delay, decimalPlaces, reduce])

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
      {Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(startValue)}
    </span>
  )
}
