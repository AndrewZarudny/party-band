import { describe, expect, it } from 'vitest'
import type { SkillStats } from '../data'
import { dailyBest, emptyStats, mergeStatsRaw, parseStats, record } from '../data'
import { MAX_LEN, MIN_LEN, gradePhrase, nextLength } from '../ear'
import { barDrifts, cycleOk, STEADY_MS } from '../clock'
import { widenAfter } from '../fret'

const stats = (o: Partial<SkillStats>) => JSON.stringify({ ...emptyStats(), ...o })
const entry = (id: string, at: number, game: SkillStats['history'][number]['game'] = 'find', score = 1) => ({ id, game, at, score })

describe('mergeStatsRaw', () => {
  it('takes the levels of the copy that changed them last, even when lower', () => {
    const a = stats({ levels: { fretMax: 12, clockGap: 4, earLen: 6 }, levelsAt: 100 })
    const b = stats({ levels: { fretMax: 5, clockGap: 2, earLen: 3 }, levelsAt: 200 })
    for (const m of [mergeStatsRaw(a, b), mergeStatsRaw(b, a)]) {
      const s = parseStats(m)
      expect(s.levels).toEqual({ fretMax: 5, clockGap: 2, earLen: 3 })
      expect(s.levelsAt).toBe(200)
    }
  })

  it('copies without a level time keep the higher levels', () => {
    const a = stats({ levels: { fretMax: 9, clockGap: 1, earLen: 4 } })
    const b = stats({ levels: { fretMax: 7, clockGap: 3, earLen: 2 } })
    expect(parseStats(mergeStatsRaw(a, b)).levels).toEqual({ fretMax: 9, clockGap: 3, earLen: 4 })
  })

  it('keeps the better best per game (lower drift for the clock)', () => {
    const a = stats({ best: { find: 10, clock: 30, 'changes:A-E': 20 } })
    const b = stats({ best: { find: 12, clock: 18, ear: 4 } })
    const s = parseStats(mergeStatsRaw(a, b))
    expect(s.best).toEqual({ find: 12, clock: 18, ear: 4, 'changes:A-E': 20 })
    expect(parseStats(mergeStatsRaw(b, a)).best).toEqual(s.best)
  })

  it('combines history by id, newest first; today XP from the later day', () => {
    const a = stats({ history: [entry('x', 3), entry('y', 1)], xp: { day: '2026-11-04', got: 30 } })
    const b = stats({ history: [entry('y', 1), entry('z', 2)], xp: { day: '2026-11-03', got: 90 } })
    const s = parseStats(mergeStatsRaw(a, b))
    expect(s.history.map((e) => e.id)).toEqual(['x', 'z', 'y'])
    expect(s.xp).toEqual({ day: '2026-11-04', got: 30 })
    const same = parseStats(mergeStatsRaw(a, stats({ xp: { day: '2026-11-04', got: 50 } })))
    expect(same.xp.got).toBe(50)
  })

  it('is idempotent', () => {
    const a = stats({ history: [entry('x', 3)], best: { find: 3 }, levels: { fretMax: 7, clockGap: 2, earLen: 3 }, levelsAt: 5 })
    const m = mergeStatsRaw(a, a)
    expect(mergeStatsRaw(m, a)).toBe(m)
    expect(parseStats(m)).toEqual(parseStats(a))
  })

  it('parseStats clamps levels and drops bad entries', () => {
    const s = parseStats(JSON.stringify({ levels: { fretMax: 8, clockGap: 9, earLen: 1 }, history: [entry('a', 1), { id: 'b', game: 'nope', at: 1 }], best: { find: 'x' } }))
    expect(s.levels).toEqual({ fretMax: 5, clockGap: 4, earLen: 2 })
    expect(s.history.map((e) => e.id)).toEqual(['a'])
    expect(s.best).toEqual({})
    expect(parseStats('{bad')).toEqual(emptyStats())
  })
})

describe('record and dailyBest', () => {
  it('a new best is higher, or lower for the clock', () => {
    let s = emptyStats()
    let r = record(s, 'find', 5, undefined, 1)
    expect(r.best).toBe(true)
    s = r.stats
    expect(record(s, 'find', 4, undefined, 2).best).toBe(false)
    r = record(s, 'clock', 40, undefined, 3)
    s = r.stats
    expect(record(s, 'clock', 30, undefined, 4).best).toBe(true)
    expect(record(s, 'clock', 50, undefined, 4).best).toBe(false)
    expect(record(s, 'changes', 9, 'A-E', 5).stats.best['changes:A-E']).toBe(9)
  })

  it('dailyBest gives one point per day, oldest first', () => {
    const day = (d: number, h: number) => new Date(2026, 10, d, h).getTime()
    const s = { ...emptyStats(), history: [entry('1', day(4, 10), 'clock', 30), entry('2', day(4, 18), 'clock', 20), entry('3', day(3, 10), 'clock', 50)] }
    expect(dailyBest(s, 'clock')).toEqual([
      { day: '2026-11-03', score: 50 },
      { day: '2026-11-04', score: 20 },
    ])
  })
})

describe('level rules', () => {
  it('ear: two passes in a row add a note, two misses take one away, within 2..6', () => {
    expect(nextLength(3, 2)).toEqual({ len: 4, streak: 0 })
    expect(nextLength(3, -2)).toEqual({ len: 2, streak: 0 })
    expect(nextLength(3, 1)).toEqual({ len: 3, streak: 1 })
    expect(nextLength(MAX_LEN, 2).len).toBe(MAX_LEN)
    expect(nextLength(MIN_LEN, -2).len).toBe(MIN_LEN)
  })

  it('ear: grades each note; right notes in the wrong order are marked as such', () => {
    expect(gradePhrase([40, 45], [40, 45])).toEqual({ marks: ['ok', 'ok'], pass: true, orderOnly: false })
    expect(gradePhrase([40, 45], [52, 45]).marks).toEqual(['octave', 'ok'])
    expect(gradePhrase([40, 45], [45, 40])).toMatchObject({ pass: false, orderOnly: true })
    expect(gradePhrase([40, 45], [40])).toMatchObject({ marks: ['ok', 'miss'], pass: false })
  })

  it('clock: a cycle is steady when every silent bar was played and the last within 60 ms', () => {
    expect(cycleOk([10, -STEADY_MS])).toBe(true)
    expect(cycleOk([10, STEADY_MS + 1])).toBe(false)
    expect(cycleOk([null, 0])).toBe(false)
    expect(cycleOk([])).toBe(false)
  })

  it('clock: bar drift is the median offset of its strums, null under 2 strums', () => {
    const spb = 0.5
    // bar at 10 s: strums 20 ms late, 40 ms late, 30 ms late
    expect(barDrifts([10.02, 10.54, 11.03], [10], spb)).toEqual([30])
    expect(barDrifts([10.02], [10], spb)).toEqual([null])
    expect(barDrifts([9.0, 13.0], [10], spb)).toEqual([null])
  })

  it('fret: widens one step at 85% right over 10 or more spots', () => {
    expect(widenAfter(5, 9, 10)).toBe(7)
    expect(widenAfter(5, 8, 10)).toBe(5)
    expect(widenAfter(5, 9, 9)).toBe(5)
    expect(widenAfter(12, 20, 20)).toBe(12)
  })
})
