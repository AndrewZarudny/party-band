import { describe, expect, it } from 'vitest'
import type { SkillStats } from '../data'
import { dailyBest, emptyStats, fretTimeRows, lowerBetter, mergeStatsRaw, parseStats, record, skillXp } from '../data'
import { MAX_LEN, MIN_LEN, gradePhrase, licksFrom, nextLength } from '../ear'
import { STANDARD_TUNING } from '../../music/theory'
import { barDrifts, cycleOk, STEADY_MS } from '../clock'
import { widenAfter } from '../fret'
import { CORE_PAIRS, RETIRE_AT, weakestPair } from '../chords'
import { findUnrated } from '../takes'

describe('measurement entries', () => {
  it('the new game ids parse and merge; lower is better for clock, fretTime and drift', () => {
    const a = stats({ history: [entry('a', 1, 'fretTime', 2100), entry('b', 2, 'drift', 12)], best: { 'fretTime:0': 2100, 'drift:4': 12 } })
    const b = stats({ history: [entry('c', 3, 'earFirst', 75), entry('d', 4, 'rate', 4)], best: { 'fretTime:0': 1800, 'drift:4': 20, earFirst: 75 } })
    const s = parseStats(mergeStatsRaw(a, b))
    expect(s.history.map((e) => e.game)).toEqual(['rate', 'earFirst', 'drift', 'fretTime'])
    expect(s.best).toEqual({ 'fretTime:0': 1800, 'drift:4': 12, earFirst: 75 })
    expect(['clock', 'fretTime', 'drift'].every((g) => lowerBetter(g as never))).toBe(true)
    expect(lowerBetter('earFirst')).toBe(false)
  })

  it('fret times: median per string, strings with 2 or more answers only', () => {
    const rows = fretTimeRows([
      { string: 0, ms: 1000 },
      { string: 0, ms: 3000 },
      { string: 0, ms: 2000 },
      { string: 1, ms: 900 },
      { string: 4, ms: 1500 },
      { string: 4, ms: 2500 },
    ])
    expect(rows).toEqual([
      { string: 0, ms: 2000 },
      { string: 4, ms: 2000 },
    ])
  })
})

describe('weakestPair', () => {
  it('picks the lowest best, skips retired pairs, core pairs first on ties', () => {
    const s = { ...emptyStats(), best: { 'changes:A-D': 30, 'changes:A-E': 22, 'changes:D-E': RETIRE_AT } }
    expect(weakestPair(s, ['A', 'D', 'E'])).toBe('A-E')
    // never-played pairs count as 0; ties go to the core pairs in order
    expect(weakestPair(emptyStats(), ['E', 'A', 'D', 'G'])).toBe(CORE_PAIRS[0])
    expect(weakestPair(emptyStats(), ['E5', 'A5'])).toBe('A5-E5')
    expect(weakestPair({ ...emptyStats(), best: { 'changes:A5-E5': 61 } }, ['E5', 'A5'])).toBeNull()
    expect(weakestPair(emptyStats(), ['E'])).toBeNull()
  })
})

describe('skill XP: real gains only', () => {
  it('the first round is a baseline; gains pay, capped', () => {
    const s0 = emptyStats()
    expect(skillXp(s0, 'changes', 25, 'A-E')).toBe(0)
    const s1 = record(s0, 'changes', 25, 'A-E', 1).stats
    expect(skillXp(s1, 'changes', 28, 'A-E')).toBe(6)
    expect(skillXp(s1, 'changes', 45, 'A-E')).toBe(20)
    expect(skillXp(s1, 'changes', 20, 'A-E')).toBe(0)
    expect(skillXp(s0, 'find', 9)).toBe(0)
    const f = record(s0, 'find', 9, undefined, 1).stats
    expect(skillXp(f, 'find', 12)).toBe(3)
    expect(skillXp(f, 'find', 30)).toBe(10)
    const e = record(s0, 'ear', 3, undefined, 1).stats
    expect(skillXp(e, 'ear', 4)).toBe(10)
    expect(skillXp(e, 'ear', 3)).toBe(0)
    const c = record(s0, 'clock', 40, undefined, 1).stats
    expect(skillXp(c, 'clock', 30)).toBe(10)
    expect(skillXp(c, 'clock', 50)).toBe(0)
    for (const g of ['record', 'rate', 'fretTime', 'earFirst', 'drift'] as const) expect(skillXp(record(s0, g, 1, undefined, 1).stats, g, 5)).toBe(0)
  })

  it('retiring a pair pays 30 once', () => {
    const s = record(emptyStats(), 'changes', 55, 'A-D', 1).stats
    expect(skillXp(s, 'changes', 60, 'A-D')).toBe(10 + 30)
    const after = record(s, 'changes', 60, 'A-D', 2).stats
    expect(skillXp(after, 'changes', 62, 'A-D')).toBe(4)
  })
})

describe('unrated takes', () => {
  it('finds a take from before today, after the given time, with no rating', () => {
    const now = new Date(2026, 10, 5, 19)
    const yesterday = new Date(2026, 10, 4, 20).getTime()
    const today = new Date(2026, 10, 5, 18).getTime()
    expect(findUnrated([{ at: yesterday }], 0, now)).toBe(true)
    expect(findUnrated([{ at: yesterday, rating: 3 }], 0, now)).toBe(false)
    expect(findUnrated([{ at: today }], 0, now)).toBe(false)
    expect(findUnrated([{ at: yesterday }], yesterday + 1, now)).toBe(false)
    // before 4 am still belongs to the day before
    expect(findUnrated([{ at: new Date(2026, 10, 5, 2).getTime() }], 0, now)).toBe(true)
  })
})

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

describe('ear training licks from your songs', () => {
  const n = (string: number, fret: number, beat: number) => ({ string, fret, midi: STANDARD_TUNING[string] + fret, beat })

  it('runs of single notes close in time, in one hand position, not one note repeated', () => {
    const notes = [n(3, 5, 0), n(3, 7, 0.5), n(4, 5, 1), n(4, 8, 1.5), n(2, 7, 5), n(2, 5, 5.5)]
    const licks = licksFrom(notes, 3)
    expect(licks.map((l) => l.map((x) => x.fret))).toEqual([
      [5, 7, 5],
      [7, 5, 8],
    ]) // the pause after beat 1.5 ends the phrase
  })

  it('a drop-tuned part leaves its low string out; one note repeated is no lick', () => {
    expect(licksFrom([n(0, 3, 0), n(1, 5, 0.5), n(1, 7, 1)], 3, true)).toEqual([])
    expect(licksFrom([n(2, 5, 0), n(2, 5, 0.5), n(2, 5, 1)], 3)).toEqual([])
  })
})
