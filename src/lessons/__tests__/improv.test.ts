import { describe, expect, it } from 'vitest'
import type { Chart, ImprovSpec, PlayedNote } from '../types'
import { analyseImprov, jamStats } from '../improv'

// A 4-bar 12-bar-style chart: A7, A7, D7, E7 (no judged events)
function chart(over: Partial<Chart> = {}): Chart {
  const symbols = ['A7', 'A7', 'D7', 'E7']
  return {
    lessonId: 'test', bars: 4, totalBeats: 16, events: [], calls: [], listenBars: [],
    chordTimeline: symbols.map((symbol, i) => ({ beat: 4 * i, symbol })), minGapBeats: Infinity, ...over,
  }
}
const n = (beat: number, midi: number): PlayedNote => ({ t: beat / 2, beat, midi, legato: false })
// A = 57 (pc 9), C = 60 (pc 0), E = 64 (pc 4), D = 62 (pc 2), G = 67 (pc 7)

describe('jamStats', () => {
  it('shares strong-beat notes that are chord tones', () => {
    // beat 0 A over A7 (yes), beat 2 C over A7 (no), beat 8 D over D7 (yes), beat 10.2 G over D7 (no), beat 12 E over E7 (yes)
    const notes = [n(0, 57), n(2, 60), n(8, 62), n(10.2, 67), n(12, 64)]
    const s = jamStats(chart(), notes)
    expect(s.strong).toBeCloseTo(3 / 5)
  })

  it('ignores off-beat notes and notes in listen bars', () => {
    // beat 1 and 3.5 are weak; bar 1 is a listen bar
    const notes = [n(0, 57), n(1, 60), n(3.5, 60), n(4, 60), n(6, 60), n(8, 62), n(12, 64), n(14, 57)]
    const s = jamStats(chart({ listenBars: [1] }), notes)
    // strong: 0 (A over A7 yes), 8 (D over D7 yes), 12 (E over E7 yes), 14 (A over E7 no)
    expect(s.strong).toBeCloseTo(3 / 4)
  })

  it('counts a note just before the bar line on the next downbeat', () => {
    const notes = [n(3.8, 62), n(8, 62), n(12, 64), n(14, 64)]
    // 3.8 -> beat 4, bar 1 (A7): D is not a tone of A7
    expect(jamStats(chart(), notes).strong).toBeCloseTo(3 / 4)
  })

  it('is null under 4 strong-beat notes', () => {
    expect(jamStats(chart(), [n(0, 57), n(2, 57), n(4, 57)]).strong).toBeNull()
  })

  it('measures the rest between phrases', () => {
    // phrase 1: 0, 0.5, 1 ; rest 3 beats ; phrase 2: 4, 4.5 ; rest 2 beats ; phrase 3: 6.5
    const notes = [n(0, 57), n(0.5, 60), n(1, 62), n(4, 64), n(4.5, 62), n(6.5, 57)]
    const s = jamStats(chart(), notes)
    expect(s.phrases).toBe(3)
    expect(s.restBeats).toBeCloseTo(2.5)
  })

  it('is null under 2 phrases', () => {
    const s = jamStats(chart(), [n(0, 57), n(0.5, 60)])
    expect(s.phrases).toBe(1)
    expect(s.restBeats).toBeNull()
  })

  it('counts playing bars with no note', () => {
    expect(jamStats(chart(), [n(0, 57), n(9, 62)]).silentBars).toBe(2) // bars 1 and 3
    expect(jamStats(chart({ listenBars: [1] }), [n(0, 57), n(9, 62)]).silentBars).toBe(1)
    expect(jamStats(chart(), []).silentBars).toBe(4)
  })
})

describe('analyseImprov', () => {
  const spec: ImprovSpec = { key: 9, scale: 'minorPent', boxFret: 5, chordTones: true, minNotes: 4, weights: { targets: 50, inScale: 50 } }

  it('adds jam stats to the report', () => {
    const notes = [n(0, 57), n(2, 60), n(4, 57), n(8, 62), n(12, 64)]
    const r = analyseImprov(spec, chart(), notes, [])
    expect(r.tooFew).toBe(false)
    expect(r.jam).toBeDefined()
    expect(r.jam!.silentBars).toBe(0)
  })

  it('still reports what it has when there are too few notes', () => {
    const r = analyseImprov(spec, chart(), [n(0, 57)], [])
    expect(r.tooFew).toBe(true)
    expect(r.jam).toEqual({ strong: null, restBeats: null, phrases: 1, silentBars: 3 })
  })
})
