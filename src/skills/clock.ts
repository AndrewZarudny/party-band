// Inner-clock trainer: two bars of click, then 1–4 silent bars while the player keeps strumming on the beat.
// Each silent bar's drift is the median offset of its strums from the beat; the gap grows after a steady cycle.
import { lessonClick } from '../lessons/clock'

export const CLICK_BARS = 2
export const CYCLES = 5
const BEATS = 4
const LOOKAHEAD = 0.12
const TIMER_MS = 25
export const STEADY_MS = 60 // a silent bar this close to the beat is steady

interface Bar {
  start: number // audio time of beat 1
  click: boolean
  cycle: number
  gapIdx: number // -1 for click bars
}

export interface CycleResult {
  gap: number
  drifts: (number | null)[] // ms per silent bar, + late / - early; null = no strums heard
  ok: boolean
}

export interface ClockCallbacks {
  onCycle: (r: CycleResult, nextGap: number) => void
  onEnd: () => void
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Drift of each silent bar from its strums (times in seconds, already corrected). */
export function barDrifts(strums: number[], barStarts: number[], spb: number): (number | null)[] {
  return barStarts.map((b0) => {
    const offs: number[] = []
    for (const t of strums) {
      const beat = (t - b0) / spb
      const n = Math.round(beat)
      if (n < 0 || n >= BEATS) continue
      offs.push((beat - n) * spb * 1000)
    }
    return offs.length >= 2 ? Math.round(median(offs)) : null
  })
}

/** A cycle is steady when every silent bar was played and the last one is within STEADY_MS. */
export function cycleOk(drifts: (number | null)[]): boolean {
  const last = drifts[drifts.length - 1]
  return drifts.every((d) => d !== null) && last !== null && last !== undefined && Math.abs(last) <= STEADY_MS
}

export class ClockRun {
  private ctx: AudioContext
  private spb: number
  private gap: number
  private cb: ClockCallbacks
  private bars: Bar[] = []
  private strums: number[] = []
  private timer = 0
  private t0 = 0
  private cycle = 0
  private pos = 0 // bar within the cycle
  private evaluated = -1
  private ended = false

  constructor(ctx: AudioContext, bpm: number, gap: number, cb: ClockCallbacks) {
    this.ctx = ctx
    this.spb = 60 / bpm
    this.gap = gap
    this.cb = cb
  }

  get gapNow() {
    return this.gap
  }

  start() {
    this.t0 = this.ctx.currentTime + 0.2
    this.timer = window.setInterval(() => this.tick(), TIMER_MS)
    this.tick()
  }

  stop() {
    window.clearInterval(this.timer)
    this.timer = 0
  }

  /** A strum at audio time t (already corrected for latency). */
  strum(t: number) {
    this.strums.push(t)
  }

  /** The bar playing now, for the screen. */
  barAt(t: number): Bar | null {
    for (let i = this.bars.length - 1; i >= 0; i--) if (this.bars[i].start <= t) return this.bars[i]
    return null
  }

  private barLen() {
    return this.spb * BEATS
  }

  /** The next bar: click bars, then this cycle's silent bars (gap decided now), then the next cycle. */
  private nextBar(): Bar | null {
    if (this.cycle >= CYCLES) {
      // One last click bar to land on.
      if (this.pos > 0) return null
      this.pos = 1
      return { start: this.t0 + this.bars.length * this.barLen(), click: true, cycle: this.cycle, gapIdx: -1 }
    }
    const start = this.t0 + this.bars.length * this.barLen()
    let bar: Bar
    if (this.pos < CLICK_BARS) bar = { start, click: true, cycle: this.cycle, gapIdx: -1 }
    else bar = { start, click: false, cycle: this.cycle, gapIdx: this.pos - CLICK_BARS }
    this.pos++
    if (this.pos >= CLICK_BARS + this.gap) {
      this.cycle++
      this.pos = 0
    }
    return bar
  }

  private tick() {
    const now = this.ctx.currentTime
    for (;;) {
      const nextStart = this.t0 + this.bars.length * this.barLen()
      if (nextStart >= now + LOOKAHEAD) break
      // A cycle's silent bars are judged before the next cycle's gap is planned.
      this.evaluate(now)
      const bar = this.nextBar()
      if (!bar) break
      this.bars.push(bar)
      if (bar.click) for (let b = 0; b < BEATS; b++) lessonClick(bar.start + b * this.spb, b === 0, 0.4)
    }
    this.evaluate(now)
    const lastBar = this.bars[this.bars.length - 1]
    if (!this.ended && this.cycle >= CYCLES && this.pos > 0 && lastBar && now > lastBar.start + this.barLen()) {
      this.ended = true
      this.stop()
      this.cb.onEnd()
    }
  }

  private evaluate(now: number) {
    for (let c = this.evaluated + 1; c < CYCLES; c++) {
      const gapBars = this.bars.filter((b) => b.cycle === c && !b.click)
      if (!gapBars.length) return
      const last = gapBars[gapBars.length - 1]
      // Wait until the whole gap is planned, and half a beat after its last bar (late strums).
      if (this.cycle <= c) return
      if (now < last.start + this.barLen() + this.spb / 2) return
      const drifts = barDrifts(this.strums, gapBars.map((b) => b.start), this.spb)
      const ok = cycleOk(drifts)
      const gap = gapBars.length
      this.gap = ok ? Math.min(4, this.gap + 1) : Math.max(1, this.gap - 1)
      this.evaluated = c
      this.cb.onCycle({ gap, drifts, ok }, this.gap)
    }
  }
}
