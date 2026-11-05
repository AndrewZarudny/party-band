// Lessons' lead voice: plays call phrases, "Listen first" demos and ear-training phrases. Goes to the speakers only,
// never into the input. A plucked-string model (Karplus-Strong), so it sounds like a guitar string, not a synth.
import { midiToFreq } from '../music/theory'

const PEAK = 0.5
const MIN_RING = 0.15
const MAX_RING = 1.5
const RELEASE = 0.08 // time constant of the fade once the note's length is up (a fretting finger letting go)
const SECONDS = 2.5 // rendered length of one pluck; the release always ends it sooner

export interface Pluck {
  samples: Float32Array
  rate: number // playback rate that puts the rendered string exactly on pitch
}

/**
 * One pluck of a string: a filtered noise burst fed round a delay line one period long, each pass averaged (the
 * string losing its highs) and damped. The loop is a whole number of samples plus the averager's half sample, so the
 * pitch is a little off; `rate` corrects it exactly.
 */
export function pluck(sampleRate: number, freq: number, rand = Math.random): Pluck {
  const period = sampleRate / freq
  const n = Math.max(2, Math.floor(period - 0.5))
  const len = Math.floor(sampleRate * SECONDS)
  const out = new Float32Array(len)
  // Low strings ring longer than high ones, as on a guitar.
  const damp = 0.996 + Math.min(0.0035, 30 / (freq * 50))
  // Excitation: noise, softened once (a pick, not a hammer), mean removed so it doesn't thump.
  let prev = 0
  let mean = 0
  for (let i = 0; i < n; i++) {
    const x = rand() * 2 - 1
    out[i] = (x + prev) / 2
    prev = x
    mean += out[i]
  }
  mean /= n
  for (let i = 0; i < n; i++) out[i] -= mean
  for (let i = n; i < len; i++) out[i] = damp * 0.5 * (out[i - n] + out[i - n - 1 < 0 ? 0 : i - n - 1])
  let peak = 0
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) for (let i = 0; i < len; i++) out[i] /= peak
  return { samples: out, rate: (n + 0.5) / period }
}

const cache = new WeakMap<BaseAudioContext, Map<number, { buf: AudioBuffer; rate: number }>>()

function pluckBuffer(ctx: BaseAudioContext, midi: number) {
  let byNote = cache.get(ctx)
  if (!byNote) cache.set(ctx, (byNote = new Map()))
  let hit = byNote.get(midi)
  if (!hit) {
    const p = pluck(ctx.sampleRate, midiToFreq(midi))
    const buf = ctx.createBuffer(1, p.samples.length, ctx.sampleRate)
    buf.getChannelData(0).set(p.samples)
    hit = { buf, rate: p.rate }
    byNote.set(midi, hit)
  }
  return hit
}

interface Voice {
  src: AudioBufferSourceNode
  g: GainNode
}

export class LeadVoice {
  private ctx: AudioContext
  private voices = new Set<Voice>()

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  /** A plucked note: rings for max(0.15, dur) (max 1.5 s), then fades fast; lowpass 3.2 kHz → ctx.destination. */
  note(t: number, midi: number, dur: number, vel = 1) {
    const ctx = this.ctx
    const at = Math.max(t, ctx.currentTime)
    const ring = Math.min(MAX_RING, Math.max(MIN_RING, dur))
    const { buf, rate } = pluckBuffer(ctx, midi)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3200
    const g = ctx.createGain()
    g.gain.setValueAtTime(PEAK * Math.max(0, Math.min(1, vel)), at)
    g.gain.setTargetAtTime(0, at + ring, RELEASE)
    src.connect(lp).connect(g).connect(ctx.destination)
    src.start(at)
    src.stop(at + ring + RELEASE * 6)
    const v: Voice = { src, g }
    src.onended = () => {
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
      try {
        v.src.stop(now + 0.05)
      } catch {
        /* already stopped */
      }
    })
    this.voices.clear()
  }
}
