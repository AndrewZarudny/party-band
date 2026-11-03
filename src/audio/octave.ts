// Octave down: the guitar played back at half speed through two crossfading delay taps (a classic
// delay-line pitch shifter), so it sounds an octave lower in real time, like a bass. Best on single notes.

const PROCESSOR = `
class OctaveDown extends AudioWorkletProcessor {
  constructor() {
    super()
    this.size = 16384
    this.buf = new Float32Array(this.size)
    this.write = 0
    this.minWindow = sampleRate * 0.03
    this.period = sampleRate / 110
    const w = this.windowFor(this.period)
    this.taps = [{ d: 0, w }, { d: w / 2, w }]
    this.hop = 0
    this.dec = Math.max(1, Math.round(sampleRate / 12000))
    this.x = new Float32Array(512)
    this.diff = new Float32Array(240)
  }
  // An even number of the note's periods, so each jump of a tap lands on the same point of the wave.
  windowFor(period) {
    const pairs = Math.ceil(this.minWindow / (2 * period))
    return Math.min(this.size / 2, 2 * period * pairs)
  }
  // The note's period (YIN on the last ~43 ms, at 12 kHz); kept when nothing clear is playing.
  estimate() {
    const { buf, size, dec, x, diff } = this
    const n = x.length
    let energy = 0
    for (let j = 0; j < n; j++) {
      let v = 0
      const base = this.write - (n - j) * dec
      for (let k = 0; k < dec; k++) v += buf[(base + k + size) % size]
      x[j] = v / dec
      energy += x[j] * x[j]
    }
    if (energy / n < 1e-6) return
    const span = n - diff.length
    let running = 0
    for (let tau = 1; tau < diff.length; tau++) {
      let d = 0
      for (let j = 0; j < span; j++) {
        const e = x[j] - x[j + tau]
        d += e * e
      }
      running += d
      diff[tau] = running ? (d * tau) / running : 1
    }
    for (let tau = 8; tau < diff.length - 1; tau++) {
      if (diff[tau] < 0.15 && diff[tau] <= diff[tau + 1]) {
        const a = diff[tau - 1], b = diff[tau], c = diff[tau + 1]
        const shift = a + c - 2 * b ? (a - c) / (2 * (a + c - 2 * b)) : 0
        this.period = (tau + shift) * dec
        return
      }
    }
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const out = outputs[0] && outputs[0][0]
    if (!out) return true
    const { buf, size } = this
    for (let i = 0; i < out.length; i++) {
      buf[this.write] = input ? input[i] : 0
      if (++this.hop >= 256) {
        this.hop = 0
        this.estimate()
      }
      let sum = 0
      let weight = 0
      for (let t = 0; t < 2; t++) {
        const tap = this.taps[t]
        // The delay grows half a sample per sample, so the tap reads at half speed: an octave down.
        tap.d += 0.5
        if (tap.d >= tap.w) {
          // Restart half a window away from the other tap, but a whole number of periods from it,
          // so the two taps carry the same wave and never cancel.
          const other = this.taps[1 - t]
          const p = this.period
          tap.w = this.windowFor(p)
          let d = other.d + p * Math.round(((other.d + tap.w / 2) % tap.w - other.d) / p)
          while (d < 0) d += p
          while (d >= tap.w) d -= p
          tap.d = Math.max(0, d)
        }
        let r = this.write - tap.d - 2
        if (r < 0) r += size
        const i0 = Math.floor(r)
        const f = r - i0
        const v = buf[i0 % size] * (1 - f) + buf[(i0 + 1) % size] * f
        // Each tap fades out around its jump.
        const s = Math.sin((Math.PI * tap.d) / tap.w)
        sum += v * s * s
        weight += s * s
      }
      out[i] = sum / Math.max(weight, 0.5)
      this.write = (this.write + 1) % size
    }
    return true
  }
}
registerProcessor('octave-down', OctaveDown)
`

const loaded = new WeakMap<BaseAudioContext, Promise<void>>()

/** An octave-down node (mono in, mono out). */
export async function createOctaveDown(ctx: AudioContext): Promise<AudioWorkletNode> {
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'application/javascript' }))
    loaded.set(ctx, ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)))
  }
  await loaded.get(ctx)
  return new AudioWorkletNode(ctx, 'octave-down', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' })
}
