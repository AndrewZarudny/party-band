import { describe, expect, it } from 'vitest'
import { LESSONS, WORLDS, lessonById, validateLessons } from '../data'
import { buildChart } from '../charts'

describe('lesson data', () => {
  it('validateLessons finds no problems', () => {
    expect(validateLessons()).toEqual([])
  })

  it('every world lists known lessons, the boss last', () => {
    for (const w of WORLDS) {
      expect(w.lessons.length).toBeGreaterThan(0)
      for (const id of w.lessons) expect(lessonById(id)?.world).toBe(w.id)
      expect(lessonById(w.lessons[w.lessons.length - 1])?.boss).toBe(true)
    }
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s builds a sound chart', (_id, l) => {
    const c = buildChart(l)
    expect(c.lessonId).toBe(l.id)
    expect(c.bars).toBe(l.bars)
    expect(c.totalBeats).toBe(l.bars * 4)
    expect(c.chordTimeline).toHaveLength(c.bars)
    c.events.forEach((e, i) => {
      expect(e.id).toBe(i)
      expect(e.beat).toBeGreaterThanOrEqual(0)
      expect(e.beat).toBeLessThan(c.totalBeats)
      if (i > 0) expect(e.beat).toBeGreaterThanOrEqual(c.events[i - 1].beat)
      if (e.kind === 'note') {
        expect(e.string).toBeGreaterThanOrEqual(0)
        expect(e.string).toBeLessThanOrEqual(5)
        expect(e.fret).toBeLessThanOrEqual(15)
      }
    })
    for (const b of c.listenBars) expect(b).toBeLessThan(c.bars)
    if (l.type === 'notes' || l.type === 'chords' || l.type === 'rhythm') expect(c.events.some((e) => e.kind !== 'rest')).toBe(true)
    // the same lesson always gives the same chart (seeded phrases)
    expect(buildChart(l)).toEqual(c)
  })

  it('only the sync lesson has no band', () => {
    expect(LESSONS.filter((l) => !l.backing).map((l) => l.id)).toEqual(['w1-01'])
  })
})
