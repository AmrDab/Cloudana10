// Magic UI Globe (MIT © Magic UI), rendered by cobe (MIT © Shu Ding). Adapted for cobe v2
// (no onRender — we drive `globe.update` from our own rAF loop), token colours, and
// docs/V2_BRIEF.md §2.6: background only, renders only while on screen, static under reduced motion.
import { useEffect, useRef } from "react"
import createGlobe, { type COBEOptions, type Marker } from "cobe"

import { cn } from "@/lib/utils"

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
]

const BASE: Omit<COBEOptions, "width" | "height" | "markers"> = {
  devicePixelRatio: 2,
  phi: 0,
  theta: 0.3,
  dark: 1,
  diffuse: 1.2,
  mapSamples: 16000,
  mapBrightness: 3,
  baseColor: rgb("#161D2A"),
  markerColor: rgb("#3FD6C2"),
  glowColor: rgb("#111722"),
}

export function Globe({ className, markers = [] }: { className?: string; markers?: Marker[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let width = canvas.offsetWidth
    let phi = 0
    let raf = 0
    let visible = false

    const globe = createGlobe(canvas, { ...BASE, width: width * 2, height: width * 2, markers })
    const frame = () => {
      phi += 0.003
      globe.update({ phi, width: width * 2, height: width * 2 })
      raf = requestAnimationFrame(frame)
    }
    const start = () => {
      if (!raf && visible && !reduce && !document.hidden) raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible) start()
      else stop()
    })
    io.observe(canvas)
    const onResize = () => {
      width = canvas.offsetWidth
      globe.update({ width: width * 2, height: width * 2 })
    }
    const onVis = () => (document.hidden ? stop() : start())
    window.addEventListener("resize", onResize)
    document.addEventListener("visibilitychange", onVis)
    const fade = setTimeout(() => (canvas.style.opacity = "1"), 0)

    return () => {
      stop()
      clearTimeout(fade)
      io.disconnect()
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVis)
      globe.destroy()
    }
  }, [markers])

  return (
    <div className={cn("absolute inset-0 mx-auto aspect-square w-full max-w-150", className)}>
      <canvas
        aria-hidden="true"
        className="size-full opacity-0 transition-opacity duration-500 contain-[layout_paint_size]"
        ref={canvasRef}
      />
    </div>
  )
}
