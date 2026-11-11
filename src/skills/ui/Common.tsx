// Small pieces every skill game shares: the header, the round summary and a progress chart.
import { createContext, useContext, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { practice } from '../../account/activity'

/** The round belongs to a block of today's session: the block's clock, and the one main button's next move. */
export interface RoundSession {
  text: string // "Changes: 1:05 of 4 min. Another round." or "Changes done."
  running: boolean // the block has minutes left: Again is the main button
  nextLabel: string // "Next: Call and response"
  onNext: () => void
}
// eslint-disable-next-line react-refresh/only-export-components
export const RoundSessionContext = createContext<RoundSession | null>(null)

const GAP_MS = 30000 // the pause after a round that still counts as practice (lessons/session.ts GAP_SEC)

export function GameHead({ title, sub, onBack, right }: { title: string; sub: string; onBack: () => void; right?: ReactNode }) {
  return (
    <header className="sk-head">
      <button className="ls-btn ghost small" onClick={onBack}>
        Back
      </button>
      <div className="sk-head-text">
        <h2 id="sk-game-h" className="ls-display">
          {title}
        </h2>
        <p className="ls-muted">{sub}</p>
      </div>
      {right}
    </header>
  )
}

export function Timer({ left, total }: { left: number; total: number }) {
  const s = Math.max(0, Math.ceil(left))
  return (
    <div className="sk-timer" role="timer" aria-label={`${s} seconds left`}>
      <span className="ls-num">
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
      </span>
      <div className="ls-bar" aria-hidden>
        <span style={{ transform: `scaleX(${total ? Math.max(0, left) / total : 0})` }} />
      </div>
    </div>
  )
}

export interface RoundSummary {
  headline: string
  lines: [string, string][]
  best: boolean
  xp: number
  note?: string
}

const SETTLE_MS = 1000 // Space and Enter do nothing this long after a round ends (the player may still be tapping)

export function RoundDone({
  s,
  onAgain,
  onBack,
  actions,
  children,
}: {
  s: RoundSummary
  onAgain: () => void
  onBack: () => void
  actions?: ReactNode
  children?: ReactNode
}) {
  const head = useRef<HTMLParagraphElement>(null)
  const session = useContext(RoundSessionContext)
  // The short rest after a round counts as practice, like the rest between lesson runs.
  useEffect(() => {
    const stop = practice('lessons', true)
    const t = window.setTimeout(() => stop?.(), GAP_MS)
    return () => {
      window.clearTimeout(t)
      stop?.()
    }
  }, [])
  // Focus the summary, not Again: a Space tap meant for the game must not start a new round.
  useEffect(() => {
    head.current?.focus()
    const until = performance.now() + SETTLE_MS
    const guard = (ev: KeyboardEvent) => {
      if (performance.now() > until) return
      if (ev.key === ' ' || ev.key === 'Enter') {
        ev.preventDefault()
        ev.stopPropagation()
      }
    }
    window.addEventListener('keydown', guard, true)
    const id = window.setTimeout(() => window.removeEventListener('keydown', guard, true), SETTLE_MS)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('keydown', guard, true)
    }
  }, [])
  return (
    <section className="sk-done" aria-live="polite">
      <p ref={head} tabIndex={-1} className="sk-done-head ls-display">
        {s.headline}
      </p>
      {s.best && <p className="sk-best-tag">New best</p>}
      <dl className="sk-lines">
        {s.lines.map(([k, v]) => (
          <div key={k}>
            <dt className="ls-muted">{k}</dt>
            <dd className="ls-num">{v}</dd>
          </div>
        ))}
        {s.xp > 0 && (
          <div>
            <dt className="ls-muted">XP</dt>
            <dd className="ls-num">+{s.xp}</dd>
          </div>
        )}
      </dl>
      {s.note && <p>{s.note}</p>}
      {children}
      {session && <p className="sk-session ls-num">{session.text}</p>}
      <div className="sk-actions">
        {session && !session.running && (
          <button className="ls-btn primary" onClick={session.onNext}>
            {session.nextLabel}
          </button>
        )}
        <button className={`ls-btn ${session && !session.running ? '' : 'primary'}`} onClick={onAgain}>
          Again
        </button>
        {session?.running && (
          <button className="ls-btn" onClick={session.onNext}>
            {session.nextLabel}
          </button>
        )}
        {actions}
        {!session && (
          <button className="ls-btn ghost" onClick={onBack}>
            Back to skills
          </button>
        )}
      </div>
    </section>
  )
}

/** Best per day as a line. Empty when there are fewer than two days. */
export function TrendChart({ points, unit, label, lowerBetter }: { points: { day: string; score: number }[]; unit: string; label: string; lowerBetter?: boolean }) {
  if (points.length < 2) return <p className="ls-muted sk-chart-empty">Play on two different days to see a trend.</p>
  const W = 320
  const H = 110
  const pad = 22
  const vals = points.map((p) => p.score)
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (hi === lo) {
    hi += 1
    lo = Math.max(0, lo - 1)
  }
  const x = (i: number) => pad + ((W - pad * 2) * i) / (points.length - 1)
  // Up always means better.
  const y = (v: number) => {
    const share = (v - lo) / (hi - lo)
    return H - pad - (H - pad * 2) * (lowerBetter ? 1 - share : share)
  }
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ')
  const first = points[0]
  const last = points[points.length - 1]
  return (
    <figure className="sk-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: from ${first.score} ${unit} on ${first.day} to ${last.score} ${unit} on ${last.day}`}>
        <line className="sk-chart-axis" x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} />
        <path className="sk-chart-line" d={d} />
        {points.map((p, i) => (
          <circle key={p.day} className="sk-chart-dot" cx={x(i)} cy={y(p.score)} r={3.5}>
            <title>
              {p.day}: {p.score} {unit}
            </title>
          </circle>
        ))}
        <text className="sk-chart-text" x={pad} y={H - 6}>
          {first.day.slice(5)}
        </text>
        <text className="sk-chart-text" x={W - pad} y={H - 6} textAnchor="end">
          {last.day.slice(5)}
        </text>
        <text className="sk-chart-text" x={x(points.length - 1)} y={y(last.score) - 8} textAnchor="end">
          {last.score} {unit}
        </text>
      </svg>
      <figcaption className="ls-muted">{label}</figcaption>
    </figure>
  )
}
