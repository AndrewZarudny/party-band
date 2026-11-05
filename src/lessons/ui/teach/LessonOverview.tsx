// The whole lesson at a glance: bars in rows, a tab staff with fingers and picks, and a playhead while watching.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Chart, ChartFingering, ChordEv, Lesson, NoteEv } from '../../types'
import { ChordDiagram } from '../../../components/PartViews'
import { OV_ROW_H, beatToPoint, overviewLayout } from './layout'
import type { OvBar, OvLayout } from './layout'
import { useFrame, useStill, useWidth } from './useFrame'
import './teach.css'

const lineY = (s: number) => 18 + (5 - s) * 12 // high e on top
const FINGER_Y = 92
const PICK_Y = 105.5
const STRUM_Y = 48
const COUNTS = ['1', '&', '2', '&', '3', '&', '4', '&']

const ROLE_WORD: Record<string, string> = { call: 'Call', answer: 'Your answer', echo: 'Copy it' }

const bend = (n: NoteEv) => {
  const d = (n.bendTo ?? n.midi) - n.midi
  return d === 1 ? '½' : d === 2 ? 'full' : `${d / 2}`
}

/** A small pick: filled pointing down, outline pointing up. */
function PickGlyph({ x, y, dir }: { x: number; y: number; dir: 'D' | 'U' }) {
  return <path className={dir === 'D' ? 'tc-ov-pick down' : 'tc-ov-pick up'} d="M-3.5 -3Q0 -5 3.5 -3Q0 5 -3.5 -3Z" transform={`translate(${x} ${y})${dir === 'U' ? ' rotate(180)' : ''}`} />
}

function FingerDot({ x, y, finger }: { x: number; y: number; finger: number }) {
  if (finger === 0)
    return (
      <g className="tc-ov-open" transform={`translate(${x} ${y})`}>
        <circle r={5.5} />
        <text y={3} textAnchor="middle">
          0
        </text>
      </g>
    )
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle className={`tc-tip tc-f${finger}`} r={6.5} />
      <text className="tc-ov-fnum" y={3.5} textAnchor="middle">
        {finger}
      </text>
    </g>
  )
}

function Chip({ x, y, text, kind }: { x: number; y: number; text: string; kind?: string }) {
  const w = text.length * 5.6 + 10
  return (
    <g className={`tc-ov-chip ${kind ?? ''}`} transform={`translate(${x - w} ${y})`}>
      <rect width={w} height={13} rx={6.5} />
      <text x={w / 2} y={9.5} textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

function ShiftTag({ x, min, to, up }: { x: number; min: number; to: number; up: boolean }) {
  // never over the bar number or the chord name on the same line
  return (
    <g className="tc-ov-shift" transform={`translate(${Math.max(x, min)} 1)`}>
      <rect x={-13} width={26} height={13} rx={6.5} />
      <path d={up ? 'M-8 8.5 -5.5 5 -3 8.5' : 'M-8 5 -5.5 8.5 -3 5'} />
      <text x={4} y={10} textAnchor="middle">
        {to}
      </text>
    </g>
  )
}

/** Everything that doesn't move: memoised so a playhead frame never re-renders it. */
function useStatic(lesson: Lesson, chart: Chart, f: ChartFingering, l: OvLayout, onBar: (bar: number) => void): ReactNode {
  return useMemo(() => {
    if (!l.bars.length) return null
    const strumOnly = (lesson.type === 'chords' || lesson.type === 'rhythm') && !chart.events.some((e) => e.kind === 'note')
    const improv = lesson.type === 'improv'
    const listen = new Set(chart.listenBars)
    const roles = new Map((chart.improvBars ?? []).map((r) => [r.bar, r.role]))
    const xIn = (bar: OvBar, beat: number) => bar.x + 10 + ((beat - bar.bar * 4) / 4) * (bar.w - 16)
    const evByBar: ChartEventsByBar = new Map()
    for (const e of chart.events) {
      const k = Math.floor(e.beat / 4 + 1e-9)
      if (!evByBar.has(k)) evByBar.set(k, [])
      evByBar.get(k)!.push(e.id)
    }
    const callsByBar = new Map<number, number[]>()
    chart.calls.forEach((c, i) => {
      const k = Math.floor(c.beat / 4 + 1e-9)
      if (!callsByBar.has(k)) callsByBar.set(k, [])
      callsByBar.get(k)!.push(i)
    })

    return l.bars.map((bar) => {
      const y0 = bar.row * OV_ROW_H
      const ids = evByBar.get(bar.bar) ?? []
      const calls = callsByBar.get(bar.bar) ?? []
      const sym = chart.chordTimeline[bar.bar]?.symbol ?? ''
      const prevSym = bar.bar > 0 ? (chart.chordTimeline[bar.bar - 1]?.symbol ?? '') : ''
      const showSym = sym && (sym !== prevSym || bar.bar % l.barsPerRow === 0)
      const role = roles.get(bar.bar)
      const chip = role ? ROLE_WORD[role] : listen.has(bar.bar) ? 'Listen' : ''
      const parts: ReactNode[] = []
      const labelEnd = showSym ? bar.x + 18 + sym.length * 6.6 : bar.x + 4 + String(bar.bar + 1).length * 6
      const tagMin = labelEnd + 3 + 13

      // staff, or the strum lane for strum-only lessons
      if (strumOnly) {
        parts.push(<line key="lane" className="tc-ov-lane" x1={bar.x + 4} x2={bar.x + bar.w - 4} y1={STRUM_Y} y2={STRUM_Y} />)
        COUNTS.forEach((c, j) =>
          parts.push(
            <text key={'c' + j} className="tc-ov-count" x={xIn(bar, bar.bar * 4 + j / 2)} y={FINGER_Y + 3} textAnchor="middle">
              {c}
            </text>,
          ),
        )
      } else {
        for (let s = 0; s < 6; s++) parts.push(<line key={'s' + s} className="tc-ov-line" x1={bar.x + 2} x2={bar.x + bar.w - 2} y1={lineY(s)} y2={lineY(s)} />)
      }
      parts.push(<line key="bl" className="tc-ov-barline" x1={bar.x + bar.w - 1} x2={bar.x + bar.w - 1} y1={lineY(5)} y2={lineY(0)} />)

      // calls: faint
      for (const ci of calls) {
        const c = chart.calls[ci]
        const x = xIn(bar, c.beat)
        const cf = f.calls[ci]
        parts.push(
          <g key={'k' + ci} className="tc-ov-call">
            <rect className="tc-ov-ko" x={x - 6} y={lineY(c.string) - 6} width={12} height={12} rx={3} />
            <text className="tc-ov-fret" x={x} y={lineY(c.string) + 4} textAnchor="middle">
              {c.fret}
            </text>
            {cf && <FingerDot x={x} y={FINGER_Y} finger={Number(cf.finger) || 0} />}
          </g>,
        )
      }

      // improv bars with nothing written: a label
      if (improv && !calls.length) {
        parts.push(
          <text key="solo" className="tc-ov-solo" x={bar.x + bar.w / 2} y={lineY(2) + 4} textAnchor="middle">
            {role ? ROLE_WORD[role] : 'Your solo'}
          </text>,
        )
      }

      let prevNote: NoteEv | null = null
      for (const id of ids) {
        const e = chart.events[id]
        const ef = f.events[id]
        const x = xIn(bar, e.beat)
        if (e.kind === 'note') {
          const y = lineY(e.string)
          const nf = ef?.kind === 'note' ? ef : null
          parts.push(
            <g key={'n' + id}>
              <rect className="tc-ov-ko" x={x - (e.fret >= 10 ? 8 : 6)} y={y - 6} width={e.fret >= 10 ? 16 : 12} height={12} rx={3} />
              <text className="tc-ov-fret" x={x} y={y + 4} textAnchor="middle">
                {e.hidden ? '?' : e.fret}
              </text>
            </g>,
          )
          // techniques
          if ((e.tech === 'hammer' || e.tech === 'pull') && prevNote && prevNote.string === e.string) {
            const px = xIn(bar, prevNote.beat)
            parts.push(
              <g key={'t' + id} className="tc-ov-tech">
                <path d={`M${px + 3} ${y - 7}Q${(px + x) / 2} ${y - 14} ${x - 3} ${y - 7}`} />
                <text x={(px + x) / 2} y={y - 13} textAnchor="middle">
                  {e.tech === 'hammer' ? 'h' : 'p'}
                </text>
              </g>,
            )
          } else if (e.tech === 'slide' && prevNote && prevNote.string === e.string) {
            const px = xIn(bar, prevNote.beat)
            const up = e.fret > prevNote.fret
            parts.push(
              <g key={'t' + id} className="tc-ov-tech">
                <path d={`M${px + 6} ${y + (up ? 3 : -3)}L${x - 6} ${y + (up ? -3 : 3)}`} />
                <text x={(px + x) / 2} y={y - 6} textAnchor="middle">
                  sl
                </text>
              </g>,
            )
          } else if (e.tech === 'bend') {
            parts.push(
              <g key={'t' + id} className="tc-ov-tech">
                <path d={`M${x + 6} ${y - 1}Q${x + 11} ${y - 2} ${x + 11} ${y - 10}M${x + 8.5} ${y - 7.5}L${x + 11} ${y - 10.5}L${x + 13.5} ${y - 7.5}`} />
                <text x={x + 12} y={y - 12} textAnchor="middle">
                  {bend(e)}
                </text>
              </g>,
            )
          } else if (e.tech === 'vibrato') {
            parts.push(<path key={'t' + id} className="tc-ov-vib" d={`M${x + 7} ${y - 7}q2 -3 4 0t4 0t4 0`} />)
          }
          if (nf?.palmMute) {
            parts.push(
              <text key={'pm' + id} className="tc-ov-pm" x={x} y={lineY(5) - 7} textAnchor="middle">
                PM
              </text>,
            )
          }
          if (nf && !e.hidden) parts.push(<FingerDot key={'f' + id} x={x} y={FINGER_Y} finger={Number(nf.finger) || 0} />)
          if (nf?.pick && !nf.legato) parts.push(<PickGlyph key={'p' + id} x={x} y={PICK_Y} dir={nf.pick} />)
          if (nf?.shift?.kind === 'shift') parts.push(<ShiftTag key={'sh' + id} x={x} min={tagMin} to={nf.shift.to} up={nf.shift.to > nf.shift.from} />)
          prevNote = e
        } else if (e.kind === 'chord') {
          prevNote = null
          const cf = ef?.kind === 'chord' ? ef : null
          if (strumOnly) {
            const dir = e.dir === 'U' ? 'U' : 'D'
            parts.push(
              <path
                key={'a' + id}
                className={`tc-ov-strum ${e.dir === 'P' ? 'pm' : ''}`}
                d={dir === 'D' ? `M${x} ${STRUM_Y - 10}V${STRUM_Y + 8}M${x - 4} ${STRUM_Y + 4}L${x} ${STRUM_Y + 9}L${x + 4} ${STRUM_Y + 4}` : `M${x} ${STRUM_Y + 10}V${STRUM_Y - 8}M${x - 4} ${STRUM_Y - 4}L${x} ${STRUM_Y - 9}L${x + 4} ${STRUM_Y - 4}`}
              />,
            )
            if (e.dir === 'P')
              parts.push(
                <text key={'pm' + id} className="tc-ov-pm" x={x} y={STRUM_Y - 14} textAnchor="middle">
                  PM
                </text>,
              )
          } else {
            // a chord column inside a notes lesson: stacked frets with their fingers
            e.frets.forEach((fr, s) => {
              if (fr < 0) return
              const k = cf?.fingering.fingers[s]
              parts.push(
                <g key={`c${id}-${s}`}>
                  <rect className="tc-ov-ko" x={x - 6} y={lineY(s) - 6} width={12} height={12} rx={3} />
                  <text className="tc-ov-fret" x={x} y={lineY(s) + 4} textAnchor="middle">
                    {fr}
                  </text>
                  {typeof k === 'number' && k > 0 && (
                    <text className={`tc-ov-sup tc-fs${k}`} x={x + 7} y={lineY(s) - 2}>
                      {k}
                    </text>
                  )}
                </g>,
              )
            })
            if (cf) parts.push(<PickGlyph key={'p' + id} x={x} y={PICK_Y} dir={cf.pick} />)
          }
          if (cf?.shift?.kind === 'shift') parts.push(<ShiftTag key={'sh' + id} x={x} min={tagMin} to={cf.shift.to} up={cf.shift.to > cf.shift.from} />)
        } else if (e.kind === 'mute') {
          prevNote = null
          parts.push(
            <text key={'x' + id} className="tc-ov-x" x={x} y={(strumOnly ? STRUM_Y : lineY(2)) + 4} textAnchor="middle">
              x
            </text>,
          )
          const mf = ef?.kind === 'mute' ? ef : null
          if (mf && !strumOnly) parts.push(<PickGlyph key={'p' + id} x={x} y={PICK_Y} dir={mf.pick} />)
        } else {
          prevNote = null
          const x2 = xIn(bar, Math.min(e.beat + e.dur, bar.bar * 4 + 4))
          parts.push(<rect key={'r' + id} className="tc-ov-rest" x={x - 3} y={strumOnly ? STRUM_Y - 6 : lineY(3) - 2} width={Math.max(6, x2 - x - 2)} height={strumOnly ? 12 : 16} rx={2} />)
        }
      }

      const label = `Bar ${bar.bar + 1}${sym ? `, ${sym}` : ''}${chip ? `, ${chip.toLowerCase()}` : ''}, watch from here`
      return (
        <g
          key={bar.bar}
          className="tc-ov-bar"
          data-bar={bar.bar}
          role="button"
          tabIndex={0}
          aria-label={label}
          transform={`translate(0 ${y0})`}
          onClick={() => onBar(bar.bar)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault()
              onBar(bar.bar)
            }
          }}
        >
          <rect className="tc-ov-hit" x={bar.x} y={0} width={bar.w} height={OV_ROW_H - 2} rx={6} />
          <text className="tc-ov-num" x={bar.x + 4} y={11}>
            {bar.bar + 1}
          </text>
          {showSym && (
            <text className="tc-ov-sym" x={bar.x + 18} y={12}>
              {sym}
            </text>
          )}
          {chip && <Chip x={bar.x + bar.w - 4} y={1} text={chip} kind={role === 'answer' || role === 'echo' ? 'you' : 'listen'} />}
          {parts}
        </g>
      )
    })
  }, [lesson, chart, f, l, onBar])
}

type ChartEventsByBar = Map<number, number[]>

export function LessonOverview({
  lesson,
  chart,
  fingering,
  beatNow,
  countIn,
  parkBar,
  onBar,
}: {
  lesson: Lesson
  chart: Chart
  fingering: ChartFingering
  /** The playhead in full-chart beats while watching; null when not. */
  beatNow: () => number | null
  countIn: () => number | null
  parkBar: number | null
  onBar: (bar: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const width = useWidth(scrollRef)
  const layout = useMemo(() => overviewLayout(lesson.bars, width), [lesson.bars, width])
  const still = useStill()
  const content = useStatic(lesson, chart, fingering, layout, onBar)
  const headRef = useRef<SVGGElement>(null)
  const tintRef = useRef<SVGRectElement>(null)
  const countRef = useRef<SVGGElement>(null)
  const countText = useRef<SVGTextElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const memo = useRef({ row: -1, bar: -1, count: '' })

  const shapes = useMemo(() => {
    if (lesson.type !== 'chords' && lesson.type !== 'rhythm') return []
    const m = new Map<string, ChordEv>()
    for (const e of chart.events) if (e.kind === 'chord' && !m.has(e.symbol)) m.set(e.symbol, e)
    return [...m.values()]
  }, [lesson.type, chart])

  const notes = chart.events.filter((e) => e.kind === 'note' || e.kind === 'chord' || e.kind === 'mute').length
  const summary = `${lesson.bars} bars, ${notes} ${lesson.type === 'chords' || lesson.type === 'rhythm' ? 'strums' : 'notes'}${
    fingering.startPos !== null ? `, starts with your hand at fret ${fingering.startPos}` : ', starts on open strings'
  }`

  // Playhead, tint and count chip off, and the current bar unmarked.
  const hideMarks = useCallback(() => {
    headRef.current?.setAttribute('opacity', '0')
    tintRef.current?.setAttribute('opacity', '0')
    countRef.current?.setAttribute('opacity', '0')
    svgRef.current?.querySelector('.tc-ov-bar.now')?.classList.remove('now')
    memo.current.row = -1
    memo.current.bar = -1
  }, [])

  // The frame loop stops before it can see the end, so hide here too.
  useEffect(() => {
    if (parkBar === null) hideMarks()
  }, [parkBar, hideMarks])

  useFrame(
    () => {
      const m = memo.current
      const b = beatNow()
      const tint = tintRef.current
      const cg = countRef.current
      const head = headRef.current
      if (b === null || !layout.bars.length) {
        hideMarks()
        return
      }
      const c = countIn()
      const pb = c !== null && parkBar !== null ? parkBar * 4 : b
      const pt = beatToPoint(layout, pb)
      head?.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.row * OV_ROW_H})`)
      head?.setAttribute('opacity', '1')
      const bar = layout.bars[Math.max(0, Math.min(layout.bars.length - 1, Math.floor(pb / 4)))]
      if (bar.bar !== m.bar) {
        // the bar's own class tints the knockouts behind its fret numbers too
        const svg = svgRef.current
        svg?.querySelector('.tc-ov-bar.now')?.classList.remove('now')
        svg?.querySelector(`.tc-ov-bar[data-bar="${bar.bar}"]`)?.classList.add('now')
        m.bar = bar.bar
      }
      if (tint) {
        tint.setAttribute('x', String(bar.x))
        tint.setAttribute('y', String(bar.row * OV_ROW_H))
        tint.setAttribute('width', String(bar.w))
        tint.setAttribute('opacity', '1')
      }
      if (cg) {
        cg.setAttribute('opacity', c !== null ? '1' : '0')
        cg.setAttribute('transform', `translate(${bar.x + bar.w - 30} ${bar.row * OV_ROW_H + 16})`)
        const txt = c !== null ? String(c) : ''
        if (txt !== m.count && countText.current) {
          countText.current.textContent = txt
          m.count = txt
        }
      }
      // keep the current row in view, inside the box only
      if (pt.row !== m.row) {
        m.row = pt.row
        const box = scrollRef.current
        if (box) {
          const top = pt.row * OV_ROW_H
          const bottom = top + OV_ROW_H
          if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
            box.scrollTo({ top: Math.max(0, top - 4), behavior: still ? 'auto' : 'smooth' })
          }
        }
      }
    },
    parkBar !== null,
  )

  return (
    <div className="tc-ov">
      {shapes.length > 0 && (
        <div className="tc-ov-shapes" aria-label="Chord shapes in this lesson">
          {shapes.map((e) => {
            const cf = fingering.events[e.id]
            return (
              <div key={e.symbol} className="tc-ov-shape">
                <ChordDiagram shape={{ frets: e.frets }} name={e.symbol} size={0.8} fingers={cf?.kind === 'chord' ? cf.fingering.fingers : undefined} />
              </div>
            )
          })}
        </div>
      )}
      <div ref={scrollRef} className="tc-ov-scroll">
        {width > 0 && (
          <svg ref={svgRef} className="tc-ov-svg" width={width} height={layout.height} viewBox={`0 0 ${width} ${layout.height}`} role="group" aria-label={summary}>
            <rect ref={tintRef} className="tc-ov-tint" x={0} y={0} width={0} height={OV_ROW_H - 2} rx={6} opacity={0} />
            {content}
            <g ref={headRef} className="tc-ov-head" opacity={0} pointerEvents="none">
              <line x1={0} x2={0} y1={lineY(5) - 4} y2={lineY(0) + 4} />
              <circle cx={0} cy={lineY(5) - 6} r={4} />
            </g>
            <g ref={countRef} className="tc-ov-count-chip" opacity={0} pointerEvents="none">
              <rect width={26} height={18} rx={9} />
              <text ref={countText} x={13} y={13} textAnchor="middle" />
            </g>
          </svg>
        )}
      </div>
    </div>
  )
}
