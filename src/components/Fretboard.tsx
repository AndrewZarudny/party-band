import { STANDARD_TUNING, noteName } from '../music/theory'
import type { Finger } from '../lessons/types'

export interface Marker {
  string: number // 0 = low E
  fret: number
  // 'heard': what you just played, while finger guides are on (a small bone dot, so it never looks like a finger)
  kind: 'scale' | 'box' | 'chord' | 'root' | 'next' | 'target' | 'upcoming' | 'played' | 'heard' | 'ghost'
  label?: string
  opacity?: number
  finger?: Finger // fretting finger: the dot shows its number instead of the note name
  id?: string // stable React key, so a new next note remounts and replays its land
}

interface Props {
  markers: Marker[]
  maxFret?: number
  highlightFrom?: number // shade a fret window, e.g. the current position box
  highlightTo?: number
  flats?: boolean
  tuning?: number[] // low → high; defaults to standard
  arrow?: { from: number; to: number; label: string } // the hand moves along the neck
}

const W = 1100
const H = 210
const NUT_X = 62
const TOP = 26
const STRING_GAP = 30
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21]

export function Fretboard({ markers, maxFret = 22, highlightFrom, highlightTo, flats, tuning = STANDARD_TUNING, arrow }: Props) {
  // Blend of real fret spacing and linear spacing so high frets stay readable.
  const fretX = (f: number) => {
    const real = (1 - Math.pow(2, -f / 12)) / (1 - Math.pow(2, -maxFret / 12))
    const lin = f / maxFret
    return NUT_X + (W - NUT_X - 14) * (0.55 * real + 0.45 * lin)
  }
  const noteX = (f: number) => (f === 0 ? NUT_X - 22 : (fretX(f - 1) + fretX(f)) / 2)
  const stringY = (s: number) => TOP + (5 - s) * STRING_GAP
  const bottom = stringY(0)

  return (
    <svg className="fretboard" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={arrow ? `Fretboard. ${arrow.label}` : 'Fretboard'}>
      {highlightFrom !== undefined && highlightTo !== undefined && (
        <rect
          className="fb-window"
          x={highlightFrom === 0 ? NUT_X - 38 : fretX(highlightFrom - 1)}
          y={TOP - 14}
          width={fretX(highlightTo) - (highlightFrom === 0 ? NUT_X - 38 : fretX(highlightFrom - 1))}
          height={bottom - TOP + 28}
          rx={8}
        />
      )}
      <rect className="fb-wood" x={NUT_X} y={TOP - 8} width={fretX(maxFret) - NUT_X} height={bottom - TOP + 16} />
      {INLAYS.filter((f) => f <= maxFret).map((f) => (
        <circle key={f} className="fb-inlay" cx={noteX(f)} cy={(TOP + bottom) / 2} r={6} />
      ))}
      {maxFret >= 12 && (
        <>
          <circle className="fb-inlay" cx={noteX(12)} cy={stringY(1.5)} r={6} />
          <circle className="fb-inlay" cx={noteX(12)} cy={stringY(3.5)} r={6} />
        </>
      )}
      {Array.from({ length: maxFret + 1 }, (_, f) => (
        <line key={f} className={f === 0 ? 'fb-nut' : 'fb-fret'} x1={fretX(f)} x2={fretX(f)} y1={TOP - 8} y2={bottom + 8} />
      ))}
      {tuning.map((open, s) => (
        <g key={s}>
          <line className="fb-string" x1={NUT_X} x2={fretX(maxFret)} y1={stringY(s)} y2={stringY(s)} strokeWidth={0.8 + (5 - s) * 0.35} />
          <text className="fb-open" x={4} y={stringY(s) + 4}>
            {noteName(open)}
          </text>
        </g>
      ))}
      {[3, 5, 7, 9, 12, 15, 17, 19, 21].filter((f) => f <= maxFret).map((f) => (
        <text key={f} className="fb-num" x={noteX(f)} y={H - 4} textAnchor="middle">
          {f}
        </text>
      ))}
      {markers.map((m, i) => (
        <MarkerDot key={m.id ?? i} m={m} x={noteX(m.fret)} y={stringY(m.string)} flats={flats} open={tuning[m.string]} />
      ))}
      {arrow && arrow.from !== arrow.to && <MoveArrow key={`${arrow.from}-${arrow.to}`} x1={noteX(arrow.from)} x2={noteX(arrow.to)} label={arrow.label} />}
    </svg>
  )
}

/** Above the high e string: an arrow from the hand's fret to the new one, labelled in the middle. */
function MoveArrow({ x1, x2, label }: { x1: number; x2: number; label: string }) {
  const y = TOP - 16
  const dir = x2 > x1 ? 1 : -1
  return (
    <g className="fb-arrow">
      <path d={`M${x1} ${y}H${x2 - dir * 2}`} />
      <path className="fb-arrow-head" d={`M${x2 - dir * 9} ${y - 5}L${x2} ${y}L${x2 - dir * 9} ${y + 5}`} />
      <text x={(x1 + x2) / 2} y={y + 5} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

function MarkerDot({ m, x, y, flats, open }: { m: Marker; x: number; y: number; flats?: boolean; open: number }) {
  const fingered = m.finger !== undefined
  const label = fingered ? String(m.finger) : (m.label ?? noteName(open + m.fret, flats))
  const r = m.kind === 'heard' ? 6 : m.kind === 'ghost' ? 10 : m.kind === 'scale' ? 8 : m.kind === 'next' || m.kind === 'target' ? 15 : 12
  const showText = fingered || (m.kind !== 'next' && m.kind !== 'target' && m.kind !== 'played' && m.kind !== 'heard')
  const fClass = !fingered ? '' : m.finger === 0 ? ' mk-open' : ` mk-f${m.finger}`
  return (
    <g className={`mk mk-${m.kind}${fClass}`} opacity={m.opacity ?? 1}>
      <circle cx={x} cy={y} r={r} />
      {showText && (
        <text x={x} y={y + (m.kind === 'scale' ? 4 : m.kind === 'ghost' ? 4.5 : 5)} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  )
}
