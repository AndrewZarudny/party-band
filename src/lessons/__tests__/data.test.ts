import { describe, expect, it } from 'vitest'
import { LEGACY_IDS, LESSONS, TWELVE_A7, TWELVE_E7, WORLDS, lessonById, validateLessons } from '../data'
import { buildChart } from '../charts'
import { FEELS } from '../../music/parts'

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

// The 37 lessons before the jam library and the blues/rock material: none may disappear (saved progress keys on them)
const OLD_IDS = [
  'w1-01', 'w1-02', 'w1-03', 'w1-04', 'w2-01', 'w2-02', 'w2-03', 'w2-05', 'w2-04',
  'w3-01', 'w3-02', 'w3-03', 'w3-05', 'w3-04', 'w4-01', 'w4-02', 'w4-03', 'w4-04',
  'w5-01', 'w5-02', 'w5-03', 'w5-04', 'w5-06', 'w6-01', 'w6-02', 'w6-03', 'w6-04', 'w6-05',
  'w7-01', 'w7-02', 'w7-03', 'w7-04', 'w8-01', 'w8-02', 'w8-03', 'w8-04', 'w8-05',
]
const NEW_IDS = ['w1-05', 'w2-06', 'w2-07', 'w3-06', 'w3-07', 'w3-09', 'w3-10', 'w4-05', 'w4-06', 'w5-11', 'w5-07', 'w5-08', 'w5-09',
  'w7-05', 'w8-06', 'w8-07', 'w8-08', 'w8-09', 'w8-10', 'w8-11', 'w8-12']

describe('blues and rock material', () => {
  it('keeps every old lesson id in a world, and no id moved', () => {
    expect(OLD_IDS).toHaveLength(37)
    const listed = WORLDS.flatMap((w) => w.lessons)
    for (const id of OLD_IDS) expect(listed).toContain(id)
    expect(LEGACY_IDS).toEqual({})
  })

  it('lists the new lessons in the stated order', () => {
    const world = (id: number) => WORLDS.find((w) => w.id === id)!.lessons
    expect(world(1)).toEqual(['w1-01', 'w1-02', 'w1-03', 'w1-05', 'w1-04'])
    expect(world(2)).toEqual(['w2-01', 'w2-02', 'w2-03', 'w2-05', 'w2-06', 'w2-07', 'w2-04'])
    expect(world(3)).toEqual(['w3-01', 'w3-02', 'w3-06', 'w3-07', 'w3-03', 'w3-05', 'w3-09', 'w3-10', 'w3-04'])
    expect(world(4)).toEqual(['w4-01', 'w4-02', 'w4-03', 'w4-05', 'w4-06', 'w4-04'])
    expect(world(5)).toEqual(['w5-01', 'w5-11', 'w5-02', 'w5-03', 'w5-04', 'w5-07', 'w5-08', 'w5-09', 'w5-06'])
    expect(world(7)).toEqual(['w7-01', 'w7-02', 'w7-03', 'w7-05', 'w7-04'])
    expect(world(8)).toEqual(['w8-01', 'w8-02', 'w8-03', 'w8-04', 'w8-06', 'w8-07', 'w8-08', 'w8-09', 'w8-10', 'w8-11', 'w8-12', 'w8-05'])
    expect(LESSONS).toHaveLength(OLD_IDS.length + NEW_IDS.length)
  })

  it('new lessons sit at 60–95 BPM, in A or E', () => {
    for (const id of NEW_IDS) {
      const l = lessonById(id)!
      expect(l.bpm, id).toBeGreaterThanOrEqual(60)
      expect(l.bpm, id).toBeLessThanOrEqual(95)
      if (l.improv) expect([9, 4], id).toContain(l.improv.key)
    }
  })

  it('free lessons are jams and never bosses', () => {
    const free = LESSONS.filter((l) => l.free)
    expect(free.map((l) => l.id)).toEqual(['w8-06', 'w8-07', 'w8-08', 'w8-09', 'w8-10', 'w8-11', 'w8-12'])
    for (const l of free) {
      expect(l.boss).toBeFalsy()
      expect(l.type).toBe('improv')
    }
  })

  it('the boogie is judged as two-note shapes, by pitch', () => {
    const c = buildChart(lessonById('w3-07')!)
    const chords = c.events.filter((e) => e.kind === 'chord')
    expect(chords).toHaveLength(96)
    for (const e of chords) {
      expect(e.power).toBe(true)
      expect(e.chroma).toBe(false)
      expect(e.pcs).toHaveLength(2)
    }
    // A6 = open A plus F# on the D string; lowest string first
    const a6 = chords.find((e) => e.symbol === 'A6')!
    expect(a6.pcs).toEqual([9, 6])
    expect(chords.find((e) => e.symbol === 'E5')!.pcs).toEqual([4, 11])
  })

  it('slow blues exists and swings; the 12-bars are right', () => {
    expect(FEELS.slowblues.swing).toBe(true)
    expect(lessonById('w8-08')!.backing!.feel).toBe('slowblues')
    expect(TWELVE_A7).toEqual(['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'])
    expect(TWELVE_E7).toHaveLength(12)
    expect(TWELVE_E7[8]).toBe('B7')
  })
})
