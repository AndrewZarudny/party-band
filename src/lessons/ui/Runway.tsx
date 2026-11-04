import { useEffect, useRef } from 'react'
import type { LessonRun } from '../run'
import { drawRunway, onStillChange, prefersStill, readColors } from '../runwayDraw'
import { RunwayFx } from '../fx/runwayFx'
import { onThemeChange } from '../../theme'

/** The tab runway canvas. One rAF per run; zoom and nudge are read through refs, so it never re-renders per frame. */
export function Runway({ run, zoom, nudgeMs }: { run: LessonRun; zoom: number; nudgeMs: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoomRef = useRef(zoom)
  const nudgeRef = useRef(nudgeMs)
  useEffect(() => {
    zoomRef.current = zoom
    nudgeRef.current = nudgeMs
  }, [zoom, nudgeMs])

  useEffect(() => {
    const cv = canvasRef.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    let colors = readColors(cv)
    // re-read the tokens when the theme flips; the next frame picks them up
    const offTheme = onThemeChange(() => {
      colors = readColors(cv)
    })
    let still = prefersStill()
    const fx = new RunwayFx(run, still)
    // reduced motion turned on mid-run takes effect at once, like the CSS animations
    const offStill = onStillChange((v) => {
      still = v
      fx.still = v
    })
    let w = 0
    let h = 0
    let dpr = 1
    const measure = () => {
      const r = cv.getBoundingClientRect()
      dpr = window.devicePixelRatio || 1
      fx.dpr = dpr
      w = Math.max(1, Math.round(r.width))
      h = Math.max(1, Math.round(r.height))
      const bw = Math.round(w * dpr)
      const bh = Math.round(h * dpr)
      if (cv.width !== bw || cv.height !== bh) {
        cv.width = bw
        cv.height = bh
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(cv)

    const countIn = run.lesson.countInBeats ?? 4
    let last = -countIn
    let raf = 0
    const frame = (t: number) => {
      // Before the start the clock isn't running; after a stop the picture freezes where it was.
      const active = run.state === 'countin' || run.state === 'playing'
      fx.live = active
      fx.tick(t)
      if (active) {
        const b = run.visualBeat(nudgeRef.current)
        if (Number.isFinite(b)) last = b
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawRunway(g, w, h, run, last, colors, zoomRef.current, still, true, fx)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      offTheme()
      offStill()
    }
  }, [run])

  return <canvas ref={canvasRef} className="lp-runway" role="img" aria-label="Tab runway: notes move left to the pick line. Play each one as it reaches the line." />
}
