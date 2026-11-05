import { useEffect, useRef } from 'react'
import type { LessonRun } from '../run'
import type { ChartFingering, TabLevel } from '../types'
import { drawRunway, onStillChange, prefersStill, readColors } from '../runwayDraw'
import type { RunwayView } from '../runwayDraw'
import { RunwayFx } from '../fx/runwayFx'
import { onThemeChange } from '../../theme'

const NO_PLAYED: RunwayView['played'] = []

/**
 * The tab runway canvas. One rAF per run; zoom, nudge, guides and tab are read through refs, so it never re-renders per frame.
 * `tab` fades or hides the tab; `quiet` (listen mode) drops the live effects and the per-note verdict colours.
 */
export function Runway({
  run,
  zoom,
  nudgeMs,
  guides = null,
  tab = 'full',
  quiet = false,
}: {
  run: LessonRun
  zoom: number
  nudgeMs: number
  guides?: ChartFingering | null
  tab?: TabLevel
  quiet?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoomRef = useRef(zoom)
  const nudgeRef = useRef(nudgeMs)
  const guidesRef = useRef(guides)
  const tabRef = useRef(tab)
  const quietRef = useRef(quiet)
  useEffect(() => {
    zoomRef.current = zoom
    nudgeRef.current = nudgeMs
    guidesRef.current = guides
    tabRef.current = tab
    quietRef.current = quiet
  }, [zoom, nudgeMs, guides, tab, quiet])

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
    // listen mode: the notes scroll by, but nothing says right or wrong until the summary
    const quietView: RunwayView = {
      get chart() {
        return run.chart
      },
      get bpm() {
        return run.bpm
      },
      get hud() {
        return run.hud
      },
      get swing() {
        return run.swing
      },
      played: NO_PLAYED,
      result: () => undefined,
      pendingEvent: () => run.pendingEvent(),
    }
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
      const q = quietRef.current
      fx.live = active && !q
      fx.tick(t)
      if (active) {
        const b = run.visualBeat(nudgeRef.current)
        if (Number.isFinite(b)) last = b
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawRunway(g, w, h, q ? quietView : run, last, colors, zoomRef.current, still, true, q ? undefined : fx, guidesRef.current, tabRef.current)
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

  const label =
    tab === 'hidden'
      ? 'Timing runway: blank marks move left to the pick line. Play each one by ear as it reaches the line.'
      : 'Tab runway: notes move left to the pick line. Play each one as it reaches the line.'
  return <canvas ref={canvasRef} className="lp-runway" role="img" aria-label={label} />
}
