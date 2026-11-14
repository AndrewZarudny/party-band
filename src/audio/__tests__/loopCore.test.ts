import { describe, expect, it } from 'vitest'
import { LoopCore } from '../loopCore'

// Runs the core block by block over a signal, like the audio thread: input(f) is the guitar at frame f.
function run(core: LoopCore, from: number, to: number, input: (f: number) => number, block = 8): number[] {
  const out: number[] = []
  for (let f = from; f < to; f += block) {
    const n = Math.min(block, to - f)
    const inp = Float32Array.from({ length: n }, (_, i) => input(f + i))
    const o = new Float32Array(n)
    core.process(inp, o, f)
    out.push(...o)
  }
  return out
}
const ramp = (f: number) => f // a different value every frame, so positions are checkable

describe('the looper', () => {
  it('free mode: press, play, press: the loop is exactly what was played between the presses, seamless', () => {
    const c = new LoopCore(1000)
    c.record(100)
    run(c, 100, 140, ramp)
    c.close(140)
    expect(c.state).toBe('playing')
    expect(c.len).toBe(40)
    const out = run(c, 140, 220, () => 0)
    expect(out.slice(0, 40)).toEqual(Array.from({ length: 40 }, (_, i) => 100 + i))
    expect(out.slice(40, 80)).toEqual(out.slice(0, 40)) // round again, no gap
  })

  it('an overdub is written one round trip early, so it lines up with what was heard', () => {
    const c = new LoopCore(1000)
    c.rt = 3
    c.record(0)
    run(c, 0, 20, () => 0)
    c.close(20)
    c.overdub()
    // The player hears loop position p at frame 20 + p and plays 1 there; it arrives rt frames later.
    run(c, 20, 40, (f) => (f === 20 + 5 + 3 ? 1 : 0))
    c.play(40)
    const out = run(c, 40, 60, () => 0)
    expect(out.indexOf(1)).toBe(5)
  })

  it('bars mode: a fixed length from the downbeat, the take shifted by the round trip, then it plays on its own', () => {
    const c = new LoopCore(1000)
    c.rt = 4
    c.record(100, 32)
    // Notes played on the click arrive 4 frames late: frame 104 holds the note played on the downbeat.
    const out = run(c, 100, 200, (f) => (f === 104 ? 7 : 0))
    expect(c.state).toBe('playing')
    expect(c.len).toBe(32)
    // Playback starts at the end of the bars (frame 132) with the downbeat note at its start.
    expect(out[132 - 100]).toBe(7)
    expect(out[164 - 100]).toBe(7)
  })

  it('undo takes off the last overdub, never the first take; stop and play from the top', () => {
    const c = new LoopCore(1000)
    c.record(0)
    run(c, 0, 10, () => 1)
    c.close(10)
    c.overdub()
    run(c, 10, 20, () => 1)
    c.play(20)
    expect(c.layers.length).toBe(2)
    c.undo()
    c.undo()
    expect(c.layers.length).toBe(1)
    c.stop()
    expect(run(c, 20, 30, () => 0).every((v) => v === 0)).toBe(true)
    c.play(30)
    expect(run(c, 30, 40, () => 0).every((v) => v === 1)).toBe(true)
  })

  it('stopping a free recording before closing it throws the take away', () => {
    const c = new LoopCore(1000)
    c.record(0)
    run(c, 0, 10, () => 1)
    c.stop()
    expect(c.state).toBe('idle')
    expect(c.len).toBe(0)
  })
})

describe('keeping a loop', () => {
  it('the mix is every layer summed, limited so stacked overdubs never clip', () => {
    const c = new LoopCore(1000)
    c.record(0)
    run(c, 0, 4, () => 0.6)
    c.close(4)
    c.overdub()
    run(c, 4, 8, () => 0.6)
    c.play(8)
    const m = c.mix()
    expect(m.length).toBe(4)
    expect(Math.max(...m)).toBeCloseTo(0.98)
  })
})

describe('the looper locked to the band', () => {
  it("starts on the band's next downbeat, with room for the count-in", async () => {
    const { nextDownbeat } = await import('../looper')
    // Band from 10 s at 120 BPM: a bar every 2 s.
    expect(nextDownbeat(13.0, { start: 10, bpm: 120 })).toBeCloseTo(14)
    expect(nextDownbeat(13.8, { start: 10, bpm: 120 })).toBeCloseTo(16) // 14 is too close
    expect(nextDownbeat(9.0, { start: 10, bpm: 120 })).toBeCloseTo(10) // in the band's count-in: its first downbeat
  })
})
