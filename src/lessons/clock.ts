// Lessons' time base and lookahead scheduler (count-in, clicks, swing).
import { engine } from '../audio/engine'

const LOOKAHEAD = 0.12 // seconds scheduled ahead, as in JamMode
const TIMER_MS = 25
const MAX_SMOOTH = 0.03 // never extrapolate ctx.currentTime by more than this
const SWING = 0.33 // odd 8ths are pushed by this share of an 8th when swinging

/** ctx.currentTime only moves in audio-block steps; this smooths it with performance.now(). */
export class AudioClock {
  ctx: AudioContext
  private baseCtx = -1
  private basePerf = 0
  private last = 0

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  /** ctx.currentTime smoothed with performance.now() (adds ≤ 30 ms), never runs backwards. */
  now(): number {
    const ct = this.ctx.currentTime
    const p = performance.now()
    if (ct !== this.baseCtx) {
      this.baseCtx = ct
      this.basePerf = p
    }
    const t = ct + Math.min(MAX_SMOOTH, Math.max(0, (p - this.basePerf) / 1000))
    this.last = Math.max(this.last, t)
    return this.last
  }

  /** Audio time of a DOM event (e.g. KeyboardEvent.timeStamp). */
  fromPerf(perfMs: number): number {
    return this.now() - (performance.now() - perfMs) / 1000
  }
}

/** n = 8th index (negative = count-in), beat = n / 2 (straight), step = 8th within the bar; t is swung. */
export interface Tick {
  n: number
  t: number
  beat: number
  step: number
}

export interface ClockOpts {
  bpm: number
  countInBeats: number
  totalBeats: number // nothing is scheduled at or after beat totalBeats (+ 1 beat of ring-out for the band)
  swing: boolean
  click: boolean
  onTick?: (k: Tick) => void
}

export class LessonClock {
  start = 0 // audio time of beat 0
  bpm = 120
  private ctx: AudioContext | null = null
  private timer = 0
  private active = false
  private totalBeats = 0
  private endN = 0

  /** True from run() until stop(), or until the last beat has passed. */
  get running(): boolean {
    if (!this.active || !this.ctx) return false
    return this.ctx.currentTime < this.timeOfBeat(this.totalBeats + 1)
  }

  run(ctx: AudioContext, o: ClockOpts, lead = 0.15) {
    this.stop()
    this.ctx = ctx
    this.bpm = o.bpm
    this.totalBeats = o.totalBeats
    this.endN = o.totalBeats * 2
    const spb = 60 / o.bpm
    const e = spb / 2 // seconds per 8th
    this.start = ctx.currentTime + lead + o.countInBeats * spb
    this.active = true
    let next = -o.countInBeats * 2
    const tick = () => {
      for (;;) {
        const n = next
        if (n >= this.endN) {
          window.clearInterval(this.timer)
          this.timer = 0
          return
        }
        const t = this.start + n * e + (o.swing && n % 2 !== 0 ? e * SWING : 0)
        if (t >= ctx.currentTime + LOOKAHEAD) return
        const beat = n / 2
        const step = ((n % 8) + 8) % 8
        if (n % 2 === 0) {
          // Count-in clicks always play; in-chart clicks follow the lesson and the user's metronome level.
          if (n < 0) lessonClick(t, beat === -o.countInBeats, 0.5)
          else if (o.click) engine.click(t, step === 0, 0.35)
        }
        o.onTick?.({ n, t, beat, step })
        next++
      }
    }
    this.timer = window.setInterval(tick, TIMER_MS)
    tick()
  }

  /** Stops scheduling at `beat` (a loop ends early on a pass boundary). */
  limit(beat: number) {
    this.endN = Math.min(this.endN, Math.round(beat * 2))
    this.totalBeats = Math.min(this.totalBeats, beat)
  }

  /** Clears the interval; idempotent. */
  stop() {
    if (this.timer) window.clearInterval(this.timer)
    this.timer = 0
    this.active = false
  }

  beatAt(t: number): number {
    return ((t - this.start) * this.bpm) / 60
  }

  /** Straight (unswung) time of beat `b`. */
  timeOfBeat(b: number): number {
    return this.start + (b * 60) / this.bpm
  }
}

/** A click that stays audible for count-ins and sync: volume × max(level, 0.5) / level. Silent only at level 0. */
export function lessonClick(t: number, accent: boolean, vol: number) {
  const level = engine.metronomeLevel
  if (level <= 0) return
  engine.click(t, accent, (vol * Math.max(level, 0.5)) / level)
}

export function clicksMuted(): boolean {
  return engine.metronomeLevel === 0
}
