// The backing band for jams and lessons: drums, bass and electric piano, played from the same
// 8th-note patterns the band cards show (FEELS), scheduled on the jam's audio clock. It plays
// recorded instruments (src/audio/sampler) with a real drummer's feel, and falls back to the
// synthesized voices below per part while the samples load, if they fail, or when 'synth' is chosen.
import type { Feel, KeysVoicing } from '../music/parts'
import { FEELS, bassNotes } from '../music/parts'
import type { Chord } from '../music/theory'
import { midiToFreq } from '../music/theory'
import type { Bank, SampleStatus } from './sampler/bank'
import { bankFor, sampleStatus } from './sampler/bank'
import { grooveFor, humanise } from './sampler/groove'
import type { Voice } from './sampler/player'
import { VoicePool, fadeOut } from './sampler/player'
import { roomImpulse } from './sampler/reverb'
import type { BandSound } from './sampler/sound'
import { bandSound } from './sampler/sound'

export type BackingPart = 'drums' | 'bass' | 'keys'
export type { BandSound }

/** Part levels balanced by measurement (similar loudness for drums, bass and keys). */
const LEVELS: Record<BackingPart, number> = { drums: 1.6, bass: 0.35, keys: 1.4 }
/**
 * Recorded parts relative to the synth ones, so switching sound keeps the balance (matched by
 * rendering 4 bars of every feel offline and comparing RMS per part).
 */
const REAL_TRIM: Record<BackingPart, number> = { drums: 1.1, bass: 6.3, keys: 0.8 }
/** How much of each recorded part goes to the room reverb. */
const SENDS: Record<BackingPart, number> = { drums: 0.12, bass: 0.02, keys: 0.22 }
const VOICES: Record<BackingPart, number> = { drums: 32, bass: 4, keys: 24 }
/** Fade-outs baked into the ends of the bass and keys files (scripts/samples/build_band.py). */
const FILE_FADE = { bass: 0.35, keys: 0.6 }
const REGGAE = FEELS.reggae
const BALLAD = FEELS.ballad

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** 0..1 → MIDI velocity, with `fallback` when the groove has no hit there. */
const toVel = (v: number, fallback: number, accent: number) => Math.round(clamp((v > 0.05 ? v : fallback) * accent, 0.03, 1) * 127)

export class BackingBand {
  private readonly ctx: BaseAudioContext
  private readonly out: GainNode
  private readonly gate: GainNode // closed by stop(), opened again by the next step
  private gated = false
  private readonly parts: Record<BackingPart, GainNode>
  private readonly synthIn: Record<BackingPart, GainNode>
  private readonly realIn: Record<BackingPart, GainNode>
  private readonly sends: Record<BackingPart, GainNode>
  private readonly noise: AudioBuffer
  private readonly pools: Record<BackingPart, VoicePool>
  private sound: BandSound | null = null
  private lastBass: Voice | null = null

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 0.7
    // A gentle bus compressor glues the parts together; a fast limiter after it stops clipping.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -4
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.08
    const trim = ctx.createGain()
    trim.gain.value = 0.55
    this.gate = ctx.createGain()
    this.out.connect(this.gate).connect(comp).connect(trim).connect(limiter).connect(destination)
    // Recorded parts share a small room; the synth voices stay dry as before.
    const verb = ctx.createConvolver()
    verb.buffer = roomImpulse(ctx)
    const verbOut = ctx.createGain()
    verbOut.gain.value = 0.6
    verb.connect(verbOut).connect(this.out)
    const gain = (v: number, to: AudioNode) => {
      const g = ctx.createGain()
      g.gain.value = v
      g.connect(to)
      return g
    }
    this.parts = { drums: gain(LEVELS.drums, this.out), bass: gain(LEVELS.bass, this.out), keys: gain(LEVELS.keys, this.out) }
    const p = this.parts
    this.synthIn = { drums: gain(1, p.drums), bass: gain(1, p.bass), keys: gain(1, p.keys) }
    this.realIn = { drums: gain(REAL_TRIM.drums, p.drums), bass: gain(REAL_TRIM.bass, p.bass), keys: gain(REAL_TRIM.keys, p.keys) }
    this.sends = { drums: gain(SENDS.drums, verb), bass: gain(SENDS.bass, verb), keys: gain(SENDS.keys, verb) }
    for (const k of ['drums', 'bass', 'keys'] as const) this.realIn[k].connect(this.sends[k])
    this.pools = { drums: new VoicePool(ctx, VOICES.drums), bass: new VoicePool(ctx, VOICES.bass), keys: new VoicePool(ctx, VOICES.keys) }
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    this.bank()
  }

  setVolume(v: number) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  setPartOn(p: BackingPart, on: boolean) {
    this.parts[p].gain.setTargetAtTime(on ? LEVELS[p] : 0, this.ctx.currentTime, 0.05)
    this.sends[p].gain.setTargetAtTime(on ? SENDS[p] : 0, this.ctx.currentTime, 0.05)
  }

  /**
   * 'real' (recorded instruments) or 'synth' for this band; null follows the app-wide choice
   * (setBandSound in sampler/sound). Takes effect from the next step; ringing notes ring out.
   */
  setSound(s: BandSound | null) {
    this.sound = s
    this.bank()
  }

  /** The sound this band is set to play. */
  soundNow(): BandSound {
    return this.sound ?? bandSound()
  }

  /** Which parts play recorded samples right now (the rest use the synth while loading or after an error). */
  realParts(): Record<BackingPart, boolean> {
    const b = this.bank()
    return { drums: !!b?.drums, bass: !!b?.bass, keys: !!b?.keys }
  }

  /**
   * Silences the band within `fade` seconds: every sampled voice (also ones scheduled but not
   * started yet), the synth voices and the room. The next playStep opens it again.
   */
  stop(fade = 0.03) {
    const now = this.ctx.currentTime
    for (const p of ['drums', 'bass', 'keys'] as const) this.pools[p].stopAll(now, fade)
    this.lastBass = null
    const g = this.gate.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.setTargetAtTime(0, now, fade / 3)
    this.gated = true
  }

  /** The shared samples when this band plays recorded ones (looked up each time, so a reload is picked up). */
  private bank(): Bank | null {
    return this.soundNow() === 'real' ? bankFor(this.ctx) : null
  }

  /** Sample loading progress (shared by all bands). */
  sampleStatus(): SampleStatus {
    return sampleStatus()
  }

  /** Starts loading the samples for this context ahead of time, so the first bar is already real. */
  static preload(ctx: BaseAudioContext) {
    if (bandSound() === 'real') bankFor(ctx)
  }

  /**
   * Plays one 8th-note step of the groove at `t`. `step` is 0–7 within a 4/4 bar, `eighth` the
   * step length in seconds; `next` lets held notes ring up to the following hit.
   */
  playStep(t: number, step: number, eighth: number, chord: Chord, feel: Feel, keys: KeysVoicing, parts: Record<BackingPart, boolean>) {
    if (this.gated) {
      // reopen just before this step (after stop(), e.g. a seek)
      const now = this.ctx.currentTime
      this.gate.gain.cancelScheduledValues(now)
      this.gate.gain.setTargetAtTime(1, Math.max(now, t - 0.01), 0.002)
      this.gated = false
    }
    const b = this.bank()
    const groove = grooveFor(feel)
    // One humanised time per step: bass and keys lock to the drummer's timing.
    const at = b ? this.at(humanise(groove, step, t), t) : t
    if (parts.drums) {
      const kick = feel.drums.kick[step] === 'x'
      const snare = feel.drums.snare[step] === 'x'
      const hat = feel.drums.hat[step] === 'x'
      const kit = b?.drums
      if (kit) {
        const pool = this.pools.drums
        const dest = this.realIn.drums
        if (kick && kit.kick) pool.hit(kit.kick, toVel(groove.kick[step], 0.85, 1), at, 1, dest)
        // Reggae's one drop is played as a rim shot when the kit has one.
        const sn = feel === REGGAE && kit.rimshot ? kit.rimshot : kit.snare
        if (snare && sn) pool.hit(sn, toVel(groove.snare[step], 0.8, 1), at, 1, dest)
        if (hat && kit.hatClosed) pool.hit(kit.hatClosed, toVel(groove.hat[step], 0.6, step % 2 === 0 ? 1 : 0.85), at, 0.8, dest)
        // A shuffle drummer also ticks the swung "a" softly, as in the recorded grooves; it makes the swing audible.
        else if (feel.swing && step % 2 === 1 && kit.hatClosed) pool.hit(kit.hatClosed, toVel(groove.hat[step], 0.5, 0.75), at, 0.8, dest)
      } else {
        if (kick) this.kick(t)
        if (snare) this.snare(t)
        if (hat) this.hat(t, step % 2 === 0 ? 0.32 : 0.2)
      }
    }
    if (parts.bass) {
      const c = feel.bass[step]
      if (c !== '_' && c !== '-') {
        const n = bassNotes(feel.bass, chord)[step]
        const dur = this.held(feel.bass, step) * eighth
        if (n !== null && b?.bass) {
          // One note at a time, on the drummer's timing (`at`).
          // Middle layer of the bass: the hardest one adds a slap the synth bass never had.
          const vel = toVel(0.66 + (step % 2 === 0 ? 0.06 : 0) + (Math.random() - 0.5) * 0.06, 0.7, 1)
          fadeOut(this.lastBass, at)
          this.lastBass = this.pools.bass.note(b.bass, n, vel, at, 1, this.realIn.bass, at + Math.max(0.08, dur * 0.92), 0.06, FILE_FADE.bass)
        } else if (n !== null) this.bass(t, n, dur)
      }
    }
    if (parts.keys && feel.keys[step] === 'X') {
      const dur = this.held(feel.keys, step) * eighth
      if (b?.keys) {
        const notes = keys.right.length + 1
        const level = 0.6 / Math.sqrt(notes)
        // Short stabs are comped lighter (soft layer): a ringing Wurlitzer stab is louder than the synth one.
        const vel = toVel(this.held(feel.keys, step) === 1 ? 0.5 : feel === BALLAD ? 0.62 : 0.66, 0.6, 1)
        // A chord held past the end of the files (ballad at slow speeds) keeps sounding: see VoicePool.play.
        const end = at + Math.max(0.15, dur * 0.95)
        const pool = this.pools.keys
        pool.note(b.keys, keys.left + 12, vel, at, level, this.realIn.keys, end, 0.3, FILE_FADE.keys)
        for (let i = 0; i < keys.right.length; i++) pool.note(b.keys, keys.right[i], vel, at, level, this.realIn.keys, end, 0.3, FILE_FADE.keys)
      } else this.ep(t, keys, dur)
    }
  }

  /** A humanised time, never earlier than now (a late tick plays at once, as before). */
  private at(h: number, t: number) {
    return h < this.ctx.currentTime ? Math.max(t, this.ctx.currentTime) : h
  }

  /** How many steps a hit lasts: itself plus following '-' holds (wrapping within the bar). */
  private held(pattern: string, step: number) {
    let n = 1
    while (n < 8 && pattern[(step + n) % 8] === '-') n++
    return n
  }

  // ---- synthesized voices (fallback and 'synth' sound) ----

  private env(t: number, peak: number, decay: number) {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    return g
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator()
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    const g = this.env(t, 1, 0.38)
    o.connect(g).connect(this.synthIn.drums)
    o.start(t)
    o.stop(t + 0.4)
  }

  private snare(t: number) {
    const n = this.ctx.createBufferSource()
    n.buffer = this.noise
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1400
    const g = this.env(t, 0.55, 0.18)
    n.connect(hp).connect(g).connect(this.synthIn.drums)
    n.start(t)
    n.stop(t + 0.2)
    const o = this.ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(190, t)
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08)
    const og = this.env(t, 0.35, 0.1)
    o.connect(og).connect(this.synthIn.drums)
    o.start(t)
    o.stop(t + 0.12)
  }

  private hat(t: number, level: number) {
    const n = this.ctx.createBufferSource()
    n.buffer = this.noise
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7500
    const g = this.env(t, level, 0.05)
    n.connect(hp).connect(g).connect(this.synthIn.drums)
    n.start(t, Math.random() * 0.5)
    n.stop(t + 0.06)
  }

  private bass(t: number, midi: number, dur: number) {
    const f = midiToFreq(midi)
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 2
    lp.frequency.setValueAtTime(1100, t)
    lp.frequency.exponentialRampToValueAtTime(320, t + 0.15)
    const g = this.ctx.createGain()
    const end = t + Math.max(0.08, dur * 0.92)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.12)
    g.gain.setValueAtTime(0.45, end - 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, end)
    for (const [type, detune] of [
      ['sawtooth', 0],
      ['triangle', -6],
    ] as const) {
      const o = this.ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      o.detune.value = detune
      o.connect(lp)
      o.start(t)
      o.stop(end + 0.02)
    }
    lp.connect(g).connect(this.synthIn.bass)
  }

  /** Electric piano: a sine carrier with a decaying FM "tine" for the attack. */
  private ep(t: number, v: KeysVoicing, dur: number) {
    const notes = [v.left + 12, ...v.right]
    const end = t + Math.max(0.15, dur * 0.95)
    for (const m of notes) {
      const f = midiToFreq(m)
      const car = this.ctx.createOscillator()
      car.frequency.value = f
      const mod = this.ctx.createOscillator()
      mod.frequency.value = f * 2
      const modGain = this.ctx.createGain()
      modGain.gain.setValueAtTime(f * 1.2, t)
      modGain.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.4)
      mod.connect(modGain).connect(car.frequency)
      const g = this.ctx.createGain()
      const peak = 0.5 / notes.length
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peak, t + 0.006)
      g.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.6)
      g.gain.setValueAtTime(peak * 0.35, Math.max(t + 0.61, end - 0.08))
      g.gain.exponentialRampToValueAtTime(0.0001, end + 0.25)
      car.connect(g).connect(this.synthIn.keys)
      for (const o of [car, mod]) {
        o.start(t)
        o.stop(end + 0.3)
      }
    }
  }
}
