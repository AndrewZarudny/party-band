import { useEffect, useRef } from 'react'
import type { LessonRun } from '../run'
import type { ChartEvent } from '../types'
import { fxBusFor } from '../fx/bus'
import type { FxHit } from '../fx/bus'
import { FB_H, FB_NUT_X, FB_W, fbFretW, fbFretX, fbNoteX, fbStringY } from '../fx/fretGeom'
import { onStillChange, prefersStill } from '../runwayDraw'
import { nearestPosition } from '../../music/theory'

const TRAILS = 6
const TRAIL_MS = 650
const STRING_MS = 420
const LEAD_BEATS = 2

/**
 * Effects over the lesson fretboard, lined up with its SVG: a ring that closes on the next note in time
 * with the runway, a glow left where a hit landed, and the plucked string lit for a moment.
 * Driven by its own rAF and the run's effect bus, so it never re-renders per frame.
 */
export function FretFx({ run, next, maxFret, nudgeMs }: { run: LessonRun; next: ChartEvent | null; maxFret: number; nudgeMs: number }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const nextRef = useRef(next)
  const nudgeRef = useRef(nudgeMs)
  useEffect(() => {
    nextRef.current = next
    nudgeRef.current = nudgeMs
  }, [next, nudgeMs])

  useEffect(() => {
    const svg = svgRef.current
    const approach = svg?.querySelector<SVGCircleElement>('.fx-approach')
    if (!svg || !approach) return
    const strings = Array.from(svg.querySelectorAll<SVGLineElement>('.fx-string'))
    const trails = Array.from(svg.querySelectorAll<SVGGElement>('.fx-trail'))
    const trailRings = trails.map((el) => el.querySelector('circle'))
    const trailGlows = trails.map((el) => el.querySelector('ellipse'))
    let still = prefersStill()
    const offStill = onStillChange((v) => {
      still = v
    })
    let approachFor: ChartEvent | null = null // the note the ring was last placed on
    const bus = fxBusFor(run)
    const byId = new Map<number, ChartEvent>()
    for (const ev of run.chart.events) byId.set(ev.id, ev)
    const trailAt = new Float64Array(TRAILS)
    const stringAt = new Float64Array(6)
    let seen = bus.seq
    let slot = 0
    let now = 0
    let approachOn = false

    const light = (s: number, wrong: boolean) => {
      stringAt[s] = now
      strings[s].classList.toggle('is-wrong', wrong)
    }
    const onHit = (h: FxHit) => {
      const ev = byId.get(h.eventId)
      if (!ev) return
      if (h.hit && ev.kind === 'note') {
        const el = trails[slot]
        el.setAttribute('transform', `translate(${fbNoteX(ev.fret, maxFret).toFixed(1)} ${fbStringY(ev.string)})`)
        trailGlows[slot]?.setAttribute('rx', Math.max(12, fbFretW(ev.fret, maxFret) * 0.55).toFixed(1))
        trailAt[slot] = now
        slot = (slot + 1) % TRAILS
        light(ev.string, false)
      } else if (h.hit && ev.kind === 'chord') {
        for (let s = 0; s < 6; s++) if (ev.frets[s] >= 0) light(s, false)
      } else if (h.verdict === 'wrong' && h.played !== null) {
        const at = nearestPosition(h.played, ev.kind === 'note' ? ev.fret : 5, undefined, maxFret)
        if (at) light(at.string, true)
      }
    }

    let raf = 0
    const frame = (t: number) => {
      now = t
      seen = bus.drain(seen, onHit)

      // the ring closes on the next note as it nears the pick line, landing as it is due
      const n = nextRef.current
      let show = false
      if (!still && n && n.kind === 'note' && !n.hidden && (run.state === 'countin' || run.state === 'playing')) {
        const lead = n.beat - run.visualBeat(nudgeRef.current)
        if (lead > 0 && lead < LEAD_BEATS) {
          const k = lead / LEAD_BEATS
          if (n !== approachFor) {
            approachFor = n
            approach.setAttribute('cx', fbNoteX(n.fret, maxFret).toFixed(1))
            approach.setAttribute('cy', String(fbStringY(n.string)))
          }
          approach.setAttribute('r', (15 + 22 * k).toFixed(1))
          approach.setAttribute('opacity', (0.9 * (1 - k)).toFixed(2))
          show = true
        }
      }
      if (!show && approachOn) approach.setAttribute('opacity', '0')
      approachOn = show

      for (let i = 0; i < TRAILS; i++) {
        if (!trailAt[i]) continue
        const k = (now - trailAt[i]) / TRAIL_MS
        if (k >= 1) {
          trailAt[i] = 0
          trails[i].setAttribute('opacity', '0')
          continue
        }
        trails[i].setAttribute('opacity', ((1 - k) * (1 - k)).toFixed(3))
        if (!still) trailRings[i]?.setAttribute('r', (13 + 10 * k).toFixed(1))
      }
      for (let s = 0; s < 6; s++) {
        if (!stringAt[s]) continue
        const k = (now - stringAt[s]) / STRING_MS
        if (k >= 1) {
          stringAt[s] = 0
          strings[s].setAttribute('opacity', '0')
          continue
        }
        strings[s].setAttribute('opacity', (1 - k).toFixed(3))
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      offStill()
    }
  }, [run, maxFret])

  const x1 = FB_NUT_X
  const x2 = fbFretX(maxFret, maxFret)
  return (
    <svg ref={svgRef} className="lp-fretfx" viewBox={`0 0 ${FB_W} ${FB_H}`} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((s) => (
        <line key={s} className="fx-string" x1={x1} x2={x2} y1={fbStringY(s)} y2={fbStringY(s)} opacity={0} />
      ))}
      {Array.from({ length: TRAILS }, (_, i) => (
        <g key={i} className="fx-trail" opacity={0}>
          <ellipse cx={0} cy={0} rx={16} ry={7} />
          <circle cx={0} cy={0} r={13} />
        </g>
      ))}
      <circle className="fx-approach" cx={0} cy={0} r={15} opacity={0} />
    </svg>
  )
}
