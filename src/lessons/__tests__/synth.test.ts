import { describe, expect, it } from 'vitest'
import { pluck } from '../synth'

// A fixed noise source so the pluck is the same every run.
function seeded(seed = 1) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

const SR = 48000

/** The lag, in samples, at which the signal best matches itself shifted. */
function bestLag(x: Float32Array, from: number, to: number, start: number, span: number) {
  let best = from
  let bestScore = -Infinity
  for (let lag = from; lag <= to; lag++) {
    let s = 0
    for (let i = start; i < start + span; i++) s += x[i] * x[i + lag]
    if (s > bestScore) [bestScore, best] = [s, lag]
  }
  return best
}

describe('the plucked lead voice', () => {
  it.each([82.41, 220, 523.25])('rings at %f Hz once played at its rate', (freq) => {
    const p = pluck(SR, freq, seeded())
    const period = SR / freq
    const lag = bestLag(p.samples, Math.floor(period * 0.8), Math.ceil(period * 1.2), 2000, 4000)
    // The rendered string's period is within a sample of the loop length; the rate puts it exactly on pitch.
    expect(Math.abs(lag - period * p.rate)).toBeLessThanOrEqual(1)
    expect(Math.abs(p.rate - 1)).toBeLessThan(0.01)
  })

  it('stays in range and dies away like a string', () => {
    const p = pluck(SR, 196, seeded(7))
    const rms = (a: number, b: number) => Math.sqrt(p.samples.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a))
    expect(Math.max(...p.samples.map(Math.abs))).toBeCloseTo(1, 5)
    expect(rms(SR * 2, SR * 2.4)).toBeLessThan(rms(0, SR * 0.2) / 3)
  })
})
