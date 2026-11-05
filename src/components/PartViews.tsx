// Small visuals used on the band cards: chord box, keyboard, rhythm grid.
import type { ChordShape } from '../music/parts'
import { COUNTS } from '../music/parts'
import { noteName, pc } from '../music/theory'
import type { Finger } from '../lessons/types'

// Finger numbers on chord dots: dark lettering on the coloured dot, set inline so every screen gets it.
const FINGER_TEXT = { style: { fill: 'var(--ink)', fontWeight: 700, fontSize: 11 } }

/** Classic chord box: strings vertical, frets horizontal. With `fingers`, each dot shows its fretting finger (1 index … 4 pinky). */
export function ChordDiagram({ shape, name, size = 1, fingers }: { shape: ChordShape; name: string; size?: number; fingers?: (Finger | null)[] }) {
  const played = shape.frets.filter((f) => f > 0)
  const maxF = Math.max(0, ...played)
  const minF = played.length ? Math.min(...played) : 1
  const start = maxF <= 4 ? 1 : minF
  const rows = 4
  const W = 110
  const H = 140
  const left = 18
  const top = 34
  const gapX = (W - left - 12) / 5
  const gapY = (H - top - 10) / rows
  // A barre: same lowest fret on 3+ strings starting from the lowest played string.
  const barreFret = start > 1 || shape.frets.filter((f) => f === minF).length >= 3 ? minF : 0
  const barreStrings = shape.frets.map((f, i) => (f === barreFret ? i : -1)).filter((i) => i >= 0)
  return (
    <svg className="chord-diagram" viewBox={`0 0 ${W} ${H}`} style={{ width: W * size, height: H * size }}>
      <text x={W / 2} y={14} textAnchor="middle" className="cd-name">
        {name}
      </text>
      {start > 1 && (
        <text x={2} y={top + gapY / 2 + 4} className="cd-fret">
          {start}
        </text>
      )}
      <line x1={left} x2={left + gapX * 5} y1={top} y2={top} className={start === 1 ? 'cd-nut' : 'cd-line'} />
      {Array.from({ length: rows }, (_, r) => (
        <line key={r} x1={left} x2={left + gapX * 5} y1={top + gapY * (r + 1)} y2={top + gapY * (r + 1)} className="cd-line" />
      ))}
      {Array.from({ length: 6 }, (_, s) => (
        <line key={s} x1={left + gapX * s} x2={left + gapX * s} y1={top} y2={top + gapY * rows} className="cd-line" />
      ))}
      {barreFret > 0 && barreStrings.length >= 3 && (
        <rect
          x={left + gapX * barreStrings[0] - 6}
          y={top + gapY * (barreFret - start) + gapY / 2 - 6}
          width={gapX * (barreStrings[barreStrings.length - 1] - barreStrings[0]) + 12}
          height={12}
          rx={6}
          className="cd-dot"
        />
      )}
      {fingers && barreFret > 0 && barreStrings.length >= 3 && (
        <text x={left + gapX * barreStrings[0]} y={top + gapY * (barreFret - start) + gapY / 2 + 4} textAnchor="middle" className="cd-finger" {...FINGER_TEXT}>
          1
        </text>
      )}
      {shape.frets.map((f, s) => {
        const x = left + gapX * s
        if (f < 0)
          return (
            <text key={s} x={x} y={top - 6} textAnchor="middle" className="cd-mark">
              ×
            </text>
          )
        if (f === 0) return <circle key={s} cx={x} cy={top - 10} r={4} className="cd-open" />
        const cy = top + gapY * (f - start) + gapY / 2
        const k = fingers?.[s]
        const inBarre = f === barreFret && barreStrings.length >= 3
        if (!fingers) return <circle key={s} cx={x} cy={cy} r={6.5} className="cd-dot" />
        return (
          <g key={s}>
            <circle cx={x} cy={cy} r={6.5} className="cd-dot" />
            {typeof k === 'number' && k > 0 && !inBarre && (
              <text x={x} y={cy + 4} textAnchor="middle" className="cd-finger" {...FINGER_TEXT}>
                {k}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

const WHITE = [0, 2, 4, 5, 7, 9, 11]

/** Piano keyboard from `from` to `to` (MIDI), highlighting right-hand and left-hand notes. */
export function Keyboard({ right, left, scale, from = 36, to = 83, flats }: { right: number[]; left?: number; scale?: number[]; from?: number; to?: number; flats?: boolean }) {
  const whites: number[] = []
  for (let n = from; n <= to; n++) if (WHITE.includes(pc(n))) whites.push(n)
  const kw = 16
  const W = whites.length * kw
  const H = 78
  const xOfWhite = (n: number) => whites.indexOf(n) * kw
  const fill = (n: number, black: boolean) =>
    right.includes(n)
      ? 'var(--chord)'
      : n === left
        ? 'var(--root)'
        : scale?.includes(pc(n))
          ? black
            ? 'color-mix(in srgb, var(--scale) 55%, var(--ink))'
            : 'color-mix(in srgb, var(--scale) 40%, var(--paper))'
          : black
            ? 'var(--ink)'
            : 'var(--paper)'
  const blacks: number[] = []
  for (let n = from; n <= to; n++) if (!WHITE.includes(pc(n))) blacks.push(n)
  return (
    <svg className="keyboard" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {whites.map((n) => (
        <g key={n}>
          <rect x={xOfWhite(n)} y={0} width={kw - 1} height={H} rx={2} fill={fill(n, false)} stroke="var(--line)" strokeWidth={0.5} />
          {(right.includes(n) || n === left) && (
            <text x={xOfWhite(n) + kw / 2 - 0.5} y={H - 6} textAnchor="middle" className="kb-label">
              {noteName(n, flats)}
            </text>
          )}
          {pc(n) === 0 && !right.includes(n) && n !== left && (
            <text x={xOfWhite(n) + kw / 2 - 0.5} y={H - 6} textAnchor="middle" className="kb-c">
              C{Math.floor(n / 12) - 1}
            </text>
          )}
        </g>
      ))}
      {blacks.map((n) => (
        <rect key={n} x={xOfWhite(n - 1) + kw * 0.65} y={0} width={kw * 0.7} height={H * 0.6} rx={1.5} fill={fill(n, true)} />
      ))}
    </svg>
  )
}

/** "1 & 2 & 3 & 4 &" grid with the current eighth highlighted. */
export function RhythmGrid({ rows, now }: { rows: { label?: string; cells: string[] }[]; now: number | null }) {
  return (
    <div className="rgrid">
      <div className="rg-row rg-counts">
        {rows.some((r) => r.label) && <span className="rg-label" />}
        {COUNTS.map((c, i) => (
          <span key={i} className={`rg-cell ${now === i ? 'now' : ''}`}>
            {c}
          </span>
        ))}
      </div>
      {rows.map((r, ri) => (
        <div key={ri} className="rg-row">
          {r.label !== undefined && <span className="rg-label">{r.label}</span>}
          {r.cells.map((c, i) => (
            <span key={i} className={`rg-cell hit-${c === '_' ? 'rest' : c === '-' ? 'hold' : 'on'} ${now === i ? 'now' : ''}`}>
              {c === '_' ? '' : c === '-' ? '–' : c}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
