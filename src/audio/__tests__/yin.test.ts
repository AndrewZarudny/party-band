import { describe, expect, it } from 'vitest'
import { yin } from '../engine'
import { TUNINGS } from '../../music/tunings'

// A plucked string: a strong 2nd and 3rd harmonic over the root, like a guitar's low strings.
function pluck(freq: number, sr: number, n = 2048) {
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    b[i] = 0.3 * Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(2 * Math.PI * 2 * freq * t + 0.4) + 0.25 * Math.sin(2 * Math.PI * 3 * freq * t + 1.1)
  }
  return b
}

describe('the tuner hears every open string', () => {
  const strings = [...new Set(TUNINGS.flatMap((t) => t.notes))]
  for (const sr of [44100, 48000])
    it(`every string of every tuning at ${sr} Hz`, () => {
      for (const m of strings) {
        const f = 440 * Math.pow(2, (m - 69) / 12)
        const got = yin(pluck(f, sr), sr, new Float32Array(1024), 0.15)
        expect(Math.abs(1200 * Math.log2(got / f)), `MIDI ${m} (${f.toFixed(1)} Hz) heard as ${got.toFixed(1)} Hz`).toBeLessThan(3)
      }
    })
})
