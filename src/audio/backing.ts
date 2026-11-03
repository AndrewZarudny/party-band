// A small synthesized backing band for jams: drums, bass and electric piano, played from the
// same 8th-note patterns the band cards show (FEELS), scheduled on the jam's audio clock.
import type { Feel, KeysVoicing } from '../music/parts'
import { bassNotes } from '../music/parts'
import type { Chord } from '../music/theory'
import { midiToFreq } from '../music/theory'

export type BackingPart = 'drums' | 'bass' | 'keys'

/** Part levels balanced by measurement (similar loudness for drums, bass and keys). */
const LEVELS: Record<BackingPart, number> = { drums: 1.6, bass: 0.35, keys: 1.4 }

export class BackingBand {
  private readonly ctx: BaseAudioContext
  private readonly out: GainNode
  private readonly parts: Record<BackingPart, GainNode>
  private readonly noise: AudioBuffer

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
    this.out.connect(comp).connect(trim).connect(limiter).connect(destination)
    const part = (v: number) => {
      const g = ctx.createGain()
      g.gain.value = v
      g.connect(this.out)
      return g
    }
    this.parts = { drums: part(LEVELS.drums), bass: part(LEVELS.bass), keys: part(LEVELS.keys) }
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }

  setVolume(v: number) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  setPartOn(p: BackingPart, on: boolean) {
    this.parts[p].gain.setTargetAtTime(on ? LEVELS[p] : 0, this.ctx.currentTime, 0.05)
  }

  /**
   * Plays one 8th-note step of the groove at `t`. `step` is 0–7 within a 4/4 bar, `eighth` the
   * step length in seconds; `next` lets held notes ring up to the following hit.
   */
  playStep(t: number, step: number, eighth: number, chord: Chord, feel: Feel, keys: KeysVoicing, parts: Record<BackingPart, boolean>) {
    if (parts.drums) {
      if (feel.drums.kick[step] === 'x') this.kick(t)
      if (feel.drums.snare[step] === 'x') this.snare(t)
      if (feel.drums.hat[step] === 'x') this.hat(t, step % 2 === 0 ? 0.32 : 0.2)
    }
    if (parts.bass) {
      const c = feel.bass[step]
      if (c !== '_' && c !== '-') {
        const n = bassNotes(feel.bass, chord)[step]
        if (n !== null) this.bass(t, n, this.held(feel.bass, step) * eighth)
      }
    }
    if (parts.keys && feel.keys[step] === 'X') this.ep(t, keys, this.held(feel.keys, step) * eighth)
  }

  /** How many steps a hit lasts: itself plus following '-' holds (wrapping within the bar). */
  private held(pattern: string, step: number) {
    let n = 1
    while (n < 8 && pattern[(step + n) % 8] === '-') n++
    return n
  }

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
    o.connect(g).connect(this.parts.drums)
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
    n.connect(hp).connect(g).connect(this.parts.drums)
    n.start(t)
    n.stop(t + 0.2)
    const o = this.ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(190, t)
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08)
    const og = this.env(t, 0.35, 0.1)
    o.connect(og).connect(this.parts.drums)
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
    n.connect(hp).connect(g).connect(this.parts.drums)
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
    lp.connect(g).connect(this.parts.bass)
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
      car.connect(g).connect(this.parts.keys)
      for (const o of [car, mod]) {
        o.start(t)
        o.stop(end + 0.3)
      }
    }
  }
}
