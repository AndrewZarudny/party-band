// Lessons' latency calibration: per-device offsets, and the 8-click sync session.
import { engine } from '../audio/engine'
import { AudioClock, LessonClock, lessonClick } from './clock'
import { LessonInput } from './input'
import { onMicInput } from './source'
import type { InputOnset, LatencyCal, Stars, SyncOutcome } from './types'

export const KEYBOARD_DEVICE = 'keyboard'

const STORE_KEY = 'lessons-latency'
const SYNC_BPM = 80
const SYNC_COUNT_IN = 4
const SYNC_CLICKS = 8
const MATCH_EARLY = 0.15 // seconds an onset may come before its click
const MATCH_LATE = 0.45
const DEFAULT_PITCH_LAG = 35

interface Store {
  v: 1
  byDevice: Record<string, LatencyCal>
}

function loadStore(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Store | null
    if (s && s.v === 1 && s.byDevice && typeof s.byDevice === 'object') return s
  } catch {
    /* storage unavailable or corrupt */
  }
  return { v: 1, byDevice: {} }
}

/** Identifies the current guitar input + output pair. */
export function deviceKey(): string {
  let output = ''
  try {
    output = (JSON.parse(localStorage.getItem('audio-devices') ?? '{}') as { output?: string }).output ?? ''
  } catch {
    /* storage unavailable */
  }
  // A mic has its own delay and attack, even on the same interface as the cable.
  return `${engine.info.label}|${output}${onMicInput() ? '|mic' : ''}`
}

export function loadLatency(device: string): LatencyCal | null {
  const c = loadStore().byDevice[device]
  if (!c || !Number.isFinite(c.offsetMs)) return null
  // older or hand-edited entries may lack the pitch lag
  return Number.isFinite(c.pitchLagMs) ? c : { ...c, pitchLagMs: 35 }
}

export function saveLatency(cal: LatencyCal) {
  const s = loadStore()
  s.byDevice[cal.device] = cal
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

export const LATENCY_WARN_MS = 20 // Jack et al. 2018: above about 20 ms playing feels sluggish

export interface LatencyAdvice {
  outMs: number // output latency (engine.latencyMs)
  roundMs: number | null // Tap In's measured round trip, null when not synced
  warn: boolean
}

/** Whether to warn about delay: the output alone, or half the measured round trip (heuristic one-way estimate), over 20 ms. */
export function latencyAdvice(outMs: number, cal: LatencyCal | null): LatencyAdvice {
  const roundMs = cal ? cal.offsetMs : null
  const warn = outMs > LATENCY_WARN_MS || (roundMs !== null && roundMs / 2 > LATENCY_WARN_MS)
  return { outMs: Math.round(outMs), roundMs, warn }
}

/** Guitar, uncalibrated: output latency plus a typical input path. */
export function defaultOffsetMs(): number {
  return engine.latencyMs + 50
}

export function defaultKeyOffsetMs(): number {
  return engine.latencyMs
}

export function micWarning(): string | null {
  const mic = engine.channel === 'left' || engine.channel === 'mix' || (engine.channel === 'auto' && engine.autoPick === 'left')
  return mic ? "Your input may be a mic: use headphones so the click doesn't count as your playing." : null
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Each click's first onset in [−150, +450] ms; error in ms, null when nothing matched. */
function matchClicks(clickTimes: number[], onsets: InputOnset[]): { errs: (number | null)[]; lags: number[] } {
  const used = new Set<InputOnset>()
  const lags: number[] = []
  const errs = clickTimes.map((tk) => {
    const on = onsets.find((o) => !used.has(o) && o.raw - tk >= -MATCH_EARLY && o.raw - tk <= MATCH_LATE)
    if (!on) return null
    used.add(on)
    if (on.lagMs !== undefined) lags.push(on.lagMs)
    return (on.raw - tk) * 1000
  })
  return { errs, lags }
}

export function evaluateSync(clickTimes: number[], onsets: InputOnset[]): SyncOutcome {
  const sorted = [...onsets].sort((a, b) => a.raw - b.raw)
  const { errs, lags } = matchClicks(clickTimes, sorted)
  const got = errs.filter((e): e is number => e !== null)
  const captured = got.length
  const med = median(got)
  const madMs = Math.round(median(got.map((e) => Math.abs(e - med))))
  const ok = captured >= 6 && madMs < 35
  const offsetMs = Math.round(clamp(med, 0, 400))
  const pitchLagMs = lags.length ? Math.round(clamp(median(lags), 0, 120)) : DEFAULT_PITCH_LAG
  const stars: Stars = ok && captured === clickTimes.length && madMs <= 15 ? 3 : ok ? 2 : captured >= 4 ? 1 : 0
  const message = ok
    ? `Synced: your setup's delay is ${offsetMs} ms.`
    : captured >= 4
      ? 'Close. You can sync again later from Settings.'
      : "I didn't hear enough plucks. Let's try again."
  return { ok, captured, offsetMs, pitchLagMs, madMs, stars, message }
}

export interface SyncState {
  phase: 'countin' | 'listening' | 'done'
  clickIdx: number
  errs: (number | null)[]
  outcome: SyncOutcome | null
}

/** 4 count-in clicks, then 8 clicks to pluck along with; reports live, then the outcome. */
export class SyncSession {
  readonly device: string
  private onUpdate: (s: SyncState) => void
  private keyboard: boolean
  private clock: LessonClock | null = null
  private input: LessonInput | null = null
  private timer = 0
  private stopped = false
  private onsets: InputOnset[] = []
  private clickTimes: number[] = []
  private state: SyncState = { phase: 'countin', clickIdx: 0, errs: Array<number | null>(SYNC_CLICKS).fill(null), outcome: null }

  constructor(onUpdate: (s: SyncState) => void, keyboard: boolean) {
    this.onUpdate = onUpdate
    this.keyboard = keyboard
    this.device = keyboard ? KEYBOARD_DEVICE : deviceKey()
  }

  async start() {
    this.stop()
    this.stopped = false
    const ctx = await engine.ensureContext()
    if (this.stopped) return
    const audio = new AudioClock(ctx)
    const clock = new LessonClock()
    const input = new LessonInput({
      clock: audio,
      offsetMs: 0,
      pitchLagMs: DEFAULT_PITCH_LAG,
      onsetRatio: 1.6,
      refractoryMs: 90,
      keyboard: this.keyboard,
      useEngine: !this.keyboard && engine.running,
    })
    this.clock = clock
    this.input = input
    this.onsets = []
    this.state = { phase: 'countin', clickIdx: 0, errs: Array<number | null>(SYNC_CLICKS).fill(null), outcome: null }
    input.onOnset((o) => {
      this.onsets.push(o)
      this.refresh()
    })
    clock.run(ctx, {
      bpm: SYNC_BPM,
      countInBeats: SYNC_COUNT_IN,
      totalBeats: SYNC_CLICKS,
      swing: false,
      click: false,
      onTick: (k) => {
        if (k.n >= 0 && k.n % 2 === 0) lessonClick(k.t, k.n === 0, 0.5)
      },
    })
    this.clickTimes = Array.from({ length: SYNC_CLICKS }, (_, i) => clock.timeOfBeat(i))
    input.start()
    this.emit()
    // Late onsets for the last click can still arrive up to MATCH_LATE plus the attack/pitch merge time.
    const endT = this.clickTimes[SYNC_CLICKS - 1] + MATCH_LATE + 0.15
    this.timer = window.setInterval(() => {
      const now = ctx.currentTime
      if (now >= endT) {
        this.finish()
        return
      }
      const phase = now < clock.start - 0.15 ? 'countin' : 'listening'
      const idx = Math.max(0, Math.min(SYNC_CLICKS - 1, Math.round(clock.beatAt(now))))
      if (phase !== this.state.phase || idx !== this.state.clickIdx) {
        this.state = { ...this.state, phase, clickIdx: idx }
        this.emit()
      }
    }, 50)
  }

  /** Stops clock and input; idempotent. */
  stop() {
    this.stopped = true
    window.clearInterval(this.timer)
    this.timer = 0
    this.clock?.stop()
    this.input?.stop()
    this.clock = null
    this.input = null
  }

  private refresh() {
    const { errs } = matchClicks(this.clickTimes, [...this.onsets].sort((a, b) => a.raw - b.raw))
    this.state = { ...this.state, errs: errs.map((e) => (e === null ? null : Math.round(e))) }
    this.emit()
  }

  private finish() {
    const outcome = evaluateSync(this.clickTimes, this.onsets)
    this.stop()
    this.state = { ...this.state, phase: 'done', clickIdx: SYNC_CLICKS - 1, outcome }
    this.emit()
  }

  private emit() {
    this.onUpdate(this.state)
  }
}
