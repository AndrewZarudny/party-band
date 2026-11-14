import { describe, expect, it } from 'vitest'
import { barEvents, barWindow } from '../barReplay'
import type { Chart } from '../types'

describe('hearing the hardest bar', () => {
  it("a bar's place on the tape: its beats as heard, plus the round trip, with a little room either side", () => {
    // Beat 0 at 10 s, 0.5 s a beat, bar 2 = beats 8 to 12, round trip 0.1 s.
    const w = barWindow(10, 0.5, 2, 0.1)
    expect(w.from).toBeCloseTo(10 + 4 + 0.1 - 0.12)
    expect(w.to).toBeCloseTo(10 + 4 + 0.1 + 2 + 0.12)
  })

  it("the bar's notes, with their beat inside the bar", () => {
    const chart = { events: [{ kind: 'note', beat: 3 }, { kind: 'note', beat: 4 }, { kind: 'note', beat: 6.5 }, { kind: 'note', beat: 8 }] } as unknown as Chart
    expect(barEvents(chart, 1).map((x) => x.beat)).toEqual([0, 2.5])
  })
})
