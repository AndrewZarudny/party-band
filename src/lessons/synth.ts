// Lessons' lead voice: plays call phrases and "Listen first" demos. Goes to the speakers only, never into the input.
import { midiToFreq } from '../music/theory'

const PEAK = 0.25
const ATTACK = 0.005
const MIN_DECAY = 0.15
const MAX_DECAY = 1.5
const DETUNE_CENTS = 7

interface Voice {
  oscs: OscillatorNode[]
  g: GainNode
}

export class LeadVoice {
  private ctx: AudioContext
  private voices = new Set<Voice>()

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  /** Plucked tone: triangle + detuned saw, lowpass 2.2 kHz, 5 ms attack, exp decay over max(0.15, dur) (max 1.5 s), gain 0.25 → ctx.destination. */
  note(t: number, midi: number, dur: number, vel = 1) {
    const ctx = this.ctx
    const at = Math.max(t, ctx.currentTime)
    const decay = Math.min(MAX_DECAY, Math.max(MIN_DECAY, dur))
    const f = midiToFreq(midi)
    const tri = ctx.createOscillator()
    tri.type = 'triangle'
    tri.frequency.value = f
    const saw = ctx.createOscillator()
    saw.type = 'sawtooth'
    saw.frequency.value = f
    saw.detune.value = DETUNE_CENTS
    const sawGain = ctx.createGain()
    sawGain.gain.value = 0.35
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    const g = ctx.createGain()
    const peak = PEAK * Math.max(0, Math.min(1, vel))
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(peak, at + ATTACK)
    g.gain.exponentialRampToValueAtTime(0.0001, at + ATTACK + decay)
    tri.connect(lp)
    saw.connect(sawGain).connect(lp)
    lp.connect(g).connect(ctx.destination)
    const end = at + ATTACK + decay + 0.02
    const v: Voice = { oscs: [tri, saw], g }
    for (const o of v.oscs) {
      o.start(at)
      o.stop(end)
    }
    tri.onended = () => {
      g.disconnect()
      this.voices.delete(v)
    }
    this.voices.add(v)
  }

  stopAll() {
    const now = this.ctx.currentTime
    this.voices.forEach((v) => {
      v.g.gain.cancelScheduledValues(now)
      v.g.gain.setTargetAtTime(0, now, 0.005)
      for (const o of v.oscs) {
        try {
          o.stop(now + 0.05)
        } catch {
          /* already stopped */
        }
      }
    })
    this.voices.clear()
  }
}
