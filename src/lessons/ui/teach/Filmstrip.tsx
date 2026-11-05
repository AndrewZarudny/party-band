// Reduced motion: the demo phrase as a row of still frames, one per step, each with its finger, pick and words.
import { useEffect, useMemo, useRef } from 'react'
import type { Chart, ChartFingering } from '../../types'
import { firstPhrase } from '../../fingering'
import { STRING_SHORT, stepCaption, stepsOf } from './phrase'
import type { Step } from './phrase'
import { useFrame } from './useFrame'
import './teach.css'

const FW = 120
const FH = 90
const X0 = 22
const DX = 23
const sy = (s: number) => 10 + (5 - s) * 9

/** The fret the frame's window starts at. */
function windowOf(s: Step): number {
  if (s.kind === 'chord') {
    const fretted = (s.frets ?? []).filter((f) => f > 0)
    return s.pos ?? (fretted.length && Math.max(...fretted) > 4 ? Math.min(...fretted) : 1)
  }
  if (s.kind === 'note' && s.fret > 0) return s.pos !== null && s.fret >= s.pos && s.fret <= s.pos + 3 ? s.pos : Math.max(1, s.fret - (Number(s.finger) || 1) + 1)
  return s.pos ?? 1
}

function Dot({ x, y, finger }: { x: number; y: number; finger: number }) {
  if (finger === 0)
    return (
      <g className="tc-fm-open" transform={`translate(${x} ${y})`}>
        <circle r={5.5} />
        <text y={3} textAnchor="middle">
          0
        </text>
      </g>
    )
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle className={`tc-tip tc-f${finger}`} r={6.5} />
      <text className="tc-fm-num" y={3.5} textAnchor="middle">
        {finger}
      </text>
    </g>
  )
}

function Frame({ s }: { s: Step }) {
  const lo = windowOf(s)
  const fx = (fret: number) => X0 + (fret - lo + 0.62) * DX
  const dots: { x: number; y: number; finger: number }[] = []
  if (s.kind === 'note') {
    if (s.fret === 0) dots.push({ x: X0 - 8, y: sy(s.string), finger: 0 })
    else dots.push({ x: fx(s.fret), y: sy(s.string), finger: Number(s.finger) || 1 })
  } else if (s.kind === 'chord') {
    const frets = s.frets ?? []
    for (let si = 0; si < frets.length; si++) {
      const f = frets[si]
      const k = s.fingers?.[si]
      if (f < 0) continue
      if (f === 0) dots.push({ x: X0 - 8, y: sy(si), finger: 0 })
      else dots.push({ x: fx(f), y: sy(si), finger: typeof k === 'number' && k > 0 ? k : 1 })
    }
  }
  const pickY = 80
  return (
    <svg className="tc-fm-svg" viewBox={`0 0 ${FW} ${FH}`} aria-hidden>
      {lo === 1 ? <rect className="tc-nut" x={X0 - 3} y={sy(5) - 3} width={3} height={sy(0) - sy(5) + 6} /> : null}
      {[0, 1, 2, 3, 4].map((i) => (i === 0 && lo === 1 ? null : <rect key={i} className="tc-wire" x={X0 + i * DX - 0.75} y={sy(5) - 3} width={1.5} height={sy(0) - sy(5) + 6} />))}
      {[0, 1, 2, 3, 4, 5].map((si) => (
        <g key={si}>
          <line className={`tc-fm-string ${s.kind === 'note' && s.string === si ? 'on' : ''}`} x1={X0 - 2} x2={X0 + 4 * DX + 4} y1={sy(si)} y2={sy(si)} />
          <text className="tc-fm-strname" x={6} y={sy(si) + 3} textAnchor="middle">
            {STRING_SHORT[si]}
          </text>
        </g>
      ))}
      <text className="tc-fm-fret" x={X0 + 0.5 * DX} y={sy(0) + 13} textAnchor="middle">
        {lo}
      </text>
      {s.kind === 'mute' && <rect className="tc-fm-flat" x={X0 + 1.3 * DX} y={sy(5) - 5} width={14} height={sy(0) - sy(5) + 10} rx={7} />}
      {dots.map((d, i) => (
        <Dot key={i} {...d} />
      ))}
      <g transform={`translate(${FW - 44} ${pickY})`}>
        {s.pick && !s.legato ? (
          <path className={s.pick === 'D' ? 'tc-fm-pick down' : 'tc-fm-pick up'} d="M-5 -8Q0 -11 5 -8Q0 8 -5 -8Z" transform={s.pick === 'U' ? 'rotate(180) translate(0 2)' : 'translate(0 2)'} />
        ) : null}
        <text className="tc-fm-word" x={9} y={4}>
          {s.legato ? 'no pick' : s.pick === 'D' ? 'Down' : s.pick === 'U' ? 'Up' : ''}
        </text>
      </g>
    </svg>
  )
}

export function Filmstrip({
  chart,
  fingering,
  mode,
  beatNow,
}: {
  chart: Chart
  fingering: ChartFingering
  mode: 'loop' | 'follow'
  beatNow?: () => number
}) {
  const follow = mode === 'follow' && !!beatNow
  const steps = useMemo(() => {
    if (follow) return stepsOf(chart, fingering)
    const p = firstPhrase(chart)
    return stepsOf(chart, fingering, p.from, p.to)
  }, [chart, fingering, follow])
  const rowRef = useRef<HTMLOListElement>(null)
  const cur = useRef(-1)

  // React reuses the frames, so a highlight set by hand must go when following starts or ends.
  useEffect(() => {
    rowRef.current?.querySelectorAll('.now').forEach((el) => el.classList.remove('now'))
    cur.current = -1
  }, [follow, steps])

  useFrame(
    () => {
      const row = rowRef.current
      if (!row || !beatNow) return
      const b = beatNow()
      let i = -1
      for (let j = 0; j < steps.length; j++) {
        if (steps[j].beat <= b + 1e-6) i = j
        else break
      }
      if (i === cur.current) return
      row.children[cur.current]?.classList.remove('now')
      cur.current = i
      const el = row.children[i] as HTMLElement | undefined
      if (!el) return
      el.classList.add('now')
      // keep the frame in view inside the strip only: never scroll the page
      const left = el.offsetLeft - row.offsetLeft
      if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: left - 8, behavior: 'auto' })
    },
    follow,
    rowRef,
  )

  return (
    <ol ref={rowRef} className="tc-film" aria-label={follow ? 'Every step of the lesson' : 'The first phrase, step by step'}>
      {steps.map((s, i) => (
        <li key={s.id} className="tc-fm">
          <Frame s={s} />
          <span className="tc-fm-cap">{stepCaption(s, i + 1)}</span>
        </li>
      ))}
    </ol>
  )
}
