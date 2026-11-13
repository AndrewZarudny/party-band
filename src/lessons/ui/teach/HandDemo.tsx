// Fretting-hand close-up: four numbered fingertips hovering over a fret window, landing in time.
// One rAF loop writes SVG attributes through refs; React renders the skeleton once.
import { useEffect, useId, useMemo, useRef } from 'react'
import type { Chart, ChartFingering, HandFrame, NoteEv } from '../../types'
import { firstPhrase, handFrame } from '../../fingering'
import { DemoClock } from './clock'
import { Glide, clamp01, easeIn, easeInOut, easeOut, easeOutBack, lerp } from './motion'
import { STRING_SHORT, phraseLabel, stepNow, stepsOf } from './phrase'
import { useFrame } from './useFrame'
import './teach.css'

const W = 360
const H = 150
const GUT = 24
const SP = 52 // one fret space
const XR = 340 // right end of the strings: six whole fret spaces show
const LAND = 0.08 // s: the tip lands this long before the onset
const LIFT = 0.16
const MOVE = 0.16
const SHIFT = 0.22
const PAN = 0.26
const RING = 0.32
const SQUASH = 0.14
const strY = (s: number) => 22 + (5 - s) * 20
const wireX = (n: number) => GUT + n * SP // board coords; n = 0 is the nut
const tipX = (fret: number) => GUT + (fret - 0.3) * SP // just behind the wire
const INLAYS = [3, 5, 7, 9, 12, 15]

interface TipRefs {
  g: SVGGElement | null
  shadow: SVGEllipseElement | null
  ring: SVGCircleElement | null
}
interface TipState {
  down: Glide
  x: Glide
  y: Glide
}

function lifted(fr: HandFrame): HandFrame {
  return { ...fr, tips: fr.tips.map((t) => ({ ...t, down: false, active: false })), barre: null }
}

const bendWord = (semis: number) => (semis === 1 ? 'Bend ½' : semis === 2 ? 'Bend full' : `Bend ${semis / 2}`)

/** In loop mode `beatNow` is the shared demo clock (DemoClock.beat); without it the demo keeps its own. */
export function HandDemo({
  chart,
  fingering,
  mode,
  beatNow,
  bpm,
}: {
  chart: Chart
  fingering: ChartFingering
  mode: 'loop' | 'follow'
  beatNow?: () => number
  bpm: number
}) {
  const phrase = useMemo(() => firstPhrase(chart), [chart])
  const phraseSteps = useMemo(() => stepsOf(chart, fingering, phrase.from, phrase.to), [chart, fingering, phrase])
  const allSteps = useMemo(() => stepsOf(chart, fingering), [chart, fingering])
  const byId = useMemo(() => new Map(allSteps.map((s) => [s.id, s])), [allSteps])
  const follow = mode === 'follow' && !!beatNow
  const steps = follow ? allSteps : phraseSteps
  const anyFretted = steps.some((s) => s.pos !== null)
  const maxFret = useMemo(() => Math.min(24, Math.max(10, ...allSteps.map((s) => (s.kind === 'chord' ? Math.max(0, ...(s.frets ?? [])) : s.fret + 4)))), [allSteps])
  const minPos = useMemo(() => {
    const ps = steps.map((s) => s.pos).filter((p): p is number => p !== null)
    return ps.length ? Math.min(...ps) : 1
  }, [steps])

  const svgRef = useRef<SVGSVGElement>(null)
  const boardRef = useRef<SVGGElement>(null)
  const bandRef = useRef<SVGRectElement>(null)
  const bandLabelRef = useRef<SVGTextElement>(null)
  const stringRefs = useRef<(SVGPathElement | null)[]>([])
  const tipRefs = useRef<TipRefs[]>([0, 1, 2, 3].map(() => ({ g: null, shadow: null, ring: null })))
  const barreRef = useRef<SVGRectElement>(null)
  const openRef = useRef<SVGGElement>(null)
  const hpRef = useRef<SVGTextElement>(null)
  const slideRef = useRef<SVGGElement>(null)
  const slideLineRef = useRef<SVGLineElement>(null)
  const slideTextRef = useRef<SVGTextElement>(null)
  const chipRef = useRef<SVGGElement>(null)
  const chipTextRef = useRef<SVGTextElement>(null)
  const chipArrowRef = useRef<SVGPathElement>(null)
  const muteRef = useRef<SVGGElement>(null)
  const bendRef = useRef<SVGTextElement>(null)
  const nowRef = useRef<HTMLParagraphElement>(null)

  // Per-mount motion state
  const st = useRef<{
    tips: TipState[]
    win: Glide
    band: Glide
    bandOn: Glide
    caption: string
    bandText: string
    chipText: string
  } | null>(null)
  if (st.current === null) {
    st.current = {
      tips: [1, 2, 3, 4].map((k) => ({ down: new Glide(0), x: new Glide(tipX(k)), y: new Glide(strY(0)) })),
      win: new Glide(1),
      band: new Glide(1),
      bandOn: new Glide(1),
      caption: '',
      bandText: '',
      chipText: '',
    }
  }

  // A new phrase or mode starts the window at its lowest position.
  useEffect(() => {
    st.current!.win.jump(Math.max(1, minPos - 1))
  }, [minPos, mode, chart])

  // Loop mode without a shared clock keeps its own.
  const ownClock = useMemo(() => new DemoClock(chart, fingering, bpm), [chart, fingering, bpm])
  const clock = beatNow ?? ownClock.beat

  useFrame(
    (now) => {
      const s = st.current!
      const spb = 60 / bpm
      const len = phrase.to - phrase.from + 1
      const b = clock()
      const gap = !follow && b >= phrase.to

      const frameAt = (x: number): HandFrame => {
        if (follow) return handFrame(chart, fingering, x)
        let y = x
        while (y >= phrase.from + len) y -= len
        if (y >= phrase.to) return lifted(handFrame(chart, fingering, phrase.to - 1e-4))
        return handFrame(chart, fingering, Math.max(y, phrase.from - 4))
      }
      const F0 = gap ? lifted(handFrame(chart, fingering, phrase.to - 1e-4)) : frameAt(b)
      const FL = frameAt(b + LAND / spb)
      const FS = frameAt(b + (SHIFT + 0.04) / spb)
      const cur = F0.eventId !== null ? chart.events[F0.eventId] : null
      const curStep = F0.eventId !== null ? byId.get(F0.eventId) : undefined
      const sinceSec = F0.sinceBeat * spb
      const sounding = !!cur && F0.sinceBeat < cur.dur && !gap

      // Window: pan when the hand leaves it
      // an open-strings phrase keeps the hand at the nut
      const handPos = anyFretted ? (FS.pos ?? 1) : 1
      const need = [handPos, ...FS.tips.filter((t) => t.down).map((t) => t.fret), ...FL.tips.filter((t) => t.down).map((t) => t.fret)]
      const lo = Math.min(...need)
      const hi = Math.max(handPos + 3, ...need)
      const wt = s.win.target
      if (lo < wt || hi > wt + 5) {
        let nt = Math.max(1, lo - 1)
        if (hi > nt + 5) nt = hi - 5
        s.win.set(nt, now, PAN, easeInOut)
      }
      const win = s.win.at(now)
      const off = (win - 1) * SP
      boardRef.current?.setAttribute('transform', `translate(${-off} 0)`)

      // Position band
      const pos = anyFretted ? FS.pos : null
      if (pos !== null) s.band.set(pos, now, SHIFT, easeInOut)
      s.bandOn.set(pos !== null ? 1 : 0, now, 0.16, easeOut)
      const bp = s.band.at(now)
      const band = bandRef.current
      if (band) {
        band.setAttribute('x', String(wireX(bp - 1) + 3))
        band.setAttribute('opacity', String(s.bandOn.at(now)))
      }
      const bandText = pos !== null ? `Hand at fret ${pos}` : 'Open strings'
      if (bandText !== s.bandText && bandLabelRef.current) {
        bandLabelRef.current.textContent = bandText
        s.bandText = bandText
      }
      bandLabelRef.current?.setAttribute('x', String(pos !== null ? Math.max(GUT + 4, wireX(bp - 1) + 6 - off) : GUT + 4))

      // Chord landing order: low strings first, 60 ms apart
      const chordRank = new Map<number, number>()
      if (FL.eventId !== null && chart.events[FL.eventId]?.kind === 'chord') {
        FL.tips
          .filter((t) => t.down)
          .sort((a, c) => a.string - c.string)
          .forEach((t, i) => chordRank.set(t.finger, i))
      }

      // Bend: the string is pushed toward the low E (down the screen) over the note
      let bendS = -1
      let bendPush = 0
      let bendX = 0
      if (sounding && cur?.kind === 'note' && cur.tech === 'bend') {
        bendS = cur.string
        bendPush = 8 * easeInOut(clamp01(F0.sinceBeat / cur.dur))
        bendX = tipX(cur.fret) - off
      }

      // Tips
      const downOn: { s: number; x: number; d: number }[] = []
      for (let i = 0; i < 4; i++) {
        const ts = s.tips[i]
        const t0 = F0.tips[i]
        const tl = FL.tips[i]
        const tsh = FS.tips[i]
        const want = t0.down || tl.down
        const src = tl.down ? tl : t0.down ? t0 : anyFretted ? tsh : { ...tsh, fret: i + 1 }
        const rank = chordRank.get(i + 1)
        if (want) ts.down.set(1, now, LAND, easeIn, rank !== undefined ? rank * 0.06 : 0)
        else ts.down.set(0, now, LIFT, easeOut)
        const moveDur = tl.down && !t0.down ? LAND : FS.pos !== F0.pos ? SHIFT : MOVE
        ts.x.set(tipX(src.fret), now, moveDur, easeInOut)
        ts.y.set(strY(src.string), now, moveDur, easeInOut)

        const d = ts.down.at(now)
        let x = ts.x.at(now) - off
        let y = ts.y.at(now)
        const shadowY = y + (bendS === src.string ? bendPush : 0) + 3
        const active = t0.active && t0.down && sounding
        let sx = 1
        let sy = 1
        let op = lerp(0.38, 1, d)
        if (active && sinceSec >= 0 && sinceSec < SQUASH && cur?.kind !== 'mute') {
          const e = easeOutBack(sinceSec / SQUASH)
          sx = lerp(1.12, 1, e)
          sy = lerp(0.9, 1, e)
        }
        if (active && cur?.kind === 'note' && cur.tech === 'vibrato') y += 2 * Math.sin(2 * Math.PI * 5 * sinceSec)
        if (bendS >= 0 && t0.string === bendS && t0.down) {
          y += bendPush
          if (!t0.active) op *= 0.7
        }
        if (d > 0.5) downOn.push({ s: src.string, x, d })
        const sc = lerp(0.86, 1, d)
        x += -3 * (1 - d)
        y += -4 * (1 - d)
        const r = tipRefs.current[i]
        r.g?.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(sc * sx).toFixed(3)} ${(sc * sy).toFixed(3)})`)
        r.g?.setAttribute('opacity', op.toFixed(3))
        r.shadow?.setAttribute('cx', (x + 3 * (1 - d)).toFixed(2))
        r.shadow?.setAttribute('cy', shadowY.toFixed(2))
        // Pluck ring on a picked onset
        const ring = r.ring
        if (ring) {
          const pickOn = active && curStep?.pick !== null && cur?.kind === 'note'
          if (pickOn && sinceSec >= 0 && sinceSec < RING) {
            const p = easeOut(sinceSec / RING)
            ring.setAttribute('cx', (x + 3 * (1 - d)).toFixed(2))
            ring.setAttribute('cy', (y + 4 * (1 - d)).toFixed(2))
            ring.setAttribute('r', (11 + 13 * p).toFixed(2))
            ring.setAttribute('stroke-width', (2 - 1.5 * p).toFixed(2))
            ring.setAttribute('opacity', (0.7 * (1 - p)).toFixed(3))
          } else ring.setAttribute('opacity', '0')
        }
      }

      // Barre
      const barre = barreRef.current
      if (barre) {
        const br = F0.barre ?? FL.barre
        if (br && (F0.tips[0].down || FL.tips[0].down)) {
          const y1 = strY(br.to)
          const y2 = strY(br.from)
          barre.setAttribute('x', String(tipX(br.fret) - off - 5))
          barre.setAttribute('y', String(y1 - 8))
          barre.setAttribute('height', String(y2 - y1 + 16))
          barre.setAttribute('opacity', String(s.tips[0].down.at(now)))
        } else barre.setAttribute('opacity', '0')
      }

      // Strings: dips under pressed tips, bend push, and the pluck as a decaying standing wave
      const amp = [0, 0, 0, 0, 0, 0]
      const from = [GUT, GUT, GUT, GUT, GUT, GUT]
      if (cur && !gap && F0.sinceBeat >= 0) {
        if (cur.kind === 'note') {
          const t = sinceSec
          amp[cur.string] = (curStep?.legato ? 1.4 : 2.2) * Math.exp(-t / 0.25) * Math.sin(2 * Math.PI * 18 * t)
          if (cur.fret > 0) from[cur.string] = tipX(cur.fret) - off
        } else if (cur.kind === 'chord') {
          const order = cur.frets.map((f, si) => (f >= 0 ? si : -1)).filter((si) => si >= 0)
          if (F0.pick === 'U') order.reverse()
          order.forEach((si, rk) => {
            const t = sinceSec - rk * 0.015
            if (t > 0) amp[si] = 2.2 * Math.exp(-t / 0.25) * Math.sin(2 * Math.PI * 18 * t)
            if (cur.frets[si] > 0) from[si] = tipX(cur.frets[si]) - off
          })
        }
      }
      for (let si = 0; si < 6; si++) {
        const path = stringRefs.current[si]
        if (!path) continue
        const y0 = strY(si)
        const dips = downOn.filter((q) => q.s === si)
        const bent = si === bendS && bendPush > 0
        const vib = Math.abs(amp[si]) > 0.05
        if (!dips.length && !bent && !vib) {
          path.setAttribute('d', `M${GUT} ${y0}H${XR}`)
          continue
        }
        let dd = ''
        for (let x = GUT; x <= XR; x += 4) {
          let y = y0
          for (const q of dips) y += Math.max(0, 2 * q.d * (1 - Math.abs(x - q.x) / 14))
          if (bent) y += x <= bendX ? (bendPush * (x - GUT)) / Math.max(1, bendX - GUT) : (bendPush * (XR - x)) / Math.max(1, XR - bendX)
          if (vib && x > from[si]) y += amp[si] * Math.sin((Math.PI * (x - from[si])) / Math.max(1, XR - from[si]))
          dd += (dd ? 'L' : 'M') + x + ' ' + y.toFixed(2)
        }
        path.setAttribute('d', dd)
      }

      // Open string: no tip lands; the string lights up and a "0" sits at the nut
      const open = sounding && cur?.kind === 'note' && cur.fret === 0
      for (let si = 0; si < 6; si++) stringRefs.current[si]?.classList.toggle('tc-lit', !!open && cur?.kind === 'note' && cur.string === si)
      if (openRef.current) {
        openRef.current.setAttribute('opacity', open ? '1' : '0')
        if (open && cur?.kind === 'note') openRef.current.setAttribute('transform', `translate(${GUT + 9} ${strY(cur.string)})`)
      }

      // Hammer / pull letter between the two tips; a slide's motion line
      const prev = curStep ? steps[steps.findIndex((x) => x.id === curStep.id) - 1] : undefined
      const legatoPair = sounding && cur?.kind === 'note' && prev?.kind === 'note' && prev.string === cur.string
      const hp = hpRef.current
      if (hp) {
        if (legatoPair && cur?.kind === 'note' && (cur.tech === 'hammer' || cur.tech === 'pull') && prev) {
          hp.textContent = cur.tech === 'hammer' ? 'h' : 'p'
          hp.setAttribute('x', ((tipX(prev.fret) + tipX(cur.fret)) / 2 - off).toFixed(1))
          hp.setAttribute('y', String(strY(cur.string) - 13))
          hp.setAttribute('opacity', '1')
        } else hp.setAttribute('opacity', '0')
      }
      const sl = slideRef.current
      if (sl) {
        if (legatoPair && cur?.kind === 'note' && cur.tech === 'slide' && prev) {
          const x1 = tipX(prev.fret) - off
          const x2 = tipX(cur.fret) - off
          const y = strY(cur.string) - 12
          slideLineRef.current?.setAttribute('x1', x1.toFixed(1))
          slideLineRef.current?.setAttribute('x2', x2.toFixed(1))
          slideLineRef.current?.setAttribute('y1', String(y))
          slideLineRef.current?.setAttribute('y2', String(y))
          slideTextRef.current?.setAttribute('x', ((x1 + x2) / 2).toFixed(1))
          slideTextRef.current?.setAttribute('y', String(y - 4))
          sl.setAttribute('opacity', String(clamp01(1 - (F0.sinceBeat / cur.dur - 0.7) / 0.3)))
        } else sl.setAttribute('opacity', '0')
      }

      // Shift chip: fades in up to 300 ms before the move, out 300 ms after
      const lookB = Math.min(1, 0.3 / spb)
      const FX = frameAt(b + lookB)
      let chip: { from: number; to: number; op: number } | null = null
      if (F0.shift?.kind === 'shift' && sinceSec < 0.42 && !gap) chip = { ...F0.shift, op: sinceSec < 0.3 ? 1 : clamp01(1 - (sinceSec - 0.3) / 0.12) }
      const fxNew = FX.eventId !== F0.eventId || FX.callIdx !== F0.callIdx
      if (fxNew && FX.shift?.kind === 'shift' && FX.sinceBeat < lookB) chip = { ...FX.shift, op: clamp01((FX.sinceBeat * spb) / 0.12) }
      const cg = chipRef.current
      if (cg) {
        cg.setAttribute('opacity', chip ? chip.op.toFixed(3) : '0')
        if (chip) {
          const txt = `Move to fret ${chip.to}`
          if (txt !== s.chipText && chipTextRef.current) {
            chipTextRef.current.textContent = txt
            s.chipText = txt
          }
          chipArrowRef.current?.setAttribute('transform', chip.to > chip.from ? '' : 'rotate(180)')
        }
      }

      // Muted scratch: the hand lies flat across the strings
      const mg = muteRef.current
      if (mg) {
        const on = sounding && cur?.kind === 'mute'
        mg.setAttribute('opacity', on ? '1' : '0')
        if (on) mg.setAttribute('transform', `translate(${(tipX((F0.pos ?? 1) + 1.5) - off).toFixed(1)} 0)`)
      }

      // Bend amount over the tip
      const bl = bendRef.current
      if (bl) {
        if (bendS >= 0 && cur?.kind === 'note') {
          const n = cur as NoteEv
          bl.textContent = bendWord((n.bendTo ?? n.midi + 2) - n.midi)
          bl.setAttribute('x', bendX.toFixed(1))
          bl.setAttribute('y', String(strY(bendS) - 16))
          bl.setAttribute('opacity', '1')
        } else bl.setAttribute('opacity', '0')
      }

      // The line under the demo
      let caption: string
      if (F0.callIdx !== null) caption = 'Listen to the call'
      else if (curStep && sounding) caption = stepNow(curStep)
      else {
        const nx = F0.nextId !== null ? byId.get(F0.nextId) : steps[0]
        caption = nx && (!follow || F0.nextId !== null) ? 'Get ready: ' + stepNow(gap ? steps[0] ?? nx : nx) : ''
      }
      if (caption !== s.caption && nowRef.current) {
        nowRef.current.textContent = caption
        s.caption = caption
      }
    },
    steps.length > 0,
    svgRef,
  )

  const label = useMemo(() => phraseLabel(phraseSteps), [phraseSteps])
  const clipId = 'tc-clip' + useId().replace(/:/g, '')
  const visibleTo = Math.min(maxFret, 24)

  return (
    <figure className="tc-hand">
      <svg ref={svgRef} className="tc-hand-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <clipPath id={clipId}>
            <rect x={GUT - 3} y={0} width={XR - GUT + 3} height={H} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <g ref={boardRef}>
            <rect ref={bandRef} className="tc-band" x={wireX(0)} y={8} width={4 * SP - 6} height={128} rx={10} />
            {INLAYS.filter((n) => n <= visibleTo).map((n) => (
              <circle key={n} className="tc-inlay" cx={wireX(n) - SP / 2} cy={strY(3) + 10} r={4} />
            ))}
            {Array.from({ length: visibleTo + 1 }, (_, n) =>
              n === 0 ? (
                <rect key={n} className="tc-nut" x={GUT - 5} y={strY(5) - 4} width={5} height={strY(0) - strY(5) + 8} />
              ) : (
                <rect key={n} className="tc-wire" x={wireX(n) - 1.5} y={strY(5) - 4} width={3} height={strY(0) - strY(5) + 8} />
              ),
            )}
            {Array.from({ length: visibleTo }, (_, i) => (
              <text key={i} className="tc-fretnum" x={wireX(i + 1) - SP / 2} y={H - 4} textAnchor="middle">
                {i + 1}
              </text>
            ))}
          </g>
          {[0, 1, 2, 3, 4, 5].map((si) => (
            <path
              key={si}
              ref={(el) => {
                stringRefs.current[si] = el
              }}
              className="tc-string"
              d={`M${GUT} ${strY(si)}H${XR}`}
              strokeWidth={1 + (5 - si) * 0.3}
            />
          ))}
          <rect ref={barreRef} className="tc-barre" x={0} y={0} width={10} height={10} rx={5} opacity={0} />
          <g ref={muteRef} className="tc-mutehand" opacity={0}>
            <rect x={-9} y={strY(5) - 8} width={18} height={strY(0) - strY(5) + 16} rx={9} />
            <text x={0} y={strY(5) - 11} textAnchor="middle">
              Mute
            </text>
          </g>
          {[0, 1, 2, 3].map((i) => (
            <ellipse
              key={i}
              ref={(el) => {
                tipRefs.current[i].shadow = el
              }}
              className="tc-tip-shadow"
              cx={tipX(i + 1)}
              cy={strY(0)}
              rx={9}
              ry={4}
            />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <circle
              key={i}
              ref={(el) => {
                tipRefs.current[i].ring = el
              }}
              className={`tc-ring tc-fs${i + 1}`}
              r={11}
              opacity={0}
            />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <g
              key={i}
              ref={(el) => {
                tipRefs.current[i].g = el
              }}
              opacity={0.38}
            >
              <ellipse className={`tc-tip tc-f${i + 1}`} rx={10} ry={9} />
              <text className="tc-tip-num" y={4} textAnchor="middle">
                {i + 1}
              </text>
            </g>
          ))}
          <text ref={hpRef} className="tc-hp" textAnchor="middle" opacity={0} />
          <g ref={slideRef} className="tc-slide" opacity={0}>
            <line ref={slideLineRef} />
            <text ref={slideTextRef} textAnchor="middle">
              Slide
            </text>
          </g>
          <text ref={bendRef} className="tc-bendlabel" textAnchor="middle" opacity={0} />
        </g>
        {[0, 1, 2, 3, 4, 5].map((si) => (
          <text key={si} className="tc-strname" x={8} y={strY(si) + 4} textAnchor="middle">
            {STRING_SHORT[si]}
          </text>
        ))}
        <g ref={openRef} className="tc-open" opacity={0}>
          <circle r={7} />
          <text y={3.5} textAnchor="middle">
            0
          </text>
        </g>
        <text ref={bandLabelRef} className="tc-bandlabel" x={GUT + 4} y={11} />
        <g ref={chipRef} className="tc-chip" opacity={0} transform={`translate(${XR - 114} 1)`}>
          <rect width={114} height={16} rx={8} />
          <g transform="translate(11 8)">
            <path ref={chipArrowRef} d="M-3.5 2 0 -2 3.5 2" />
          </g>
          <text ref={chipTextRef} x={20} y={11.5} />
        </g>
      </svg>
      <figcaption className="tc-now" ref={nowRef} aria-hidden />
    </figure>
  )
}
