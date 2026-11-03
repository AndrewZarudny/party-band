import { STANDARD_TUNING, noteName } from '../music/theory'

export interface Marker {
  string: number // 0 = low E
  fret: number
  kind: 'scale' | 'box' | 'chord' | 'root' | 'next' | 'target' | 'upcoming' | 'played'
  label?: string
  opacity?: number
}

interface Props {
  markers: Marker[]
  maxFret?: number
  highlightFrom?: number // shade a fret window, e.g. the current position box
  highlightTo?: number
  flats?: boolean
  tuning?: number[] // low → high; defaults to standard
}

const W = 1100
const H = 210
const NUT_X = 62
const TOP = 26
const STRING_GAP = 30
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21]

export function Fretboard({ markers, maxFret = 22, highlightFrom, highlightTo, flats, tuning = STANDARD_TUNING }: Props) {
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
    <svg className="fretboard" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Fretboard">
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
        <MarkerDot key={i} m={m} x={noteX(m.fret)} y={stringY(m.string)} flats={flats} open={tuning[m.string]} />
      ))}
    </svg>
  )
}

function MarkerDot({ m, x, y, flats, open }: { m: Marker; x: number; y: number; flats?: boolean; open: number }) {
  const label = m.label ?? noteName(open + m.fret, flats)
  const r = m.kind === 'scale' ? 8 : m.kind === 'next' || m.kind === 'target' ? 15 : 12
  const showText = m.kind !== 'next' && m.kind !== 'target' && m.kind !== 'played'
  return (
    <g className={`mk mk-${m.kind}`} opacity={m.opacity ?? 1}>
      <circle cx={x} cy={y} r={r} />
      {showText && (
        <text x={x} y={y + 4} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  )
}
