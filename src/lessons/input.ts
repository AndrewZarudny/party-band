// Lessons' live input: engine attacks merged with detected pitch, keyboard keys, or injected (autoplay) onsets.
import { engine } from '../audio/engine'
import type { OnsetFrame, PitchFrame } from '../audio/engine'
import type { AudioClock } from './clock'
import type { InputFrame, InputOnset, KeyName } from './types'

const MERGE_MS = 90 // a notes event this soon after an attack gives that attack its pitch
const PEAK_MS = 60
const GLIDE_STEP = 0.6 // semitones per frame; a hammer or pull jumps more than this
const ABS_RMS = 0.002
const RING = 32 // frames kept for the glide test and peaks
const NEAR = 0.3 // semitones: "at" a pitch for the glide test
const SYNTH_SEC = 0.25 // synthetic frames after a key or injected onset
const PEAKS_KEPT = 16

export interface InputOpts {
  clock: AudioClock
  offsetMs: number // the run's active offset (guitar cal, keyboard cal, or 0 for autoplay/sync)
  pitchLagMs: number
  onsetRatio: number // 1.6 for notes/improv/sync, 1.4 for chords/rhythm (+0.2 on a mic)
  absRms?: number // quietest level an attack can have (default ABS_RMS; higher on a mic)
  refractoryMs: number // clamp(0.45 * chart.minGapBeats * secPerBeat * 1000, 40, 90)
  keyboard: boolean // listen to keys
  useEngine: boolean // subscribe to the engine emitters (false in autoplay / keyboard-only)
}

/** Midi to emit for a key press at corrected time t, or null (no pitch). */
export type KeyHint = (t: number, key: KeyName) => number | null

/** False when the running engine instance predates the Lessons edit (HMR); the page needs a full reload. */
export function engineHasLessons(): boolean {
  return typeof engine.chroma === 'function' && !!(engine as Partial<typeof engine>).onset
}

interface RawFrame {
  t: number // uncorrected audio time
  rms: number
  midi: number | null
  midiF: number | null
}

interface Pending {
  raw: number
  ratio: number
  midi: number | null
  lagMs?: number
}

const KEYS: Record<string, KeyName> = {
  ' ': 'hit',
  j: 'hit',
  x: 'wrong',
  m: 'mute',
  '1': 's1',
  '2': 's2',
  '3': 's3',
  '4': 's4',
  '5': 's5',
  '6': 's6',
}

export class LessonInput {
  private o: InputOpts
  private off: number
  private onsetLs = new Set<(o: InputOnset) => void>()
  private frameLs = new Set<(f: InputFrame) => void>()
  private keyHint: KeyHint | null = null
  private started = false
  private unsubs: (() => void)[] = []
  private raf = 0
  // Engine path
  private frames: RawFrame[] = []
  private frameT = 0
  private open: RawFrame | null = null
  private pending: Pending | null = null
  private lastOnsetRaw = -Infinity // any source, emitted or pending
  private lastAttackRaw = -Infinity
  private lastNote: number | null = null
  // Keyboard / inject path: synthetic frames after each onset (corrected start time)
  private synth: { t: number; midi: number | null }[] = []
  private peaks: number[] = []

  constructor(o: InputOpts) {
    this.o = o
    this.off = o.offsetMs / 1000
  }

  onOnset(fn: (o: InputOnset) => void) {
    this.onsetLs.add(fn)
    return () => {
      this.onsetLs.delete(fn)
    }
  }

  onFrame(fn: (f: InputFrame) => void) {
    this.frameLs.add(fn)
    return () => {
      this.frameLs.delete(fn)
    }
  }

  setKeyHint(fn: KeyHint | null) {
    this.keyHint = fn
  }

  /** Autoplay/test: an onset at audio time t (already corrected); also synthesises frames like a key. */
  inject(o: { t: number; midi: number | null; source: 'key' | 'auto' }) {
    this.emitOnset({ t: o.t, raw: o.t + this.off, midi: o.midi, source: o.source, peak: 0.05, strength: null })
    this.addSynth(o.t, o.midi)
  }

  start() {
    if (this.started) return
    this.started = true
    const o = this.o
    if (o.useEngine) {
      const full = engineHasLessons()
      if (!full && import.meta.env.DEV) console.warn('Engine is from before the Lessons edit: reload the page.')
      this.unsubs.push(engine.level.on(this.handleLevel))
      if (full) this.unsubs.push(engine.onset.on(this.handleOnset))
      this.unsubs.push(engine.pitch.on(this.handlePitch))
      this.unsubs.push(engine.notes.on(this.handleNote))
    } else {
      this.raf = requestAnimationFrame(this.synthLoop)
    }
    if (o.keyboard) {
      window.addEventListener('keydown', this.handleKey)
      this.unsubs.push(() => window.removeEventListener('keydown', this.handleKey))
    }
  }

  /** Removes every listener, engine subscription and rAF; idempotent. */
  stop() {
    this.started = false
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.pending = null
    this.open = null
    this.synth = []
  }

  /** Median of the last 16 onset peaks (0.02 if none). */
  peakMedian(): number {
    if (!this.peaks.length) return 0.02
    const s = [...this.peaks].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }

  private emitOnset(on: InputOnset) {
    this.peaks.push(on.peak)
    if (this.peaks.length > PEAKS_KEPT) this.peaks.shift()
    this.onsetLs.forEach((l) => l(on))
  }

  private emitFrame(f: RawFrame) {
    const out: InputFrame = { t: f.t - this.off, rms: f.rms, midi: f.midi, midiF: f.midiF }
    this.frameLs.forEach((l) => l(out))
  }

  // ---- Engine path: level → onset → pitch → notes, once per engine frame ----

  private handleLevel = (rms: number) => {
    if (this.open) this.closeFrame()
    this.frameT = this.o.clock.now()
    if (this.pending && this.frameT - this.pending.raw >= MERGE_MS / 1000) this.flushPending()
    const f: RawFrame = { t: this.frameT, rms, midi: null, midiF: null }
    this.frames.push(f)
    if (this.frames.length > RING) this.frames.shift()
    this.open = f
  }

  private handleOnset = (on: OnsetFrame) => {
    const cur = this.frames[this.frames.length - 1]
    if (on.ratio < this.o.onsetRatio || !cur || cur.rms <= (this.o.absRms ?? ABS_RMS)) return
    const raw = this.frameT - on.ageSec
    if (raw - this.lastOnsetRaw < this.o.refractoryMs / 1000) return
    if (this.pending) this.flushPending()
    this.pending = { raw, ratio: on.ratio, midi: null }
    this.lastOnsetRaw = raw
    this.lastAttackRaw = raw
  }

  private handlePitch = (p: PitchFrame | null) => {
    if (!this.open) return
    if (p) {
      this.open.midi = p.midi
      this.open.midiF = p.midi + p.cents / 100
    }
    this.closeFrame()
  }

  private closeFrame() {
    const f = this.open
    this.open = null
    if (f) this.emitFrame(f)
  }

  private handleNote = (midi: number) => {
    const old = this.lastNote
    this.lastNote = midi
    if (this.pending) {
      // The attack's pitch arrived: keep the latest midi, and the lag of the first one.
      this.pending.midi = midi
      this.pending.lagMs ??= (this.frameT - this.pending.raw) * 1000
      return
    }
    const raw = this.frameT - this.o.pitchLagMs / 1000
    // A late pitch for an attack that was already sent: not a new note.
    if (raw - this.lastAttackRaw < MERGE_MS / 1000) return
    const glide = this.isGlide(old, midi)
    let peak = 0
    for (const f of this.frames) if (f.t >= raw) peak = Math.max(peak, f.rms)
    this.lastOnsetRaw = Math.max(this.lastOnsetRaw, raw)
    this.emitOnset({ t: raw - this.off, raw, midi, source: glide ? 'glide' : 'pitch', peak, strength: null })
  }

  private flushPending() {
    const p = this.pending
    if (!p) return
    this.pending = null
    let peak = 0
    for (const f of this.frames) if (f.t >= p.raw && f.t <= p.raw + PEAK_MS / 1000) peak = Math.max(peak, f.rms)
    if (!peak) peak = this.frames[this.frames.length - 1]?.rms ?? 0
    const on: InputOnset = { t: p.raw - this.off, raw: p.raw, midi: p.midi, source: 'attack', peak, strength: p.ratio }
    if (p.lagMs !== undefined) on.lagMs = p.lagMs
    this.emitOnset(on)
  }

  /** A slide, bend or wide vibrato: the pitch moved there in small steps rather than jumping. */
  private isGlide(from: number | null, to: number): boolean {
    if (from === null) return false
    const fr = this.frames
    let iOld = -1
    for (let i = fr.length - 1; i >= 0; i--) {
      const m = fr[i].midiF
      if (m !== null && Math.abs(m - from) <= NEAR) {
        iOld = i
        break
      }
    }
    if (iOld < 0) return false
    let iNew = -1
    for (let i = iOld + 1; i < fr.length; i++) {
      const m = fr[i].midiF
      if (m !== null && Math.abs(m - to) <= NEAR) {
        iNew = i
        break
      }
    }
    if (iNew < 0) return false
    let between = 0
    for (let i = iOld; i < iNew; i++) {
      const a = fr[i].midiF
      const b = fr[i + 1].midiF
      if (a === null || b === null || Math.abs(b - a) >= GLIDE_STEP) return false
      if (i > iOld && Math.abs(a - from) > NEAR && Math.abs(a - to) > NEAR) between++
    }
    return between > 0
  }

  // ---- Keyboard and synthetic frames ----

  private handleKey = (ev: KeyboardEvent) => {
    if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return
    const target = ev.target as Element | null
    if (target && typeof target.closest === 'function' && target.closest('input, select, textarea')) return
    const key = KEYS[ev.key.length === 1 ? ev.key.toLowerCase() : ev.key]
    if (!key) return
    if (ev.key === ' ') ev.preventDefault()
    const raw = this.o.clock.fromPerf(ev.timeStamp)
    const t = raw - this.off
    const midi = this.keyHint ? this.keyHint(t, key) : null
    this.emitOnset({ t, raw, midi, source: 'key', peak: 0.05, strength: null })
    this.addSynth(t, midi)
  }

  private addSynth(t: number, midi: number | null) {
    this.synth.push({ t, midi })
    this.synth.sort((a, b) => a.t - b.t)
    if (this.synth.length > 8) this.synth.shift()
  }

  private synthLoop = () => {
    this.raf = requestAnimationFrame(this.synthLoop)
    const t = this.o.clock.now() - this.off
    let cur: { t: number; midi: number | null } | null = null
    for (const s of this.synth) if (s.t <= t && t - s.t < SYNTH_SEC) cur = s
    const f: RawFrame = { t: t + this.off, rms: 0, midi: null, midiF: null }
    if (cur) {
      // 0.05 decaying to 0.01 over the 250 ms.
      f.rms = 0.05 * Math.pow(0.2, (t - cur.t) / SYNTH_SEC)
      f.midi = cur.midi
      f.midiF = cur.midi
    }
    this.emitFrame(f)
  }
}
