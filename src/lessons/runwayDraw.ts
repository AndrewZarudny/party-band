// The tab runway: string lanes (high e on top), notes as fret-number pills scrolling right to left into the pick line.
// Pure canvas drawing. The caller scales the context for devicePixelRatio and passes sizes in CSS pixels.

import type { Chart, ChartEvent, ChordEv, JudgeResult, LiveHud, NoteEv } from './types'
import { STANDARD_TUNING, noteName } from '../music/theory'
import type { PillXf, RunwayFx } from './fx/runwayFx'

export interface RunwayColors {
  bg: string
  line: string
  text: string
  muted: string
  accent: string
  target: string
  root: string
  next: string
  played: string
  panel2: string
  scale: string
  chord: string
  /** lettering on the coloured improv dots */
  ink: string
  /** the -text tokens: small words on the runway background (darker than the fills in light mode) */
  rootText: string
  targetText: string
  playedText: string
  font?: string
}

/** What drawRunway needs; LessonRun satisfies it structurally. */
export interface RunwayView {
  chart: Chart
  bpm: number
  hud: LiveHud
  played: { beat: number; midi: number; kind: 'chord' | 'scale' | 'out' }[]
  result(id: number): JudgeResult | undefined
  pendingEvent(): ChartEvent | null
}

// Calm dark, in case the tokens can't be read
const FALLBACK: RunwayColors = {
  bg: '#1e1c19',
  line: '#423c35',
  text: '#d9d0c1',
  muted: '#a1978a',
  accent: '#d0a85c',
  target: '#a6c77f',
  root: '#dc7464',
  next: '#5fbca5',
  played: '#c88ec8',
  panel2: '#2e2a26',
  scale: '#86a8e8',
  chord: '#d0a85c',
  ink: '#1b1916',
  rootText: '#dc7464',
  targetText: '#a6c77f',
  playedText: '#c88ec8',
}

export function readColors(el: Element): RunwayColors {
  const cs = getComputedStyle(el)
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb
  return {
    bg: v('--bg', FALLBACK.bg),
    line: v('--line', FALLBACK.line),
    text: v('--text', FALLBACK.text),
    muted: v('--muted', FALLBACK.muted),
    accent: v('--accent', FALLBACK.accent),
    target: v('--target', FALLBACK.target),
    root: v('--root', FALLBACK.root),
    next: v('--next', FALLBACK.next),
    played: v('--played', FALLBACK.played),
    panel2: v('--panel-2', FALLBACK.panel2),
    scale: v('--scale', FALLBACK.scale),
    chord: v('--chord', FALLBACK.chord),
    ink: v('--ink', FALLBACK.ink),
    rootText: v('--root-text', FALLBACK.rootText),
    targetText: v('--target-text', FALLBACK.targetText),
    playedText: v('--played-text', FALLBACK.playedText),
    font: v('--font-ui', 'system-ui, sans-serif'),
  }
}

// Set at the start of each frame: the app's UI font, and whether decoration should hold still.
let FONT = 'system-ui, sans-serif'
let still = false
// Set per judged pill by enterPill(): its alpha multiplier and whether it is cracked (a miss)
let fade = 1
let cracked = false
let moved = false
const XF: PillXf = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, crack: false }
/** True when the viewer asked for reduced motion: hit rings and the count-in pop hold still. */
export function prefersStill(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Calls fn with the new value when the reduced-motion setting changes. Returns the unsubscribe. */
export function onStillChange(fn: (still: boolean) => void): () => void {
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = (e: MediaQueryListEvent) => fn(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  } catch {
    return () => {}
  }
}

const LANE_NAMES =['E', 'A', 'D', 'G', 'B', 'e'] // by string, 0 = low E
const GUTTER = 28 // string names and the nut
const TOP = 26 // chord names and technique marks
const RING_SEC = 0.32 // the ring that grows out of a hit pill
const PILL_R = 9

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const easeOutBack = (k: number) => {
  const m = k - 1
  return 1 + 2.70158 * m * m * m + 1.70158 * m * m
}

/** Applies a judged pill's motion around (x, y). False when it has faded out and can be skipped. */
function enterPill(g: CanvasRenderingContext2D, fx: RunwayFx | undefined, id: number, x: number, y: number, ghost: number): boolean {
  if (!fx || !fx.pill(id, ghost, XF)) return true
  if (XF.alpha <= 0.01) return false
  g.save()
  g.translate(x + XF.dx, y + XF.dy)
  if (XF.rot) g.rotate(XF.rot)
  g.scale(XF.sx, XF.sy)
  g.translate(-x, -y)
  fade = XF.alpha
  cracked = XF.crack
  moved = true
  return true
}

function leavePill(g: CanvasRenderingContext2D) {
  if (moved) g.restore()
  fade = 1
  cracked = false
  moved = false
}

/** A hairline crack through a missed pill, in the background colour. */
function crack(g: CanvasRenderingContext2D, x: number, y: number, hh: number, c: RunwayColors) {
  g.strokeStyle = c.bg
  g.lineWidth = 1.6
  g.beginPath()
  g.moveTo(x - 2, y - hh)
  g.lineTo(x + 2.5, y - hh * 0.25)
  g.lineTo(x - 2, y + hh * 0.3)
  g.lineTo(x + 2, y + hh)
  g.stroke()
}

/** A short glow on a lane around the pick line after a hit, fading toward its ends. */
function laneGlow(g: CanvasRenderingContext2D, fx: RunwayFx, s: number, y: number, pickX: number) {
  const glow = fx.glow(s)
  if (glow < 0.02) return
  g.fillStyle = fx.laneColor(s)
  g.globalAlpha = glow * 0.12
  g.fillRect(Math.max(GUTTER, pickX - 60), y - 3, 120, 7)
  g.globalAlpha = glow * 0.18
  g.fillRect(Math.max(GUTTER, pickX - 30), y - 3, 60, 7)
  g.globalAlpha = 1
}

/** One string lane. Plucked, it rings as two standing waves between the nut and the far edge. */
function drawLane(g: CanvasRenderingContext2D, fx: RunwayFx | undefined, s: number, y: number, w: number, pickX: number, roar: number, c: RunwayColors) {
  if (fx) laneGlow(g, fx, s, y, pickX)
  const a1 = fx ? fx.mode1(s) : 0
  const a3 = fx ? fx.mode3(s) : 0
  if (Math.abs(a1) + Math.abs(a3) < 0.15) {
    g.fillStyle = c.line
    g.fillRect(GUTTER, y, w - GUTTER, 1)
    if (roar > 0.01) {
      g.globalAlpha = roar * 0.6
      g.fillStyle = c.accent
      g.fillRect(GUTTER, y, w - GUTTER, 1)
      g.globalAlpha = 1
    }
    return
  }
  const span = w - GUTTER
  g.beginPath()
  g.moveTo(GUTTER, y + 0.5)
  for (let x = GUTTER + 8; x < w + 8; x += 8) {
    const u = (Math.min(x, w) - GUTTER) / span
    g.lineTo(Math.min(x, w), y + 0.5 + a1 * Math.sin(Math.PI * u) + a3 * Math.sin(3 * Math.PI * u))
  }
  g.lineWidth = 1
  g.strokeStyle = c.line
  g.stroke()
  g.globalAlpha = Math.min(1, fx ? fx.glow(s) * 1.4 : 0)
  g.strokeStyle = fx ? fx.laneColor(s) : c.line
  g.lineWidth = 1.4
  g.stroke()
  if (roar > 0.01) {
    g.globalAlpha = roar * 0.6
    g.strokeStyle = c.accent
    g.lineWidth = 1
    g.stroke()
  }
  g.globalAlpha = 1
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + k, y)
  g.arcTo(x + w, y, x + w, y + h, k)
  g.arcTo(x + w, y + h, x, y + h, k)
  g.arcTo(x, y + h, x, y, k)
  g.arcTo(x, y, x + w, y, k)
  g.closePath()
}

/** A guitar pick, point down, its tip at (x, y). */
function pick(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const top = y - 1.1 * s
  g.beginPath()
  g.moveTo(x - s, top)
  g.quadraticCurveTo(x, top - 0.5 * s, x + s, top)
  g.quadraticCurveTo(x, top + 2.2 * s, x - s, top)
  g.closePath()
}

function isHit(r: JudgeResult) {
  return r.grade !== 'miss' && r.verdict !== 'wrong' && r.verdict !== 'ringing'
}

/** Echo-rhythm calls repeat one note: draw them as dots. Cached per chart. */
const dotCalls = new WeakMap<Chart, boolean>()
function callsAsDots(chart: Chart) {
  let v = dotCalls.get(chart)
  if (v === undefined) {
    v = chart.calls.length > 0 && chart.calls.every((c) => c.midi === chart.calls[0].midi)
    dotCalls.set(chart, v)
  }
  return v
}

function laneForMidi(midi: number) {
  for (let s = 5; s >= 0; s--) if (midi >= STANDARD_TUNING[s]) return s
  return 0
}

/**
 * Draws one frame. `beat` is the visual beat (negative during the count-in); `zoom` scales the spacing.
 * `countIn = false` hides the big count-in number (the intro's still preview).
 * `fx` adds the live effects (hit bursts, string shake, beat pulse, Roar); the caller ticks it first.
 */
export function drawRunway(g: CanvasRenderingContext2D, w: number, h: number, view: RunwayView, beat: number, c: RunwayColors, zoom: number, reduced = false, countIn = true, fx?: RunwayFx): void {
  FONT = c.font || 'system-ui, sans-serif'
  still = reduced
  const { chart } = view
  const spb = 60 / view.bpm
  const ppb = clamp(((210 * 60) / view.bpm) * zoom, 90, 260)
  const pickX = Math.round(w * 0.2)
  const X = (b: number) => pickX + (b - beat) * ppb
  const bFrom = beat - (pickX - GUTTER) / ppb - 0.25
  const bTo = beat + (w - pickX) / ppb + 0.25

  const gap = Math.max(12, (h - TOP - 6) / 7)
  const laneY = (s: number) => Math.round(TOP + (5 - s) * gap + gap / 2)
  const rhythmY = Math.round(TOP + 6 * gap + gap / 2)
  const pillH = Math.min(20, gap - 3)
  const lanesTop = laneY(5) - pillH / 2 - 2
  const lanesBot = rhythmY + pillH / 2 + 2

  g.clearRect(0, 0, w, h)
  g.fillStyle = c.bg
  g.fillRect(0, 0, w, h)
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  if (fx) {
    fx.begin(beat, GUTTER, pickX, ppb, TOP, gap, w, c)
    fx.drawBack(g, w, h)
  }
  const pulse = fx ? fx.pulse : 0
  const roar = fx ? fx.roarLevel : 0

  // Listen bars: shaded, labelled
  for (const bar of chart.listenBars) {
    const x0 = X(bar * 4)
    const x1 = X(bar * 4 + 4)
    if (x1 < GUTTER || x0 > w) continue
    g.fillStyle = c.panel2
    g.fillRect(x0, lanesTop, x1 - x0, lanesBot - lanesTop)
    g.fillStyle = c.muted
    g.font = `600 11px ${FONT}`
    g.textAlign = 'left'
    g.fillText('Listen', Math.max(x0 + 8, GUTTER + 8), TOP - 9)
    g.textAlign = 'center'
  }

  // Hit zone around the pick line
  g.fillStyle = c.accent
  g.globalAlpha = 0.07 + 0.05 * pulse + 0.04 * roar
  g.fillRect(pickX - 14, lanesTop, 28, lanesBot - lanesTop)
  g.globalAlpha = 1

  // Bar lines and beat ticks; bar lines catch the beat's pulse
  const total = chart.totalBeats
  for (let b = Math.max(0, Math.ceil(bFrom)); b <= Math.min(total, Math.floor(bTo)); b++) {
    const x = Math.round(X(b))
    if (b % 4 === 0) {
      g.fillStyle = c.line
      g.fillRect(x - 1, lanesTop, 2, lanesBot - lanesTop)
      if (b === total) g.fillRect(x + 3, lanesTop, 4, lanesBot - lanesTop) // closing double bar
      if (pulse > 0.02) {
        g.globalAlpha = 0.3 * pulse
        g.fillStyle = c.accent
        g.fillRect(x - 1, lanesTop, 2, lanesBot - lanesTop)
        g.globalAlpha = 1
      }
    } else {
      g.fillStyle = c.line
      g.globalAlpha = 0.55
      g.fillRect(x, lanesTop, 1, 5)
      g.fillRect(x, lanesBot - 5, 1, 5)
      g.globalAlpha = 1
    }
  }

  // Chord name per bar
  g.font = `600 12px ${FONT}`
  g.textAlign = 'left'
  for (const cb of chart.chordTimeline) {
    if (!cb.symbol || cb.beat + 4 < bFrom || cb.beat > bTo) continue
    g.fillStyle = c.muted
    g.fillText(cb.symbol, Math.max(X(cb.beat) + 7, GUTTER + 6), TOP - 9)
  }
  g.textAlign = 'center'

  // Lanes: a hit string shakes and glows for a moment; in Roar they all warm up
  for (let s = 0; s < 6; s++) drawLane(g, fx, s, laneY(s), w, pickX, roar, c)
  if (fx) laneGlow(g, fx, 6, rhythmY, pickX)
  g.fillStyle = c.line
  g.globalAlpha = 0.5
  for (let x = GUTTER + 2; x < w; x += 6) g.fillRect(x, rhythmY, 2, 1)
  g.globalAlpha = 1
  // a milestone's light runs along the strings under the notes
  if (fx) fx.drawMid(g)

  // Calls (played by the app): faint
  if (chart.calls.length) {
    const dots = callsAsDots(chart)
    g.globalAlpha = 0.35
    for (const cn of chart.calls) {
      if (cn.beat + cn.dur < bFrom || cn.beat > bTo) continue
      const x = X(cn.beat)
      const y = laneY(cn.string)
      if (dots) {
        g.fillStyle = c.text
        g.beginPath()
        g.arc(x, y, 4, 0, Math.PI * 2)
        g.fill()
      } else {
        drawPill(g, x, y, pillH, String(cn.fret), c.panel2, c.muted, c.text, cn.fret >= 10)
      }
    }
    g.globalAlpha = 1
  }

  // Events
  const pend = view.pendingEvent()
  const pendId = pend ? pend.id : -1
  let lastChordSym = ''
  let lastChordBeat = -99
  for (const ev of chart.events) {
    if (ev.beat > bTo) break
    if (ev.kind === 'chord') {
      // the chord name shows when it changes (or after a gap), so 8th-note strums stay readable
      const showName = ev.symbol !== lastChordSym || ev.beat - lastChordBeat > 2
      lastChordSym = ev.symbol
      lastChordBeat = ev.beat
      if (ev.beat + ev.dur < bFrom) continue
      const cx = X(ev.beat)
      if (enterPill(g, fx, ev.id, cx, (laneY(5) + laneY(0)) / 2, 0.3)) {
        drawChord(g, ev, cx, laneY, rhythmY, pillH, view.result(ev.id), ev.id === pendId, showName, beat, spb, c)
        leavePill(g)
      }
      continue
    }
    if (ev.beat + ev.dur < bFrom) continue
    const r = view.result(ev.id)
    const x = X(ev.beat)
    if (ev.kind === 'note') {
      const xEnd = X(ev.beat + ev.dur)
      const y = laneY(ev.string)
      // a note with a sustain tail stays visible while it rings; a short one thins to a ghost
      if (enterPill(g, fx, ev.id, x, y, xEnd - x > 24 ? 0.7 : 0.25)) {
        drawNote(g, ev, x, xEnd, y, pillH, r, ev.id === pendId, beat, spb, c)
        leavePill(g)
      }
    } else if (ev.kind === 'mute') {
      if (enterPill(g, fx, ev.id, x, rhythmY, 0.3)) {
        drawMute(g, x, rhythmY, r, ev.id === pendId, c)
        leavePill(g)
      }
    } else drawRest(g, x, X(ev.beat + ev.dur), rhythmY, pillH, r, c)
  }

  // Improv: what you played, as dots on the nearest string lane
  if (view.played.length) {
    g.font = `700 9px ${FONT}`
    for (const p of view.played) {
      if (p.beat < bFrom || p.beat > bTo) continue
      const x = X(p.beat)
      const y = laneY(laneForMidi(p.midi))
      g.fillStyle = p.kind === 'chord' ? c.chord : p.kind === 'scale' ? c.scale : c.root
      g.beginPath()
      g.arc(x, y, 7.5, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = c.ink
      g.fillText(noteName(p.midi), x, y + 0.5)
    }
  }

  // Bursts and the end sweep, under the pick line and the gutter
  if (fx) fx.drawFront(g)

  // Pick line, topped with a pick; it breathes a little on each beat
  g.fillStyle = c.accent
  if (pulse > 0.02) {
    g.globalAlpha = 0.2 * pulse
    g.fillRect(pickX - 5, lanesTop, 10, lanesBot - lanesTop)
    g.globalAlpha = 1
  }
  g.fillRect(pickX - 1, lanesTop, 2, lanesBot - lanesTop)
  pick(g, pickX, lanesTop + 1, 6 + 1.2 * pulse)
  g.fill()

  // Gutter: string names behind a nut
  g.fillStyle = c.bg
  g.fillRect(0, 0, GUTTER, h)
  g.fillStyle = c.line
  g.fillRect(GUTTER - 3, lanesTop, 3, laneY(0) - lanesTop + 3)
  g.font = `600 12px ${FONT}`
  g.fillStyle = c.muted
  for (let s = 0; s < 6; s++) g.fillText(LANE_NAMES[s], GUTTER / 2 - 1, laneY(s) + 0.5)

  // Count-in: 4 3 2 1
  if (beat < 0 && countIn) {
    const n = Math.ceil(-beat - 1e-6)
    if (n >= 1 && n <= 8) {
      const into = 1 - (-beat - (n - 1)) // 0 at the start of the beat → 1 at its end
      const size = Math.min(h * 0.5, 104)
      // each number punches in large and springs back to size
      const k = still ? 1 : 1.4 - 0.4 * easeOutBack(Math.min(1, into / 0.24))
      g.save()
      g.translate(w * 0.58, (lanesTop + lanesBot) / 2)
      g.scale(k, k)
      g.globalAlpha = still ? 1 : 0.35 + 0.65 * (1 - into)
      g.fillStyle = n === 1 ? c.accent : c.text
      g.font = `800 ${Math.round(size)}px ${FONT}`
      g.fillText(String(n), 0, 2)
      g.restore()
    }
  }
}

function drawPill(g: CanvasRenderingContext2D, x: number, y: number, ph: number, label: string, fill: string, border: string, text: string, wide: boolean) {
  const pw = wide ? 30 : 24
  rr(g, x - pw / 2, y - ph / 2, pw, ph, PILL_R)
  g.fillStyle = fill
  g.fill()
  g.lineWidth = 1.5
  g.strokeStyle = border
  g.stroke()
  g.fillStyle = text
  g.font = `700 ${Math.round(ph * 0.62)}px ${FONT}`
  g.fillText(label, x, y + 0.5)
  return pw
}

function ring(g: CanvasRenderingContext2D, x: number, y: number, base: number, ev: { beat: number }, r: JudgeResult, beat: number, spb: number, color: string) {
  if (r.errMs === null) return
  const age = (beat - ev.beat) * spb - r.errMs / 1000
  if (age < 0 || age > RING_SEC) return
  const k = age / RING_SEC
  g.globalAlpha = (1 - k) * fade
  g.strokeStyle = color
  g.lineWidth = 2
  g.beginPath()
  g.arc(x, y, base + k * 16, 0, Math.PI * 2)
  g.stroke()
  g.globalAlpha = fade
}

function drawNote(
  g: CanvasRenderingContext2D,
  ev: NoteEv,
  x: number,
  xEnd: number,
  y: number,
  ph: number,
  r: JudgeResult | undefined,
  pending: boolean,
  beat: number,
  spb: number,
  c: RunwayColors,
) {
  const wide = ev.fret >= 10
  const pw = wide ? 30 : 24
  const hit = !!r && isHit(r)
  const missed = !!r && r.verdict === 'miss'
  const wrong = !!r && r.verdict === 'wrong'

  g.globalAlpha = (missed ? 0.4 : 1) * fade

  // sustain tail
  if (xEnd - x > pw / 2 + 6) {
    g.fillStyle = hit ? c.target : c.muted
    g.globalAlpha = (missed ? 0.2 : hit ? 0.55 : 0.4) * fade
    rr(g, x, y - 2, xEnd - x - 3, 4, 2)
    g.fill()
    g.globalAlpha = (missed ? 0.4 : 1) * fade
    if (ev.tech === 'vibrato') wave(g, x + pw / 2 + 3, Math.max(xEnd - 3, x + pw / 2 + 28), y - ph / 2 - 5, c.muted)
  } else if (ev.tech === 'vibrato') wave(g, x + pw / 2 + 3, x + pw / 2 + 28, y - ph / 2 - 5, c.muted)

  const fill = hit ? c.target : c.panel2
  const border = wrong ? c.played : pending ? c.accent : missed ? c.line : c.muted
  rr(g, x - pw / 2, y - ph / 2, pw, ph, PILL_R)
  g.fillStyle = c.panel2
  g.fill()
  if (hit) {
    g.globalAlpha = 0.35 * fade
    g.fillStyle = fill
    g.fill()
    g.globalAlpha = fade
  }
  g.lineWidth = pending ? 2 : 1.5
  g.strokeStyle = border
  g.stroke()
  g.fillStyle = missed ? c.muted : c.text
  g.font = `700 ${Math.round(ph * 0.62)}px ${FONT}`
  g.fillText(ev.hidden ? '?' : String(ev.fret), x, y + 0.5)
  if (cracked) crack(g, x, y, ph / 2, c)

  // technique marks above the pill
  const top = y - ph / 2 - 6
  g.font = `italic 600 11px ${FONT}`
  g.fillStyle = c.muted
  g.strokeStyle = c.muted
  g.lineWidth = 1.3
  if (ev.tech === 'hammer' || ev.tech === 'pull') g.fillText(ev.tech === 'hammer' ? 'h' : 'p', x - pw / 2 - 4, top)
  else if (ev.tech === 'slide') {
    g.beginPath()
    g.moveTo(x - pw / 2 - 12, y + 4)
    g.lineTo(x - pw / 2 - 3, y - 4)
    g.stroke()
    g.fillText('sl', x - pw / 2 - 8, top)
  } else if (ev.tech === 'pm') {
    g.font = `700 10px ${FONT}`
    g.fillText('PM', x, top)
  } else if (ev.tech === 'bend' && ev.bendTo !== undefined) {
    const st = ev.bendTo - ev.midi
    const bx = x + pw / 2
    g.beginPath()
    g.moveTo(bx - 1, y - 2)
    g.quadraticCurveTo(bx + 8, y - 3, bx + 8, top - 2)
    g.stroke()
    g.beginPath()
    g.moveTo(bx + 4.5, top + 2)
    g.lineTo(bx + 8, top - 3)
    g.lineTo(bx + 11.5, top + 2)
    g.stroke()
    g.font = `700 10px ${FONT}`
    g.fillText(st === 1 ? '½' : st === 2 ? 'full' : String(st / 2), bx + 8, top - 9)
  }

  if (wrong && r && r.played != null) {
    g.font = `700 10px ${FONT}`
    g.fillStyle = c.playedText
    g.fillText(noteName(r.played), x, y + ph / 2 + 8)
  }
  if (missed) {
    g.globalAlpha = fade
    g.fillStyle = c.root
    g.fillRect(x - 4, y + ph / 2 + 3, 8, 2)
  }
  if (hit && r && !still) ring(g, x, y, ph / 2, ev, r, beat, spb, c.target)
  g.globalAlpha = 1
}

function wave(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, color: string) {
  g.strokeStyle = color
  g.lineWidth = 1.3
  g.beginPath()
  for (let x = x0; x <= x1; x += 2) {
    const yy = y + Math.sin(((x - x0) / 8) * Math.PI * 2) * 2.2
    if (x === x0) g.moveTo(x, yy)
    else g.lineTo(x, yy)
  }
  g.stroke()
}

function drawChord(
  g: CanvasRenderingContext2D,
  ev: ChordEv,
  x: number,
  laneY: (s: number) => number,
  rhythmY: number,
  ph: number,
  r: JudgeResult | undefined,
  pending: boolean,
  showName: boolean,
  beat: number,
  spb: number,
  c: RunwayColors,
) {
  const bw = 20
  const top = laneY(5) - ph / 2 + 1
  const bot = laneY(0) + ph / 2 - 1
  const hit = !!r && isHit(r)
  const missed = !!r && r.verdict === 'miss'
  g.globalAlpha = (missed ? 0.4 : 1) * fade

  rr(g, x - bw / 2, top, bw, bot - top, 8)
  g.fillStyle = c.panel2
  g.fill()
  if (hit) {
    g.globalAlpha = 0.35 * fade
    g.fillStyle = c.target
    g.fill()
    g.globalAlpha = fade
  }
  g.lineWidth = pending ? 2 : 1.5
  g.strokeStyle = r && r.chordOk === false ? c.played : pending ? c.accent : missed ? c.line : c.muted
  g.stroke()

  g.font = `700 ${Math.round(ph * 0.55)}px ${FONT}`
  for (let s = 0; s < 6; s++) {
    const f = ev.frets[s]
    const muted = f === undefined || f < 0
    g.fillStyle = muted ? c.muted : missed ? c.muted : c.text
    g.fillText(muted ? 'x' : String(f), x, laneY(s) + 0.5)
  }

  if (showName) {
    g.font = `700 12px ${FONT}`
    g.fillStyle = c.text
    g.fillText(ev.symbol, x, top - 8)
  }

  // strum direction on the rhythm lane (shown, never judged)
  if (ev.dir) {
    g.strokeStyle = c.muted
    g.fillStyle = c.muted
    g.lineWidth = 1.5
    const down = ev.dir !== 'U'
    const y0 = rhythmY - 6
    const y1 = rhythmY + 6
    g.beginPath()
    g.moveTo(x, down ? y0 : y1)
    g.lineTo(x, down ? y1 : y0)
    g.stroke()
    g.beginPath()
    if (down) {
      g.moveTo(x - 3.5, y1 - 4)
      g.lineTo(x, y1 + 0.5)
      g.lineTo(x + 3.5, y1 - 4)
    } else {
      g.moveTo(x - 3.5, y0 + 4)
      g.lineTo(x, y0 - 0.5)
      g.lineTo(x + 3.5, y0 + 4)
    }
    g.stroke()
    if (ev.dir === 'P') {
      g.font = `700 9px ${FONT}`
      g.fillText('PM', x + 12, rhythmY)
    }
  }
  if (cracked) crack(g, x, (top + bot) / 2, (bot - top) / 2, c)
  if (missed) {
    g.globalAlpha = fade
    g.fillStyle = c.root
    g.fillRect(x - 4, bot + 3, 8, 2)
  }
  if (hit && r && !still) ring(g, x, (top + bot) / 2, bw / 2, ev, r, beat, spb, c.target)
  g.globalAlpha = 1
}

function drawMute(g: CanvasRenderingContext2D, x: number, y: number, r: JudgeResult | undefined, pending: boolean, c: RunwayColors) {
  const hit = !!r && isHit(r)
  const missed = !!r && r.verdict === 'miss'
  g.strokeStyle = hit ? c.target : missed ? c.root : pending ? c.accent : c.text
  g.globalAlpha = (missed ? 0.5 : 1) * fade
  g.lineWidth = 2
  g.lineCap = 'round'
  const k = 4.5
  g.beginPath()
  g.moveTo(x - k, y - k)
  g.lineTo(x + k, y + k)
  g.moveTo(x + k, y - k)
  g.lineTo(x - k, y + k)
  g.stroke()
  g.lineCap = 'butt'
  g.globalAlpha = 1
}

function drawRest(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, ph: number, r: JudgeResult | undefined, c: RunwayColors) {
  const bh = Math.round(ph * 0.7)
  const top = y - bh / 2
  const wdt = Math.max(6, x1 - x0 - 4)
  const color = r ? (r.verdict === 'ringing' ? c.root : c.target) : c.muted
  g.save()
  rr(g, x0, top, wdt, bh, 4)
  g.clip()
  g.strokeStyle = color
  g.globalAlpha = r ? 0.7 : 0.45
  g.lineWidth = 1
  g.beginPath()
  for (let x = x0 - bh; x < x0 + wdt; x += 6) {
    g.moveTo(x, top + bh)
    g.lineTo(x + bh, top)
  }
  g.stroke()
  g.restore()
  rr(g, x0, top, wdt, bh, 4)
  g.strokeStyle = color
  g.globalAlpha = r ? 0.9 : 0.5
  g.lineWidth = 1
  g.stroke()
  g.globalAlpha = 1
  if (wdt > 36) {
    g.font = `600 10px ${FONT}`
    g.fillStyle = c.bg
    const tw = 26
    g.fillRect(x0 + 5, y - 6, tw, 12)
    g.fillStyle = r ? (r.verdict === 'ringing' ? c.rootText : c.targetText) : c.muted
    g.textAlign = 'left'
    g.fillText('rest', x0 + 7, y + 0.5)
    g.textAlign = 'center'
  }
}
