import { describe, expect, it } from 'vitest'
import { IDEA_LEN, ideaSegments, ideasFor, makeIdea, segmentAt } from '../ideas'
import { LESSONS } from '../data'
import { scalePcsOf } from '../improv'
import { pc } from '../../music/theory'

const tl = (chords: string[], listenBars: number[] = []) => ({ listenBars, bars: chords.length, chordTimeline: chords.map((symbol, i) => ({ beat: i * 4, symbol })) })

describe('jam ideas', () => {
  it('holds an idea two bars at least and four at most', () => {
    expect(ideaSegments(tl(['Am', 'Am', 'Am', 'Am', 'Am', 'G', 'G', 'Am'])).map((s) => s.from)).toEqual([0, 4, 6])
    // a chord per bar: a new idea every two bars, not every bar
    expect(ideaSegments(tl(['Am', 'G', 'F', 'G', 'Am', 'G'])).map((s) => s.from)).toEqual([0, 2, 4])
  })

  it('starts an idea with each call of an answer jam, for the chord of the answer', () => {
    expect(ideaSegments(tl(['F', 'Am', 'F', 'Am'], [0, 2]))).toEqual([{ from: 0, chord: 'Am' }, { from: 2, chord: 'Am' }])
    expect(ideaSegments(tl(['Am', 'F', 'Am', 'F', 'Am'], [1, 3])).map((s) => s.from)).toEqual([0, 1, 3])
  })

  it('finds the segment of a bar', () => {
    const segs = [{ from: 0 }, { from: 4 }, { from: 6 }]
    expect([0, 3, 4, 5, 6, 40].map((b) => segmentAt(segs, b))).toEqual([0, 0, 1, 1, 2, 2])
  })

  it('makes ideas from the notes of the jam only, for every jam that shows them', () => {
    const jams = LESSONS.filter((l) => ideasFor(l))
    expect(jams.length).toBeGreaterThan(0)
    for (const l of jams) {
      const spec = ideasFor(l)!
      const scale = scalePcsOf(spec)
      for (const chord of ['Am', 'G', 'E7', '']) {
        const idea = makeIdea(spec, chord)
        if (!idea) continue
        expect(idea.notes.length).toBeLessThanOrEqual(IDEA_LEN)
        for (const n of idea.notes) expect(scale).toContain(pc(n.midi))
      }
    }
  })

  it('shows none in echo jams', () => {
    for (const l of LESSONS) if (l.improv?.callResponse?.mode === 'mixed') expect(ideasFor(l)).toBeNull()
  })
})
