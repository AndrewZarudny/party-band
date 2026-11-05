// Technique basics: seven small looping pictures, each with a still version for reduced motion.
// Every loop is a function of time in its period; one rAF per visible card writes attributes through refs.
import { useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { basicsCard } from './basics'
import type { BasicsId } from './basics'
import { clamp01, easeIn, easeInOut, easeOut, lerp } from './motion'
import { useFrame } from './useFrame'
import './teach.css'

const VW = 160
const VH = 110

/** A string from x0 to x1 at y, ringing as a standing wave of `amp` px. */
function wave(x0: number, x1: number, y: number, amp: number, phase: number, buzz = false): string {
  let d = `M${x0} ${y}`
  const n = buzz ? 22 : 18
  for (let i = 1; i <= n; i++) {
    const u = i / n
    const x = x0 + (x1 - x0) * u
    const env = Math.sin(Math.PI * u)
    const yy = buzz ? y + (i % 2 ? amp : -amp) * env * (0.6 + 0.4 * Math.sin(phase + i)) : y + amp * env * Math.sin(phase)
    d += `L${x.toFixed(1)} ${yy.toFixed(2)}`
  }
  return d
}

/** Seconds into a `period` second loop, from a shared start. */
function useLoop(period: number, still: boolean, draw: (t: number) => void) {
  const start = useRef(-1)
  const el = useRef<SVGSVGElement>(null)
  useFrame(
    (now) => {
      if (start.current < 0) start.current = now
      draw((now - start.current) % period)
    },
    !still,
    el,
  )
  return el
}

function Art({ svgRef, label, children }: { svgRef?: RefObject<SVGSVGElement | null>; label: string; children: ReactNode }) {
  return (
    <svg ref={svgRef} className="tc-art" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={label}>
      {children}
    </svg>
  )
}

// ---- 1. Hold the pick -------------------------------------------------------------

function GripArt({ still }: { still: boolean }) {
  const grip = useRef<SVGGElement>(null)
  const pick = useRef<SVGPathElement>(null)
  const bracket = useRef<SVGGElement>(null)
  const str = useRef<SVGPathElement>(null)
  const svg = useLoop(2.8, still, (t) => {
    const out = easeOut(clamp01(t / 0.6))
    pick.current?.setAttribute('transform', `translate(0 ${lerp(-8, 0, out).toFixed(2)})`)
    const br = t < 0.6 ? 0 : t < 0.8 ? (t - 0.6) / 0.2 : t < 2.4 ? 1 : 1 - (t - 2.4) / 0.4
    bracket.current?.setAttribute('opacity', clamp01(br).toFixed(3))
    const dy = t < 1.2 ? 0 : t < 1.42 ? 10 * easeInOut((t - 1.2) / 0.22) : t < 1.6 ? 10 : t < 2 ? 10 * (1 - easeInOut((t - 1.6) / 0.4)) : 0
    grip.current?.setAttribute('transform', `translate(0 ${dy.toFixed(2)})`)
    const tv = t - 1.31
    const amp = tv > 0 && tv < 0.4 ? 2.4 * Math.exp(-tv / 0.15) : 0
    str.current?.setAttribute('d', wave(16, 144, 78, amp, tv * 2 * Math.PI * 18))
  })
  return (
    <Art svgRef={svg} label="A pick pinched between the thumb pad and the side of the index finger, with a little tip showing, stroking down across a string">
      <path ref={str} className="tc-art-string" d={wave(16, 144, 78, 0, 0)} />
      <g ref={grip}>
        <path className="tc-art-finger" d="M38 66Q78 88 120 58" />
        <path ref={pick} className="tc-art-pick" d="M66 48Q80 42 94 48Q80 96 66 48Z" />
        <rect className="tc-art-thumb" x={56} y={36} width={48} height={30} rx={15} />
        <text className="tc-art-label" x={80} y={28} textAnchor="middle">
          thumb
        </text>
        <text className="tc-art-label" x={124} y={50} textAnchor="start">
          index
        </text>
        <g ref={bracket} opacity={still ? 1 : 0}>
          <path className="tc-art-bracket" d="M98 66H102V72H98" />
          <text className="tc-art-label strong" x={106} y={72}>
            2 mm
          </text>
        </g>
      </g>
    </Art>
  )
}

// ---- 2. Pick from the wrist -------------------------------------------------------

function Hand({ angle, ghost }: { angle: number; ghost?: boolean }) {
  return (
    <g transform={`rotate(${angle} 76 56)`} opacity={ghost ? 0.4 : 1}>
      <rect className="tc-art-hand" x={74} y={44} width={46} height={24} rx={11} />
      <path className="tc-art-pick" d="M118 58Q126 54 134 58Q126 80 118 58Z" />
    </g>
  )
}

function WristArt({ still, strum }: { still: boolean; strum: boolean }) {
  const hand = useRef<SVGGElement>(null)
  const arm = useRef<SVGGElement>(null)
  const word = useRef<SVGTextElement>(null)
  const last = useRef('')
  const svg = useLoop(1.2, still, (t) => {
    const a = (2 * Math.PI * t) / 1.2
    // strumming: the forearm swings from the elbow and the wrist follows loosely
    arm.current?.setAttribute('transform', strum ? `rotate(${(7 * Math.sin(a)).toFixed(2)} 12 56)` : '')
    hand.current?.setAttribute('transform', `rotate(${((strum ? 7 : 12) * Math.sin(a - (strum ? 0.5 : 0))).toFixed(2)} 76 56)`)
    const w = Math.cos(a) >= 0 ? 'Down' : 'Up'
    if (w !== last.current && word.current) {
      word.current.textContent = w
      last.current = w
    }
  })
  const label = strum
    ? 'The forearm swings down and up from the elbow and the loose wrist follows'
    : 'The forearm stays nearly still while the hand swings down and up from the wrist'
  return (
    <Art svgRef={svg} label={label}>
      <line className="tc-art-string" x1={112} x2={152} y1={68} y2={68} />
      <text className="tc-art-label" x={40} y={38} textAnchor="middle">
        {strum ? 'elbow swings' : 'arm relaxed'}
      </text>
      {still ? (
        <>
          <rect className="tc-art-arm" x={6} y={46} width={72} height={20} rx={10} />
          <Hand angle={-12} ghost />
          <Hand angle={12} ghost />
          <path className="tc-art-arrow" d="M140 44Q152 68 140 92" />
          <path className="tc-art-arrow" d="M136 48l4 -4l2 5M136 88l4 4l2 -5" />
          <text className="tc-art-label strong" x={100} y={104} textAnchor="middle">
            Down and up
          </text>
          <circle className="tc-art-joint" cx={76} cy={56} r={3} />
        </>
      ) : (
        <g ref={arm}>
          <rect className="tc-art-arm" x={6} y={46} width={72} height={20} rx={10} />
          <g ref={hand}>
            <rect className="tc-art-hand" x={74} y={44} width={46} height={24} rx={11} />
            <path className="tc-art-pick" d="M118 58Q126 54 134 58Q126 80 118 58Z" />
          </g>
          <circle className="tc-art-joint" cx={76} cy={56} r={3} />
        </g>
      )}
      {!still && (
        <text ref={word} className="tc-art-label strong" x={100} y={104} textAnchor="middle">
          Down
        </text>
      )}
    </Art>
  )
}

// ---- 3. Fret just behind the wire ------------------------------------------------

const TRIES = [
  { x: 75, word: 'buzzy', kind: 'buzz' },
  { x: 110, word: 'dead', kind: 'dead' },
  { x: 104, word: 'clean', kind: 'clean' },
] as const

function FretPanel({ x, kind, word }: { x: number; kind: 'buzz' | 'dead' | 'clean'; word: string }) {
  return (
    <>
      <line className="tc-art-string" x1={10} x2={150} y1={62} y2={62} />
      <rect className="tc-art-wire" x={38} y={46} width={3} height={32} />
      <rect className="tc-art-wire" x={109} y={46} width={3} height={32} />
      <ellipse className="tc-tip tc-f1" cx={x} cy={55} rx={8} ry={7} />
      {kind === 'buzz' && <path className="tc-art-buzz" d={wave(x + 10, 150, 62, 2.4, 1, true)} />}
      {kind === 'clean' && <path className="tc-art-wave" d={wave(x + 10, 150, 62, 3, Math.PI / 2)} />}
      <text className={`tc-art-label strong ${kind === 'clean' ? 'good' : ''}`} x={80} y={98} textAnchor="middle">
        {word}
      </text>
    </>
  )
}

function FretArt({ still }: { still: boolean }) {
  const tip = useRef<SVGEllipseElement>(null)
  const fx = useRef<SVGPathElement>(null)
  const ring = useRef<SVGCircleElement>(null)
  const word = useRef<SVGTextElement>(null)
  const lastWord = useRef('')
  const svg = useLoop(4.2, still, (t) => {
    const i = Math.min(2, Math.floor(t / 1.4))
    const k = t - i * 1.4
    const tr = TRIES[i]
    const y = k < 0.2 ? lerp(30, 55, easeOut(k / 0.2)) : k < 1.0 ? 55 : k < 1.2 ? lerp(55, 30, easeIn((k - 1.0) / 0.2)) : 30
    const op = k < 0.2 ? lerp(0.4, 1, k / 0.2) : k < 1.0 ? 1 : k < 1.2 ? lerp(1, 0.4, (k - 1) / 0.2) : 0.4
    tip.current?.setAttribute('cx', String(tr.x))
    tip.current?.setAttribute('cy', y.toFixed(2))
    tip.current?.setAttribute('opacity', op.toFixed(3))
    const on = k >= 0.2 && k < 1.0
    const p = (k - 0.2) * 2 * Math.PI * 9
    const decay = Math.exp(-(k - 0.2) / 0.5)
    if (fx.current) {
      fx.current.setAttribute('class', tr.kind === 'buzz' ? 'tc-art-buzz' : 'tc-art-wave')
      fx.current.setAttribute('d', !on || tr.kind === 'dead' ? `M${tr.x + 10} 62H150` : wave(tr.x + 10, 150, 62, (tr.kind === 'buzz' ? 2.4 : 3) * decay, p, tr.kind === 'buzz'))
      fx.current.setAttribute('opacity', on ? '1' : '0')
    }
    if (ring.current) {
      const rp = clamp01((k - 0.2) / 0.32)
      ring.current.setAttribute('cx', String(tr.x))
      ring.current.setAttribute('r', (9 + 12 * easeOut(rp)).toFixed(2))
      ring.current.setAttribute('opacity', tr.kind === 'clean' && on ? (0.7 * (1 - rp)).toFixed(3) : '0')
    }
    const w = on ? tr.word : ''
    if (w !== lastWord.current && word.current) {
      word.current.textContent = w
      word.current.setAttribute('class', `tc-art-label strong ${tr.kind === 'clean' ? 'good' : ''}`)
      lastWord.current = w
    }
  })
  if (still)
    return (
      <Art label="Three tries: in the middle of the fret buzzes, on the wire sounds dead, just behind the wire rings clean">
        {TRIES.map((tr, i) => (
          <g key={tr.word} transform={`translate(${i * 53} 14) scale(0.33 0.8)`}>
            <FretPanel x={tr.x} kind={tr.kind} word="" />
          </g>
        ))}
        {TRIES.map((tr, i) => (
          <text key={tr.word} className={`tc-art-label strong ${tr.kind === 'clean' ? 'good' : ''}`} x={i * 53 + 27} y={100} textAnchor="middle">
            {tr.word}
          </text>
        ))}
      </Art>
    )
  return (
    <Art svgRef={svg} label="A fingertip tries three spots: the middle of the fret buzzes, the wire sounds dead, just behind the wire rings clean">
      <line className="tc-art-string" x1={10} x2={150} y1={62} y2={62} />
      <rect className="tc-art-wire" x={38} y={46} width={3} height={32} />
      <rect className="tc-art-wire" x={109} y={46} width={3} height={32} />
      <path ref={fx} className="tc-art-wave" d="M0 0" opacity={0} />
      <circle ref={ring} className="tc-art-ring" cy={55} r={9} opacity={0} />
      <ellipse ref={tip} className="tc-tip tc-f1" cx={75} cy={30} rx={8} ry={7} opacity={0.4} />
      <text ref={word} className="tc-art-label strong" x={80} y={98} textAnchor="middle" />
    </Art>
  )
}

// ---- 4. Thumb behind the neck -----------------------------------------------------

const DOTS = [40, 56, 72, 88, 104, 120]

function ThumbArt({ still }: { still: boolean }) {
  const finger = useRef<SVGPathElement>(null)
  const pressed = useRef<SVGCircleElement>(null)
  const clear = useRef<SVGGElement>(null)
  const draw = (t: number) => {
    const inK = t < 0.6 ? easeOut(t / 0.6) : t < 1.8 ? 1 : t < 2.4 ? 1 - easeInOut((t - 1.8) / 0.6) : 0
    const ex = lerp(118, 72, inK)
    const ey = lerp(10, 31, inK)
    finger.current?.setAttribute('d', `M150 92Q152 ${lerp(10, 2, inK).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`)
    const down = inK > 0.95 ? 1.5 : 0
    pressed.current?.setAttribute('cy', String(36 + down))
    clear.current?.setAttribute('opacity', inK > 0.95 ? '1' : '0')
  }
  const svg = useLoop(2.4, still, draw)
  return (
    <Art svgRef={svg} label="Cross-section of the neck: the thumb pad rests behind it and an arched fingertip presses one string while the next string stays free">
      <ellipse className="tc-art-thumb" cx={80} cy={100} rx={18} ry={8} />
      <path className="tc-art-neck" d="M28 40H132V46Q132 96 80 96Q28 96 28 46Z" />
      {DOTS.map((x) => (x === 72 ? null : <circle key={x} className={x === 88 ? 'tc-art-dot free' : 'tc-art-dot'} cx={x} cy={36} r={3} />))}
      <circle ref={pressed} className="tc-art-dot" cx={72} cy={still ? 37.5 : 36} r={3} />
      <g ref={clear} opacity={still ? 1 : 0}>
        <path className="tc-art-clear" d="M80 30Q88 18 96 30" />
        <text className="tc-art-label good" x={104} y={20}>
          still rings
        </text>
      </g>
      <path ref={finger} className="tc-art-finger" d={still ? 'M150 92Q152 2 72 31' : 'M150 92Q152 10 118 10'} />
      <text className="tc-art-label" x={80} y={109} textAnchor="middle">
        thumb
      </text>
    </Art>
  )
}

// ---- 5. Palm mute -------------------------------------------------------------------

function PickMutePanel({ muted, x = 0, w = VW }: { muted: boolean; x?: number; w?: number }) {
  const s = w / VW
  return (
    <g transform={`translate(${x} 0) scale(${s} 1)`}>
      {[48, 60, 72].map((y) => (
        <line key={y} className="tc-art-string" x1={10} x2={140} y1={y} y2={y} />
      ))}
      <rect className="tc-art-bridge" x={138} y={36} width={8} height={48} rx={2} />
      <path className="tc-art-wave" d={wave(10, 118, 60, muted ? 1.2 : 3.2, Math.PI / 2)} />
      <rect className="tc-art-edge" x={118} y={muted ? 38 : 10} width={14} height={44} rx={7} opacity={muted ? 1 : 0.5} />
    </g>
  )
}

function PickMuteArt({ still }: { still: boolean }) {
  const edge = useRef<SVGRectElement>(null)
  const wv = useRef<SVGPathElement>(null)
  const pm = useRef<SVGTextElement>(null)
  const svg = useLoop(3, still, (t) => {
    const down = t < 1 ? 0 : t < 1.25 ? easeOut((t - 1) / 0.25) : t < 2.6 ? 1 : 1 - easeIn((t - 2.6) / 0.4)
    edge.current?.setAttribute('y', lerp(10, 38, down).toFixed(2))
    edge.current?.setAttribute('opacity', lerp(0.5, 1, down).toFixed(3))
    const muted = t >= 1.3 && t < 2.6
    const k = (t % 0.5) - 0.05 // a stroke every half second
    const tau = muted ? 0.05 : 0.45
    const amp = k > 0 ? 3.2 * Math.exp(-k / tau) : 0
    wv.current?.setAttribute('d', wave(10, 118, 60, amp, k * 2 * Math.PI * 14))
    pm.current?.setAttribute('opacity', muted ? '1' : '0')
  })
  if (still)
    return (
      <Art label="Two frames: open strings ring long; with the hand edge on the strings at the bridge, they stop short">
        <PickMutePanel muted={false} x={0} w={78} />
        <PickMutePanel muted x={82} w={78} />
        <text className="tc-art-label strong" x={39} y={100} textAnchor="middle">
          open
        </text>
        <text className="tc-art-label strong" x={121} y={100} textAnchor="middle">
          palm muted
        </text>
      </Art>
    )
  return (
    <Art svgRef={svg} label="The edge of the picking hand drops onto the strings at the bridge and the notes turn short">
      {[48, 60, 72].map((y) => (
        <line key={y} className="tc-art-string" x1={10} x2={140} y1={y} y2={y} />
      ))}
      <path ref={wv} className="tc-art-wave" d={wave(10, 118, 60, 0, 0)} />
      <rect className="tc-art-bridge" x={138} y={36} width={8} height={48} rx={2} />
      <rect ref={edge} className="tc-art-edge" x={118} y={10} width={14} height={44} rx={7} opacity={0.5} />
      <text ref={pm} className="tc-art-label strong" x={125} y={100} textAnchor="middle" opacity={0}>
        PM
      </text>
      <text className="tc-art-label" x={142} y={30} textAnchor="middle">
        bridge
      </text>
    </Art>
  )
}

// ---- 6. Fretting-hand mute --------------------------------------------------------

function FretMuteArt({ still }: { still: boolean }) {
  const tip = useRef<SVGEllipseElement>(null)
  const wv = useRef<SVGPathElement>(null)
  const word = useRef<SVGTextElement>(null)
  const svg = useLoop(2.4, still, (t) => {
    const eased = t >= 1 && t < 2.2
    tip.current?.setAttribute('cy', String(eased ? 51 : 52.5))
    const k = eased ? t - 1 : t
    const tau = eased ? 0.06 : 0.6
    const base = eased ? 3 * Math.exp(-1 / 0.6) : 3
    wv.current?.setAttribute('d', wave(80, 150, 60, base * Math.exp(-k / tau), t * 2 * Math.PI * 9))
    word.current?.setAttribute('opacity', eased ? '1' : '0')
  })
  if (still)
    return (
      <Art label="Two frames: a pressed fingertip lets the string ring; eased off but still touching, the string stops">
        <g transform="scale(0.5 1)">
          <line className="tc-art-string" x1={10} x2={150} y1={60} y2={60} />
          <path className="tc-art-wave" d={wave(80, 150, 60, 3, Math.PI / 2)} />
          <ellipse className="tc-tip tc-f1" cx={70} cy={52.5} rx={8} ry={7} />
        </g>
        <g transform="translate(80 0) scale(0.5 1)">
          <line className="tc-art-string" x1={10} x2={150} y1={60} y2={60} />
          <ellipse className="tc-tip tc-f1" cx={70} cy={51} rx={8} ry={7} />
        </g>
        <text className="tc-art-label strong" x={40} y={96} textAnchor="middle">
          pressed
        </text>
        <text className="tc-art-label strong" x={120} y={96} textAnchor="middle">
          eased off
        </text>
      </Art>
    )
  return (
    <Art svgRef={svg} label="A fingertip presses and the string rings; it eases off but keeps touching and the note stops">
      <line className="tc-art-string" x1={10} x2={80} y1={60} y2={60} />
      <path ref={wv} className="tc-art-wave" d={wave(80, 150, 60, 3, 0)} />
      <ellipse ref={tip} className="tc-tip tc-f1" cx={70} cy={52.5} rx={8} ry={7} />
      <text ref={word} className="tc-art-label strong" x={80} y={96} textAnchor="middle" opacity={0}>
        ease off, keep touching
      </text>
    </Art>
  )
}

// ---- 7. Minimum pressure ----------------------------------------------------------

// The tip rests just behind the wire: light (buzz), then a touch more (clear), never a squeeze.
function PressurePanel({ press }: { press: 'buzz' | 'clear' }) {
  const clear = press === 'clear'
  return (
    <>
      <line className="tc-art-string" x1={10} x2={150} y1={62} y2={62} />
      <rect className="tc-art-wire" x={88} y={46} width={3} height={32} />
      <ellipse className="tc-tip tc-f1" cx={78} cy={clear ? 55 : 53.5} rx={8} ry={7} />
      <path className={clear ? 'tc-art-wave' : 'tc-art-buzz'} d={wave(98, 150, 62, clear ? 3 : 2.4, Math.PI / 2, !clear)} />
    </>
  )
}

function PressureArt({ still }: { still: boolean }) {
  const tip = useRef<SVGEllipseElement>(null)
  const fx = useRef<SVGPathElement>(null)
  const word = useRef<SVGTextElement>(null)
  const lastWord = useRef('')
  const svg = useLoop(3.2, still, (t) => {
    // 0–0.4 the tip comes down lightly, 0.4–1.4 buzz, 1.4–1.6 just a little more, 1.6–2.8 clean, then lift
    const y = t < 0.4 ? lerp(30, 53.5, easeOut(t / 0.4)) : t < 1.4 ? 53.5 : t < 1.6 ? lerp(53.5, 55, easeInOut((t - 1.4) / 0.2)) : t < 2.8 ? 55 : lerp(55, 30, easeIn((t - 2.8) / 0.4))
    tip.current?.setAttribute('cy', y.toFixed(2))
    const buzz = t >= 0.4 && t < 1.4
    const ring = t >= 1.6 && t < 2.8
    if (fx.current) {
      const k = buzz ? t - 0.4 : t - 1.6
      fx.current.setAttribute('class', buzz ? 'tc-art-buzz' : 'tc-art-wave')
      fx.current.setAttribute('d', buzz || ring ? wave(98, 150, 62, buzz ? 2.4 : 3 * Math.exp(-k / 0.9), k * 2 * Math.PI * 9, buzz) : 'M98 62H150')
      fx.current.setAttribute('opacity', buzz || ring ? '1' : '0')
    }
    const w = buzz ? 'buzz: a touch more' : ring ? 'clear: that is enough' : ''
    if (w !== lastWord.current && word.current) {
      word.current.textContent = w
      word.current.setAttribute('class', `tc-art-label strong ${ring ? 'good' : ''}`)
      lastWord.current = w
    }
  })
  if (still)
    return (
      <Art label="Two frames: a light fingertip just behind the fret wire buzzes; a touch more pressure and the note rings clear">
        <g transform="translate(0 6) scale(0.48 0.8)">
          <PressurePanel press="buzz" />
        </g>
        <g transform="translate(84 6) scale(0.48 0.8)">
          <PressurePanel press="clear" />
        </g>
        <path className="tc-art-arrow" d="M66 22H94M90 18l4 4l-4 4" />
        <text className="tc-art-label strong" x={38} y={100} textAnchor="middle">
          buzz
        </text>
        <text className="tc-art-label strong good" x={122} y={100} textAnchor="middle">
          clear
        </text>
      </Art>
    )
  return (
    <Art svgRef={svg} label="A fingertip just behind the fret wire presses lightly and buzzes, then a touch more and the note rings clear">
      <line className="tc-art-string" x1={10} x2={150} y1={62} y2={62} />
      <rect className="tc-art-wire" x={88} y={46} width={3} height={32} />
      <path ref={fx} className="tc-art-wave" d="M98 62H150" opacity={0} />
      <ellipse ref={tip} className="tc-tip tc-f1" cx={78} cy={30} rx={8} ry={7} />
      <text ref={word} className="tc-art-label strong" x={80} y={98} textAnchor="middle" />
    </Art>
  )
}

const ART: Record<BasicsId, (p: { still: boolean; strum: boolean }) => ReactNode> = {
  grip: GripArt,
  wrist: WristArt,
  fret: FretArt,
  thumb: ThumbArt,
  pickMute: PickMuteArt,
  fretMute: FretMuteArt,
  pressure: PressureArt,
}

/** One basics card: the picture, the title and the copy. */
export function BasicsCard({ id, still, strum, mark }: { id: BasicsId; still: boolean; strum: boolean; mark?: string }) {
  const A = ART[id]
  const b = basicsCard(id, strum)
  return (
    <article className="tc-card" aria-label={b.title}>
      <div className="tc-card-art">
        <A still={still} strum={strum} />
      </div>
      {mark && <p className="tc-card-mark">{mark}</p>}
      <h3 className="tc-card-title">{b.title}</h3>
      <p className="tc-card-copy">{b.copy}</p>
    </article>
  )
}
