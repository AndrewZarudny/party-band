// Small inline SVG charts for the progress screen: a sparkline, week bars and a line with a spread band.
// Colours come from CSS classes (theme tokens); no animation.
import './metrics.css'

export interface SparkPoint {
  v: number
  hollow?: boolean // e.g. a cold attempt that wasn't clean
  title?: string
}

const W = 240
const PAD = 6

function scale(vals: number[], h: number, extra: number[] = [], lowerBetter = false) {
  const all = [...vals, ...extra]
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (hi === lo) {
    hi += 1
    lo -= 1
  }
  // Up always means better.
  return (v: number) => {
    const share = (v - lo) / (hi - lo)
    return h - PAD - (h - PAD * 2) * (lowerBetter ? 1 - share : share)
  }
}

/** A line of dots, oldest left. Optional target as a dashed line. */
export function Sparkline({
  points,
  target,
  lowerBetter,
  label,
  height = 48,
}: {
  points: SparkPoint[]
  target?: number
  lowerBetter?: boolean
  label: string
  height?: number
}) {
  if (!points.length) return null
  const y = scale(
    points.map((p) => p.v),
    height,
    target === undefined ? [] : [target],
    lowerBetter,
  )
  const x = (i: number) => (points.length === 1 ? W / 2 : PAD + ((W - PAD * 2) * i) / (points.length - 1))
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  return (
    <svg className="mt-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
      {target !== undefined && <line className="mt-target" x1={0} x2={W} y1={y(target)} y2={y(target)} />}
      {points.length > 1 && <path className="mt-line" d={d} />}
      {points.map((p, i) => (
        <circle key={i} className={p.hollow ? 'mt-dot hollow' : 'mt-dot'} cx={x(i)} cy={y(p.v)} r={3.5}>
          {p.title && <title>{p.title}</title>}
        </circle>
      ))}
    </svg>
  )
}

/** One bar per week with the goal as a line. `flags` marks a week (e.g. pain), `soft` adds a lighter stack (pocket days). */
export function Bars({
  values,
  goal,
  label,
  flags,
  soft,
  current,
  met,
  height = 72,
}: {
  values: number[]
  goal: number
  met?: boolean[] // per bar, when the goal it was judged by differs from `goal`
  label: string
  flags?: boolean[]
  soft?: number[]
  current?: number // index of the week in progress
  height?: number
}) {
  const top = Math.max(goal + 1, ...values.map((v, i) => v + (soft?.[i] ?? 0)))
  const n = Math.max(1, values.length)
  const slot = (W - PAD * 2) / n
  const bw = Math.max(4, slot * 0.62)
  const base = height - PAD - 6
  const yOf = (v: number) => base - ((base - PAD - 6) * v) / top
  return (
    <svg className="mt-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
      <line className="mt-axis" x1={PAD} x2={W - PAD} y1={base} y2={base} />
      {values.map((v, i) => {
        const x = PAD + slot * i + (slot - bw) / 2
        const s = soft?.[i] ?? 0
        return (
          <g key={i} className={i === current ? 'mt-now' : undefined}>
            {v > 0 && <rect className={(met?.[i] ?? v >= goal) ? 'mt-bar met' : 'mt-bar'} x={x} y={yOf(v)} width={bw} height={base - yOf(v)} rx={1.5} />}
            {s > 0 && <rect className="mt-bar soft" x={x} y={yOf(v + s)} width={bw} height={yOf(v) - yOf(v + s)} rx={1.5} />}
            {flags?.[i] && <circle className="mt-flag" cx={x + bw / 2} cy={height - 4} r={2.5} />}
          </g>
        )
      })}
      <line className="mt-target" x1={PAD} x2={W - PAD} y1={yOf(goal)} y2={yOf(goal)} />
    </svg>
  )
}

/** Mean offset as a line with a ±spread band around it; the 0 line is "on the beat". */
export function BandLine({ points, label, height = 72 }: { points: { mean: number; spread: number }[]; label: string; height?: number }) {
  if (!points.length) return null
  const lows = points.map((p) => p.mean - p.spread)
  const highs = points.map((p) => p.mean + p.spread)
  const y = scale([...lows, ...highs], height, [0])
  const x = (i: number) => (points.length === 1 ? W / 2 : PAD + ((W - PAD * 2) * i) / (points.length - 1))
  const upper = points.map((p, i) => `${x(i).toFixed(1)} ${y(p.mean + p.spread).toFixed(1)}`)
  const lower = points.map((p, i) => `${x(i).toFixed(1)} ${y(p.mean - p.spread).toFixed(1)}`).reverse()
  const band = points.length > 1 ? `M${upper.join(' L')} L${lower.join(' L')} Z` : ''
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.mean).toFixed(1)}`).join(' ')
  return (
    <svg className="mt-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
      <line className="mt-axis" x1={0} x2={W} y1={y(0)} y2={y(0)} />
      {band && <path className="mt-band" d={band} />}
      {points.length > 1 && <path className="mt-line" d={line} />}
      {points.map((p, i) => (
        <circle key={i} className="mt-dot" cx={x(i)} cy={y(p.mean)} r={2.5} />
      ))}
    </svg>
  )
}
