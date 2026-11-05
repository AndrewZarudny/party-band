import { useEffect, useRef } from 'react'
import './practice.css'
import { KINDS } from '../data'
import type { PracticeSummary } from '../stats'
import { KIND_LABEL, fmtDay, fmtDuration, usePractice } from '../stats'

// Chart geometry (SVG units; the chart scales to the dialog's width).
const W = 600
const H = 190
const LEFT = 44
const TOP = 8
const BOTTOM = 22
const PLOT_H = H - TOP - BOTTOM
const SLOT = (W - LEFT) / 30
const STEPS = [300, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200, 10800, 14400]

/** Gridline step and top of the scale: about three lines, never below 30 minutes. */
function scaleOf(max: number): { step: number; top: number } {
  const want = Math.max(max, 1800) / 3
  const step = STEPS.find((s) => s >= want) ?? Math.ceil(want / 3600) * 3600
  return { step, top: Math.ceil(Math.max(max, 1800) / step) * step }
}

const short = (sec: number) => (sec >= 3600 ? `${+(sec / 3600).toFixed(1)} h` : `${Math.round(sec / 60)} min`)

function summaryText(p: PracticeSummary): string {
  if (!p.total30) return 'No practice in the last 30 days yet.'
  const days = p.last30.filter((d) => d.total > 0).length
  const lead = KINDS.map((k, i) => [k, p.byKind30[i]] as const).sort((a, b) => b[1] - a[1])[0]
  return `Last 30 days: ${fmtDuration(p.total30)} over ${days} ${days === 1 ? 'day' : 'days'}, most of it ${KIND_LABEL[lead[0]].toLowerCase()}.`
}

function Chart({ p }: { p: PracticeSummary }) {
  const max = Math.max(...p.last30.map((d) => d.total))
  const { step, top } = scaleOf(max)
  const y = (sec: number) => TOP + PLOT_H - (sec / top) * PLOT_H
  const lines: number[] = []
  for (let s = step; s <= top; s += step) lines.push(s)
  const caption = summaryText(p)
  return (
    <figure className="prac-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="prac-chart-cap">
        {lines.map((s) => (
          <g key={s}>
            <line className="prac-grid" x1={LEFT} x2={W} y1={y(s)} y2={y(s)} />
            <text className="prac-axis" x={LEFT - 6} y={y(s) + 4} textAnchor="end">
              {short(s)}
            </text>
          </g>
        ))}
        <line className="prac-base" x1={LEFT} x2={W} y1={y(0)} y2={y(0)} />
        {p.last30.map((d, i) => {
          const x = LEFT + i * SLOT + SLOT * 0.18
          const w = SLOT * 0.64
          let acc = 0
          return (
            <g key={d.key} className={i === 29 ? 'today' : undefined}>
              <title>{`${fmtDay(d.date, true)}: ${fmtDuration(d.total)}`}</title>
              {/* a full-height hit area so the tooltip works on empty days too */}
              <rect className="prac-hit" x={LEFT + i * SLOT} width={SLOT} y={TOP} height={PLOT_H} />
              {KINDS.map((k, ki) => {
                const s = d.secs[ki]
                if (!s) return null
                const y0 = y(acc)
                acc += s
                const h = Math.max(1.5, y0 - y(acc))
                return <rect key={k} className={`prac-k-${k}`} x={x} width={w} y={y0 - h} height={h} rx={1} />
              })}
              {(i % 7 === 1 || i === 29) && (
                <text className="prac-axis" x={x + w / 2} y={H - 6} textAnchor={i === 29 ? 'end' : 'middle'} dx={i === 29 ? w / 2 : 0}>
                  {i === 29 ? 'Today' : fmtDay(d.date)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption id="prac-chart-cap">{caption}</figcaption>
      <ul className="prac-legend">
        {KINDS.map((k, i) => (
          <li key={k}>
            <i className={`prac-sw prac-k-${k}`} aria-hidden="true" />
            {KIND_LABEL[k]} <span>{fmtDuration(p.byKind30[i])}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

/** "Your practice": the last 30 days, the best day and the average. A modal. Time is shown, not judged. */
export function PracticePanel({ guest, onClose }: { guest: boolean; onClose: () => void }) {
  const p = usePractice()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('.acct-close')?.focus()
  }, [])

  // Escape closes; Tab stays inside; keys don't reach the app's shortcuts behind it.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      ev.stopPropagation()
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onClose()
        return
      }
      if (ev.key !== 'Tab' || !box.current) return
      const items = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled)')]
      if (!items.length) return
      const i = items.indexOf(document.activeElement as HTMLElement)
      if (ev.shiftKey && i <= 0) {
        ev.preventDefault()
        items[items.length - 1].focus()
      } else if (!ev.shiftKey && i === items.length - 1) {
        ev.preventDefault()
        items[0].focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="acct-backdrop"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose()
      }}
    >
      <div ref={box} tabIndex={-1} className="acct-dialog prac-dialog" role="dialog" aria-modal="true" aria-labelledby="prac-h" aria-describedby="prac-sub">
        <header className="acct-dialog-head">
          <h2 id="prac-h">Your practice</h2>
          <button type="button" className="acct-close" onClick={onClose}>
            Close
          </button>
        </header>
        <p id="prac-sub" className="acct-sub">
          {guest
            ? 'Kept in this browser only. Sign in to keep it in your account.'
            : 'Counted on every browser where you use this account.'}
        </p>

        <dl className="prac-stats">
          <div>
            <dt>Best day</dt>
            <dd>{p.best ? fmtDuration(p.best.total) : 'None yet'}</dd>
            {p.best && <dd className="prac-note">{fmtDay(p.best.date, true)}</dd>}
          </div>
          <div>
            <dt>Average</dt>
            <dd>{fmtDuration(p.average)}</dd>
            <dd className="prac-note">per practice day</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{fmtDuration(p.total)}</dd>
            <dd className="prac-note">
              {p.practiceDays} practice {p.practiceDays === 1 ? 'day' : 'days'}
            </dd>
          </div>
        </dl>

        <Chart p={p} />

        <p className="prac-how">
          Time counts while a lesson, song or jam is playing, or while you play the connected guitar (it stops after
          10 seconds of quiet). Each second counts once. A hidden tab doesn't count.
        </p>
      </div>
    </div>
  )
}
