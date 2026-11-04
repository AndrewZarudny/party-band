// Plays decoded samples: nearest-root zone with repitching, velocity layers, round robins, a gain
// envelope with release, and a fixed number of voices per part (the oldest is faded out).
import type { RLayer, RZone } from './bank'

export interface Voice {
  srcs: AudioBufferSourceNode[] // the sample, plus sustain segments for a long held note
  gain: GainNode | null
  end: number // when it is silent
}

/** Sustain segments: crossfade length and the longest stretch of the sample one repeats. */
const XFADE = 0.12
const SEGMENT = 0.8

/** RMS of a buffer around `sec` (50 ms window), cached per buffer and position. */
const rmsCache = new WeakMap<AudioBuffer, Map<number, number>>()
function rmsAt(buf: AudioBuffer, sec: number) {
  let m = rmsCache.get(buf)
  if (!m) rmsCache.set(buf, (m = new Map()))
  const key = Math.round(sec * 1000)
  let v = m.get(key)
  if (v === undefined) {
    const d = buf.getChannelData(0)
    const a = Math.max(0, Math.floor((sec - 0.025) * buf.sampleRate))
    const b = Math.min(d.length, Math.ceil((sec + 0.025) * buf.sampleRate))
    let s = 0
    for (let i = a; i < b; i++) s += d[i] * d[i]
    v = Math.sqrt(s / Math.max(1, b - a))
    m.set(key, v)
  }
  return v
}

/** The layer for a velocity (1–127): the first whose upper bound covers it. */
export function pickLayer(layers: RLayer[], vel: number): RLayer {
  for (let i = 0; i < layers.length; i++) if (vel <= layers[i].vel) return layers[i]
  return layers[layers.length - 1]
}

/** The zone covering the note, else the one recorded nearest to it. */
export function pickZone(zones: RZone[], midi: number): RZone {
  let best = zones[0]
  let dist = Infinity
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i]
    if (midi >= z.lo && midi <= z.hi) return z
    const d = Math.abs(z.root - midi)
    if (d < dist) {
      dist = d
      best = z
    }
  }
  return best
}

/** Next round robin of a layer. */
function nextBuffer(l: RLayer): AudioBuffer {
  const b = l.bufs[l.rr % l.bufs.length]
  l.rr = (l.rr + 1) % l.bufs.length
  return b
}

/** Gentle loudness change inside a layer; the layers themselves carry most of the dynamics. */
function velGain(l: RLayer, vel: number) {
  return Math.pow(Math.min(1, vel / l.vel), 0.6)
}

/** Fades a voice out from `at` (used for voice stealing and mono bass). */
export function fadeOut(v: Voice | null, at: number, sec = 0.012) {
  if (!v || !v.srcs.length || !v.gain || v.end <= at) return
  const p = v.gain.gain
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at)
  else p.cancelScheduledValues(at)
  p.setTargetAtTime(0, at, sec / 3)
  for (const s of v.srcs) {
    try {
      s.stop(at + sec * 2)
    } catch {
      // already stopped
    }
  }
  v.end = at + sec * 2
}

export class VoicePool {
  private readonly ctx: BaseAudioContext
  private readonly voices: Voice[]
  private next = 0

  constructor(ctx: BaseAudioContext, size: number) {
    this.ctx = ctx
    this.voices = Array.from({ length: size }, () => ({ srcs: [], gain: null, end: 0 }))
  }

  /**
   * Plays `buf` at `t`. With `end` the note is held until then and released over `release`
   * seconds; without it the sample plays out (one-shots). `fade` is the fade-out baked into the
   * file's end (seconds): a note held past the sample's sustained part repeats its last stretch
   * before that fade, crossfaded and level-matched so it keeps decaying naturally.
   */
  play(buf: AudioBuffer, t: number, rate: number, level: number, dest: AudioNode, end: number | null, release: number, fade = 0): Voice {
    const v = this.claim(t)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(level, t)
    g.connect(dest)
    const srcs: AudioBufferSourceNode[] = []
    const ends: number[] = [] // when each source has faded out (Infinity: plays to the end)
    const source = (at: number, offset: number, to: AudioNode) => {
      const s = this.ctx.createBufferSource()
      s.buffer = buf
      s.playbackRate.value = rate
      s.connect(to)
      s.start(at, offset)
      srcs.push(s)
      ends.push(Infinity)
    }
    const hold = end === null ? 0 : end + release
    // the repeated stretch [a, b] of the buffer, in buffer seconds
    const b = buf.duration - fade
    const a = Math.max(0.3, b - SEGMENT)
    const x = XFADE / rate
    let stop = t + buf.duration / rate
    if (end !== null && b - a >= 2 * XFADE + 0.1 && end > t + (b - XFADE) / rate) {
      // each repeat starts where the previous one is this much quieter
      const r = Math.min(1, rmsAt(buf, b - XFADE / 2) / Math.max(1e-6, rmsAt(buf, a + XFADE / 2)))
      const up = new Float32Array(16).map((_, i) => Math.sin((i / 15) * (Math.PI / 2)))
      const down = up.map((_, i) => up[15 - i])
      const scaled = (c: Float32Array, k: number) => c.map((y) => y * k)
      let at = t + (b - XFADE) / rate // start of the next crossfade
      let xg = this.ctx.createGain()
      xg.connect(g)
      source(t, 0, xg)
      for (let k = 1; k <= 16 && at < hold; k++) {
        xg.gain.setValueCurveAtTime(scaled(down, Math.pow(r, k - 1)), at, x)
        ends[ends.length - 1] = at + x
        xg = this.ctx.createGain()
        xg.gain.value = 0
        xg.connect(g)
        xg.gain.setValueCurveAtTime(scaled(up, Math.pow(r, k)), at, x)
        source(at, a, xg)
        at += (b - a - XFADE) / rate
      }
      // the last repeat plays out to the file's end
      stop = at + (XFADE + fade) / rate
    }
    if (end !== null && hold < stop) {
      g.gain.setValueAtTime(level, end)
      // 6 time constants: the gain is down to 0.25% when the sources stop
      g.gain.setTargetAtTime(0, end, release / 6)
      stop = hold
    }
    if (!srcs.length) source(t, 0, g)
    srcs.forEach((s, i) => s.stop(Math.min(ends[i], stop)))
    v.srcs = srcs
    v.gain = g
    v.end = stop
    return v
  }

  /** Plays a note from a zoned instrument (bass, keys); `fade` as in play. */
  note(zones: RZone[], midi: number, vel: number, t: number, level: number, dest: AudioNode, end: number, release: number, fade = 0): Voice {
    const z = pickZone(zones, midi)
    const l = pickLayer(z.layers, vel)
    return this.play(nextBuffer(l), t, Math.pow(2, (midi - z.root) / 12), level * velGain(l, vel), dest, end, release, fade)
  }

  /** Plays a one-shot from velocity layers (drums). */
  hit(layers: RLayer[], vel: number, t: number, level: number, dest: AudioNode): Voice {
    const l = pickLayer(layers, vel)
    return this.play(nextBuffer(l), t, 1, level * velGain(l, vel), dest, null, 0)
  }

  /** Fades every voice out from `at`, also ones scheduled to start later. */
  stopAll(at: number, sec: number) {
    for (const v of this.voices) fadeOut(v, at, sec)
  }

  /** A free slot, or the oldest one faded out to make room. */
  private claim(t: number): Voice {
    const n = this.voices.length
    for (let i = 0; i < n; i++) {
      const k = (this.next + i) % n
      if (this.voices[k].end <= t) {
        this.next = (k + 1) % n
        return this.voices[k]
      }
    }
    const v = this.voices[this.next]
    this.next = (this.next + 1) % n
    fadeOut(v, Math.max(this.ctx.currentTime, t - 0.01))
    return v
  }
}
