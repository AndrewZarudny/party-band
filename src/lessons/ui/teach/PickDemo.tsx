// Picking hand: the pick swings like a pendulum, crossing the string on every grid slot.
// Played slots at full strength, air strokes faint: the hand never stops.
import { useMemo, useRef } from 'react'
import type { Chart, ChartFingering } from '../../types'
import { firstPhrase } from '../../fingering'
import { DemoClock } from './clock'
import { clamp01, easeOut, pendulum } from './motion'
import { STRING_SHORT, stepsOf } from './phrase'
import type { Step } from './phrase'
import { useFrame } from './useFrame'
import './teach.css'

type Layout = 'side' | 'strip'

const GEO = {
  side: { w: 120, h: 150, pickX: 60, x0: 8, x1: 112, mid: 75, amp: 30, strumAmp: 45, strY: (s: number) => 30 + s * 18 },
  strip: { w: 360, h: 64, pickX: 62, x0: 8, x1: 120, mid: 32, amp: 22, strumAmp: 26, strY: (s: number) => 10 + s * 8.8 },
}
const COUNTS = ['1', '&', '2', '&', '3', '&', '4', '&']
const SLOT_X0 = 150
const SLOT_DX = 26.5
const FLASH = 0.25

/** "M x y" chevron pointing down (D) or up (U), centred on (0, 0). */
const chevron = (dir: 'D' | 'U', s = 5) => (dir === 'D' ? `M${-s} ${-s * 0.6}L0 ${s * 0.6}L${s} ${-s * 0.6}` : `M${-s} ${s * 0.6}L0 ${-s * 0.6}L${s} ${s * 0.6}`)

/** The pick, point down, its tip at (0, 0). Same family as the runway's pick. */
const PICK_PATH = 'M-9 -14Q0 -20 9 -14Q0 14 -9 -14Z'

export function PickDemo({
  chart,
  fingering,
  mode,
  beatNow,
  bpm,
  layout = 'strip',
}: {
  chart: Chart
  fingering: ChartFingering
  mode: 'loop' | 'follow'
  beatNow?: () => number
  bpm: number
  layout?: Layout
}) {
  const geo = GEO[layout]
  const phrase = useMemo(() => firstPhrase(chart), [chart])
  const follow = mode === 'follow' && !!beatNow
  const steps = useMemo(() => (follow ? stepsOf(chart, fingering) : stepsOf(chart, fingering, phrase.from, phrase.to)), [chart, fingering, phrase, follow])
  const strum = steps.some((s) => s.kind === 'chord')
  // beats between two string crossings: the grid, or half of it when every stroke is a downstroke
  const cross = fingering.pickRule === 'down' ? fingering.grid / 2 : fingering.grid
  const bySlot = useMemo(() => {
    const m = new Map<number, Step>()
    for (const s of steps) if (s.pick !== null && !s.legato) m.set(Math.round(s.beat / cross), s)
    return m
  }, [steps, cross])
  const ownClock = useMemo(() => new DemoClock(chart, fingering, bpm), [chart, fingering, bpm])
  const clock = beatNow ?? ownClock.beat

  const svgRef = useRef<SVGSVGElement>(null)
  const pickRef = useRef<SVGGElement>(null)
  const stringRefs = useRef<(SVGPathElement | null)[]>([])
  const labelRef = useRef<SVGTextElement>(null)
  const labelChevRef = useRef<SVGPathElement>(null)
  const xRef = useRef<SVGGElement>(null)
  const pmRef = useRef<SVGGElement>(null)
  const nameRef = useRef<SVGTextElement>(null)
  const slotRefs = useRef<(SVGGElement | null)[]>([])
  const nowSlotRef = useRef<SVGRectElement>(null)
  const memo = useRef({ label: '', name: '', bar: NaN })

  const lanes = strum ? [0, 1, 2, 3, 4, 5] : [-1]
  // strum lanes start further right to make room for the thick / thin words
  const x0 = strum ? geo.x0 + 22 : geo.x0
  const laneY = (s: number) => (s < 0 ? geo.mid : geo.strY(s))

  useFrame(
    () => {
      const m = memo.current
      const spb = 60 / bpm
      const b = clock()
      const gap = !follow && b >= phrase.to
      const g = cross * spb
      const amp = strum ? geo.strumAmp : geo.amp
      const pend = pendulum(b * spb, g, amp)
      const a = (Math.PI * b * spb) / g
      const k = Math.round(b / cross)
      const playedAt = (kk: number) => {
        const st = bySlot.get(kk)
        if (!st) return null
        if (!follow && (kk * cross < phrase.from - 1e-6 || kk * cross >= phrase.to)) return null
        return st
      }
      const near = gap ? null : playedAt(k)
      const pick = pickRef.current
      if (pick) {
        pick.setAttribute('transform', `translate(${geo.pickX} ${(geo.mid + pend.y).toFixed(2)}) rotate(${(10 * Math.cos(a)).toFixed(2)})`)
        pick.setAttribute('opacity', near ? '1' : '0.45')
      }

      // The latest played crossing within FLASH seconds
      let hit: { st: Step; ts: number; dir: 'D' | 'U' } | null = null
      for (const kk of [k, k - 1]) {
        const st = gap ? null : playedAt(kk)
        const ts = (b - kk * cross) * spb
        if (st && ts >= 0 && ts < 1) {
          hit = { st, ts, dir: kk % 2 === 0 ? 'D' : 'U' }
          break
        }
      }

      // Strings: flash and ring in the order the pick crosses them
      for (const s of lanes) {
        const path = stringRefs.current[s < 0 ? 0 : s]
        if (!path) continue
        const y0 = laneY(s)
        let vib = 0
        let lit = 0
        if (hit) {
          const playsHere = s < 0 || hit.st.kind === 'mute' || (hit.st.frets ? hit.st.frets[s] >= 0 : true)
          if (playsHere) {
            const arg = Math.max(-1, Math.min(1, (y0 - geo.mid) / amp))
            const dt = s < 0 ? 0 : ((hit.dir === 'D' ? 1 : -1) * Math.asin(arg) * g) / Math.PI
            const t = hit.ts - dt
            if (t >= 0) {
              const damp = hit.st.kind === 'mute' || hit.st.palmMute ? 0.06 : 0.25
              vib = 2.2 * Math.exp(-t / damp) * Math.sin(2 * Math.PI * 18 * t)
              lit = clamp01(1 - t / FLASH)
            }
          }
        }
        if (Math.abs(vib) < 0.05) path.setAttribute('d', `M${x0} ${y0}H${geo.x1}`)
        else {
          let d = ''
          for (let x = x0; x <= geo.x1; x += 4) d += (d ? 'L' : 'M') + x + ' ' + (y0 + vib * Math.sin((Math.PI * (x - x0)) / (geo.x1 - x0))).toFixed(2)
          path.setAttribute('d', d)
        }
        path.style.opacity = String(0.55 + 0.45 * lit)
        path.classList.toggle('tc-lit', lit > 0.05)
      }

      // Down / Up word for 250 ms after a played crossing
      const lab = labelRef.current
      if (lab) {
        const show = hit && hit.ts < FLASH
        const word = hit ? (hit.dir === 'D' ? 'Down' : 'Up') : ''
        if (show && word !== m.label) {
          lab.textContent = word
          labelChevRef.current?.setAttribute('d', chevron(hit!.dir, 4))
          m.label = word
        }
        const op = show ? (1 - easeOut(hit!.ts / FLASH) * 0.6).toFixed(3) : '0'
        lab.setAttribute('opacity', op)
        labelChevRef.current?.setAttribute('opacity', op)
      }
      // Muted scratch chip and palm-mute hand edge
      xRef.current?.setAttribute('opacity', hit && hit.st.kind === 'mute' && hit.ts < FLASH ? '1' : '0')
      const pmOn = (() => {
        if (gap) return 0
        for (const st of steps) {
          if (!st.palmMute) continue
          if (b >= st.beat - 0.05 && b < st.beat + Math.max(st.dur, 0.5)) return clamp01((b - st.beat + 0.05) * spb / 0.12)
        }
        return 0
      })()
      pmRef.current?.setAttribute('opacity', pmOn.toFixed(3))

      // Single-string mode: name the string being picked
      if (!strum && nameRef.current) {
        const st = hit?.st ?? steps.find((x) => x.beat >= b) ?? steps[0]
        const name = st && st.kind === 'note' ? STRING_SHORT[st.string] : ''
        if (name !== m.name) {
          nameRef.current.textContent = name
          m.name = name
        }
      }

      // Strip: this bar's eight slots, the current one marked
      if (layout === 'strip') {
        const bar = Math.floor(Math.max(0, b) / 4)
        if (bar !== m.bar) {
          m.bar = bar
          for (let j = 0; j < 8; j++) {
            const el = slotRefs.current[j]
            if (!el) continue
            const beat = bar * 4 + j / 2
            const st = steps.find((x) => Math.abs(x.beat - beat) < 1e-6)
            const kind = !st ? 'air' : st.kind === 'mute' ? 'x' : st.legato || st.pick === null ? 'leg' : st.pick === 'D' ? 'D' : 'U'
            el.setAttribute('data-k', kind)
            const leg = el.querySelector('.tc-slot-leg')
            if (leg && st) leg.textContent = st.tech === 'hammer' ? 'h' : st.tech === 'pull' ? 'p' : 'sl'
          }
        }
        const slot = Math.floor((Math.max(0, b) - bar * 4) * 2)
        nowSlotRef.current?.setAttribute('x', String(SLOT_X0 + slot * SLOT_DX - SLOT_DX / 2 + 1))
        nowSlotRef.current?.setAttribute('opacity', gap ? '0' : '1')
      }
    },
    steps.length > 0,
    svgRef,
  )

  const what = strum ? 'Strumming hand' : 'Picking hand'
  return (
    <figure className={`tc-pick ${layout}`}>
      <svg
        ref={svgRef}
        className="tc-pick-svg"
        viewBox={`0 0 ${geo.w} ${geo.h}`}
        role="img"
        aria-label={`${what}: it swings down and up all the time, down on the beat and up on the "and". A downstroke goes from the thick string toward the thin one. It only hits the strings where the music has a note.`}
      >
        {/* Seen from above the guitar, the thick string is on top, so a downstroke moves down here.
            No string letters: the fretting-hand picture names them the other way up (tab order). */}
        {strum && (
          <>
            <text className="tc-pick-str" x={x0 - 3} y={geo.strY(0) + 3} textAnchor="end">
              thick
            </text>
            <text className="tc-pick-str" x={x0 - 3} y={geo.strY(5) + 3} textAnchor="end">
              thin
            </text>
          </>
        )}
        {!strum && <text ref={nameRef} className="tc-pick-str" x={geo.x0 - 3} y={geo.mid + 3} textAnchor="end" />}
        {lanes.map((s) => (
          <path
            key={s}
            ref={(el) => {
              stringRefs.current[s < 0 ? 0 : s] = el
            }}
            className="tc-pick-string"
            d={`M${x0} ${laneY(s)}H${geo.x1}`}
          />
        ))}
        <g ref={pmRef} className="tc-pm" opacity={0}>
          <rect x={geo.x1 - 22} y={(strum ? geo.strY(0) : geo.mid) - 8} width={22} height={(strum ? geo.strY(5) - geo.strY(0) : 0) + 16} rx={8} />
          <text x={geo.x1 - 11} y={(strum ? geo.strY(0) : geo.mid) - 11} textAnchor="middle">
            PM
          </text>
        </g>
        <g ref={xRef} className="tc-xchip" opacity={0} transform={`translate(${geo.pickX + 24} ${geo.mid})`}>
          <rect x={-8} y={-8} width={16} height={16} rx={5} />
          <text y={4} textAnchor="middle">
            x
          </text>
        </g>
        <g ref={pickRef} transform={`translate(${geo.pickX} ${geo.mid})`}>
          <path className="tc-pickglyph" d={PICK_PATH} />
        </g>
        {layout === 'side' ? (
          <g transform={`translate(${geo.w / 2} ${geo.h - 8})`}>
            <path ref={labelChevRef} className="tc-pick-chev" transform="translate(-22 -4)" opacity={0} />
            <text ref={labelRef} className="tc-pick-word" x={-14} opacity={0} />
          </g>
        ) : (
          <g transform={`translate(${geo.pickX + 20} ${geo.h - 6})`}>
            <path ref={labelChevRef} className="tc-pick-chev" transform="translate(-6 -4)" opacity={0} />
            <text ref={labelRef} className="tc-pick-word" x={2} opacity={0} />
          </g>
        )}
        {layout === 'strip' && (
          <g className="tc-slots">
            <rect ref={nowSlotRef} className="tc-slot-now" x={SLOT_X0 - SLOT_DX / 2 + 1} y={8} width={SLOT_DX - 2} height={52} rx={6} opacity={0} />
            {COUNTS.map((c, j) => (
              <g
                key={j}
                ref={(el) => {
                  slotRefs.current[j] = el
                }}
                className="tc-slot"
                data-k="air"
                transform={`translate(${SLOT_X0 + j * SLOT_DX} 0)`}
              >
                <path className="tc-slot-d" d={chevron('D', 5)} transform="translate(0 26)" />
                <path className="tc-slot-u" d={chevron('U', 5)} transform="translate(0 26)" />
                <text className="tc-slot-x" y={30} textAnchor="middle">
                  x
                </text>
                <circle className="tc-slot-air" cy={26} r={1.6} />
                <text className="tc-slot-leg" y={30} textAnchor="middle">
                  ~
                </text>
                <text className="tc-slot-count" y={54} textAnchor="middle">
                  {c}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </figure>
  )
}
