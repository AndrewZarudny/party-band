// A guitar played into the real Lessons input path, for strum timing tests. Not a test file itself.
// Synthesises the dry signal (plucked strings, a ringing previous chord, small contact noises), runs the
// engine's own attack detector on it frame by frame, and feeds LessonInput and the Judge like a live run.
import { engine } from '../../audio/engine'
import type { AudioClock } from '../clock'
import { LessonInput } from '../input'
import { Judge, windowsFor } from '../judge'
import type { Chart, ChordEv, InputOnset, JudgeSummary, Timing } from '../types'
import { STANDARD_TUNING } from '../../music/theory'
import { mulberry32 } from '../charts'

export const SR = 48000
const FRAME_SEC = 1 / 60 // the engine reads its analyser once per animation frame
const BUF = 2048 // engine.timeBuf

// LessonInput.stop() cancels its animation frame; Node has none.
const g = globalThis as { cancelAnimationFrame?: (id: number) => void }
g.cancelAnimationFrame ??= () => {}

export interface Pluck {
  t: number // seconds
  midi: number
  amp: number
  string: number // a new pluck on a string stops what that string was playing
}
export interface Click {
  t: number
  amp: number // a short broadband tick: a fingertip or the pick touching ringing strings
}

/** One strum: the chord's sounding strings, `gapMs` apart, low to high for D/P and high to low for U. */
export function strum(e: ChordEv, t0: number, gapMs: number, amp = 0.1): Pluck[] {
  const strings = e.frets.flatMap((f, s) => (f >= 0 ? [s] : []))
  if (e.dir === 'U') strings.reverse()
  return strings.map((s, i) => ({ t: t0 + (i * gapMs) / 1000, midi: STANDARD_TUNING[s] + e.frets[s], amp, string: s }))
}

/**
 * The dry guitar signal: decaying harmonic strings with a short pick noise at each attack, plus clicks.
 * Harmonic h has amplitude 1/h^rolloff: 1 gives the spiky waveform that re-triggers the detector most.
 */
export function render(plucks: Pluck[], clicks: Click[], seconds: number, seed = 1, rolloff = 1): Float32Array {
  const x = new Float32Array(Math.ceil(seconds * SR))
  const rnd = mulberry32(seed)
  for (let i = 0; i < x.length; i++) x[i] = (rnd() * 2 - 1) * 1e-4 // interface hiss
  const byString = new Map<number, Pluck[]>()
  for (const p of [...plucks].sort((a, b) => a.t - b.t)) byString.set(p.string, [...(byString.get(p.string) ?? []), p])
  for (const ps of byString.values()) {
    ps.forEach((p, k) => {
      const from = Math.round(p.t * SR)
      const to = Math.min(x.length, k + 1 < ps.length ? Math.round(ps[k + 1].t * SR) : from + 3 * SR)
      const f = 440 * 2 ** ((p.midi - 69) / 12)
      for (let i = from; i < to; i++) {
        const t = (i - from) / SR
        let v = 0
        for (let h = 1; h <= 5; h++) v += (Math.sin(2 * Math.PI * f * h * t) / h ** rolloff) * Math.exp((-t * h) / 1.2)
        x[i] += p.amp * v
        if (t < 0.004) x[i] += p.amp * 0.4 * (rnd() * 2 - 1) * (1 - t / 0.004) // the pick scraping the string
      }
    })
  }
  for (const c of clicks) {
    const from = Math.round(c.t * SR)
    for (let i = from; i < Math.min(x.length, from + 0.003 * SR); i++) x[i] += c.amp * (rnd() * 2 - 1) * (1 - (i - from) / (0.003 * SR))
  }
  return x
}

export interface SimOpts {
  chart: Chart
  bpm: number
  timing?: Timing
  plucks: Pluck[]
  clicks?: Click[]
  start: number // audio time of beat 0
  strums?: boolean // false: the input without its strum handling (as before the fix)
  rolloff?: number
  onTick?: (judge: Judge, now: number) => void // after each frame's judge.tick
}

/** Plays the signal through engine.detectOnset → LessonInput → Judge; returns the judge's summary. */
export function simulate(o: SimOpts): JudgeSummary {
  const spb = 60 / o.bpm
  const seconds = o.start + o.chart.totalBeats * spb + 1
  const x = render(o.plucks, o.clicks ?? [], seconds, 1, o.rolloff)
  let now = 0
  const clock = { now: () => now, fromPerf: () => now } as unknown as AudioClock
  const eng = engine as unknown as { ctx: { currentTime: number } | null; timeBuf: Float32Array; onsetLastT: number; detectOnset(sr: number): void }
  const savedCtx = eng.ctx
  eng.ctx = { currentTime: 0 }
  eng.onsetLastT = 0
  const minGapSec = o.chart.minGapBeats * spb
  const isChords = o.chart.events.some((e) => e.kind === 'chord' || e.kind === 'mute')
  const input = new LessonInput({
    clock,
    offsetMs: 0,
    pitchLagMs: 35,
    onsetRatio: isChords ? 1.4 : 1.6, // as run.ts
    refractoryMs: Number.isFinite(minGapSec) ? Math.max(40, Math.min(90, 0.45 * minGapSec * 1000)) : 90,
    strums: isChords && o.strums !== false,
    keyboard: false,
    useEngine: true,
  })
  const judge = new Judge(o.chart, {
    start: o.start,
    secPerBeat: spb,
    windows: windowsFor(o.timing ?? 'easy', false, true),
    octaveOk: false,
    restGate: () => input.peakMedian(),
    listenBars: [],
    swing: false,
  })
  input.onOnset((on) => judge.onset(on))
  input.onFrame((f) => judge.frame(f))
  input.start()
  try {
    for (let n = 1; n * FRAME_SEC < seconds; n++) {
      now = n * FRAME_SEC
      eng.ctx.currentTime = now
      const end = Math.round(now * SR)
      if (end < BUF) continue
      eng.timeBuf.set(x.subarray(end - BUF, end))
      let sum = 0
      for (let i = 0; i < BUF; i++) sum += eng.timeBuf[i] * eng.timeBuf[i]
      engine.level.emit(Math.sqrt(sum / BUF))
      eng.detectOnset(SR)
      engine.pitch.emit(null) // a strummed chord has no single pitch; the chord check is chroma's job
      judge.tick(now)
      o.onTick?.(judge, now)
    }
    return judge.finish()
  } finally {
    input.stop()
    eng.ctx = savedCtx
  }
}

/** Every onset the input emits for this signal (for looking at what the detector heard). */
export function onsetsOf(plucks: Pluck[], clicks: Click[], seconds: number, onsetRatio = 1.4, refractoryMs = 90, strums = false): InputOnset[] {
  const x = render(plucks, clicks, seconds)
  let now = 0
  const clock = { now: () => now, fromPerf: () => now } as unknown as AudioClock
  const eng = engine as unknown as { ctx: { currentTime: number } | null; timeBuf: Float32Array; onsetLastT: number; detectOnset(sr: number): void }
  const savedCtx = eng.ctx
  eng.ctx = { currentTime: 0 }
  eng.onsetLastT = 0
  const input = new LessonInput({ clock, offsetMs: 0, pitchLagMs: 35, onsetRatio, refractoryMs, strums, keyboard: false, useEngine: true })
  const out: InputOnset[] = []
  input.onOnset((on) => out.push(on))
  input.start()
  try {
    for (let n = 1; n * FRAME_SEC < seconds + 0.2; n++) {
      now = n * FRAME_SEC
      eng.ctx.currentTime = now
      const end = Math.min(x.length, Math.round(now * SR))
      if (end < BUF) continue
      eng.timeBuf.set(x.subarray(end - BUF, end))
      let sum = 0
      for (let i = 0; i < BUF; i++) sum += eng.timeBuf[i] * eng.timeBuf[i]
      engine.level.emit(Math.sqrt(sum / BUF))
      eng.detectOnset(SR)
      engine.pitch.emit(null)
    }
    engine.level.emit(0) // flush the last pending attack
    return out
  } finally {
    input.stop()
    eng.ctx = savedCtx
  }
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
