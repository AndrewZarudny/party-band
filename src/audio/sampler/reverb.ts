// A small room for the sampled band, generated in code (no impulse response files): a few early
// reflections and a darkening noise tail, about one second long. One buffer per sample rate.

const rooms = new Map<number, AudioBuffer>()

export function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate
  const cached = rooms.get(rate)
  if (cached) return cached
  const rt60 = 0.9
  const pre = Math.round(0.012 * rate)
  const len = Math.round(1.1 * rate)
  const buf = ctx.createBuffer(2, len, rate)
  const early = [0.017, 0.023, 0.031, 0.041, 0.053, 0.067]
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate
      // The tail loses its highs as it decays (a one-pole low-pass that closes over time).
      const a = 0.55 * Math.exp(-t * 3) + 0.08
      lp += a * (Math.random() * 2 - 1 - lp)
      d[i] = lp * Math.exp((-6.9 * t) / rt60) * Math.min(1, t / 0.02)
    }
    early.forEach((s, k) => {
      const i = Math.round((s + (ch ? 0.0035 * (k % 2 ? 1 : -1) : 0)) * rate)
      if (i < len) d[i] += (k % 2 ? -0.5 : 0.5) * Math.pow(0.8, k)
    })
  }
  rooms.set(rate, buf)
  return buf
}
