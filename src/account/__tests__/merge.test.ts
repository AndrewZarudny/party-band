import { describe, expect, it } from 'vitest'
import type { HeatCell, LessonRecord, Progress } from '../../lessons/types'
import { isMergeKey, mergeLessonsProgress, mergeValues } from '../merge'
import { HALF_LIFE_DAYS, MAX_CELLS, normalizeHeat } from '../../lessons/heat'
import { importProgress, newProgress } from '../../lessons/progress'
import { PRACTICE_KEY } from '../../practice/data'
import { SKILLS_KEY } from '../../skills/data'

const D = 20000 // a day number
const cell = (n: number, d: number, l = 'w1-02', o: Partial<HeatCell> = {}): HeatCell => ({ n, bad: 1, wrong: 0, early: 0, late: 0, err: 0, d, l, ...o })
const lessonRec = (o: Partial<LessonRecord>): LessonRecord => ({ best: 0, stars: 0, plays: 0, fails: 0, bestChain: 0, clean: false, playsDay: '', playsToday: 0, lastPlayed: 0, ...o })
const prog = (o: Partial<Progress> & Record<string, unknown>): Progress => ({ ...newProgress(), created: 1, ...o }) as Progress
const merge = (a: unknown, b: unknown) => JSON.parse(mergeLessonsProgress(JSON.stringify(a), JSON.stringify(b))!) as Progress & Record<string, unknown>
const sorted = (o: object) => JSON.stringify(o, Object.keys(o).sort())

describe('mergeLessonsProgress', () => {
  const A = prog({
    xp: 500,
    achievements: { a: 1 },
    totalSec: 100,
    lessons: { 'w1-02': lessonRec({ best: 90, plays: 5, lastPlayed: 10, loops: 2, loopTop: 0.8 }), 'w1-03': lessonRec({ plays: 1 }) },
    heat: { v: 1, cells: { 'n:1.1': cell(10, D - 2), 'n:2.2': cell(5, D), 'c:G': cell(8, D, 'w2-02'), 't:notes': cell(20, D - 1, 'w1-02', { err: -400 }) } },
  })
  const B = prog({
    xp: 300,
    achievements: { b: 2 },
    totalSec: 900,
    lessons: { 'w1-02': lessonRec({ best: 80, plays: 7, lastPlayed: 20, loops: 5, loopTop: 0.7 }), 'w3-01': lessonRec({ plays: 1, speed: 0.9 }) },
    heat: { v: 1, cells: { 'n:1.1': cell(4, D), 'n:2.2': cell(7, D), 'c:G': cell(8, D, 'w2-03'), 'n:3.3': cell(6, D - 5) } },
  })

  it('gives the same result in both orders', () => {
    const ab = merge(A, B)
    const ba = merge(B, A)
    expect(ab.lessons).toEqual(ba.lessons)
    expect(ab.xp).toBe(ba.xp)
    expect(ab.achievements).toEqual(ba.achievements)
    expect(sorted(ab.heat!.cells)).toBe(sorted(ba.heat!.cells))
  })

  it('takes the more played lesson record (loops follow it), the larger XP and time, all achievements', () => {
    const ab = merge(A, B)
    expect(ab.lessons['w1-02']).toMatchObject({ plays: 7, loops: 5, loopTop: 0.7 })
    expect(ab.lessons['w1-03'].plays).toBe(1)
    expect(ab.lessons['w3-01'].speed).toBe(0.9)
    expect(ab.xp).toBe(500)
    expect(ab.totalSec).toBe(900)
    expect(ab.achievements).toEqual({ a: 1, b: 2 })
  })

  it('heat: per cell the later day wins, then more events; never summed', () => {
    const hc = merge(A, B).heat!.cells
    expect(hc['n:1.1']).toMatchObject({ n: 4, d: D })
    expect(hc['n:2.2'].n).toBe(7)
    expect(hc['c:G'].n).toBe(8)
    expect(hc['n:3.3'].n).toBe(6)
    expect(hc['t:notes'].n).toBe(20)
  })

  it('is idempotent', () => {
    const aa = merge(A, A)
    expect(aa.heat).toEqual(A.heat)
    expect(aa.lessons).toEqual(A.lessons)
    expect(merge(merge(A, B), B).lessons).toEqual(merge(A, B).lessons)
  })

  it('caps merged heat at MAX_CELLS, keeping the heaviest cells faded to the newest day', () => {
    const big = (pre: string, dd: number) => {
      const cells: Record<string, HeatCell> = {}
      for (let i = 0; i < 120; i++) cells[`c:${pre}${i}`] = cell(1 + ((i * 7) % 13), D - dd)
      return cells
    }
    const X = prog({ xp: 1, heat: { v: 1, cells: big('X', 0) } })
    const Y = prog({ xp: 2, heat: { v: 1, cells: big('Y', 30) } })
    const xy = merge(X, Y).heat!.cells
    const yx = merge(Y, X).heat!.cells
    expect(Object.keys(xy)).toHaveLength(MAX_CELLS)
    expect(Object.keys(xy).sort()).toEqual(Object.keys(yx).sort())
    const all = { ...X.heat!.cells, ...Y.heat!.cells }
    const w = (c: HeatCell) => c.n * 0.5 ** ((D - c.d) / HALF_LIFE_DAYS)
    const minKept = Math.min(...Object.keys(xy).map((k) => w(all[k])))
    const maxDropped = Math.max(...Object.keys(all).filter((k) => !xy[k]).map((k) => w(all[k])))
    expect(maxDropped).toBeLessThanOrEqual(minKept)
    expect(Object.keys(normalizeHeat({ v: 1, cells: xy })!.cells)).toHaveLength(MAX_CELLS)
  })

  it('one side without heat keeps the other; none on either side stays none', () => {
    const noHeat = prog({ xp: 1000 })
    expect(merge(noHeat, A).heat).toEqual(A.heat)
    expect(merge(A, noHeat).heat).toEqual(A.heat)
    expect(merge(noHeat, noHeat).heat).toBeUndefined()
  })

  it("today's plan: v2 only; the later day wins; same day, more done steps; no bonus field", () => {
    const step = (state: string) => ({ kind: 'cold', lessonId: 'w1-02', min: 3, state, why: '', from: { best: 0, stars: 0, speed: 1 } })
    const v2 = (day: string, states: string[]) => ({ v: 2, day, min: 30, shape: 'A', steps: states.map(step) }) as unknown as Progress['plan']
    const early = prog({ xp: 900, plan: v2('2026-11-03', ['done', 'done']), planStreak: { days: 4, last: '2026-11-03' } })
    const late = prog({ xp: 1, plan: v2('2026-11-04', ['todo']) })
    for (const m of [merge(early, late), merge(late, early)]) {
      expect(m.plan!.day).toBe('2026-11-04')
      expect(m.planStreak).toBeUndefined()
    }
    const one = prog({ xp: 999, plan: { ...v2('2026-11-04', ['done', 'todo'])!, bonus: true } as unknown as Progress['plan'] })
    const two = prog({ xp: 1, plan: v2('2026-11-04', ['done', 'done']) })
    const m = merge(one, two)
    expect(m.plan!.steps.every((s) => s.state === 'done')).toBe(true)
    expect((m.plan as unknown as Record<string, unknown>).bonus).toBeUndefined()
    expect(m.xp).toBe(999)
    // An old day plan counts as none.
    const old = prog({ xp: 5, plan: { day: '2026-11-05', steps: [], bonus: false } as unknown as Progress['plan'] })
    expect(merge(old, late).plan!.day).toBe('2026-11-04')
  })

  it('session logs: one entry per day, max time, any set/counted/pocket, the worse pain; before = max', () => {
    const a = prog({ xp: 10, sessions: { log: [{ day: '2026-11-03', sec: 700, set: false, counted: true, pocket: false, pain: 'mild' }, { day: '2026-11-04', sec: 100, set: false, counted: false, pocket: true }], before: 3 } })
    const b = prog({ xp: 20, sessions: { log: [{ day: '2026-11-03', sec: 400, set: true, counted: true, pocket: false, min: 20, shape: 'B', pain: 'sharp' }, { day: '2026-11-02', sec: 900, set: false, counted: true, pocket: false }], before: 5 } })
    for (const m of [merge(a, b), merge(b, a)]) {
      expect(m.sessions.before).toBe(5)
      expect(m.sessions.log.map((d) => d.day)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
      expect(m.sessions.log[1]).toEqual({ day: '2026-11-03', sec: 700, set: true, counted: true, pocket: false, min: 20, shape: 'B', pain: 'sharp' })
      expect(m.sessions.log[2]).toMatchObject({ pocket: true, counted: false })
    }
  })

  it('lesson history is combined by session; the review with the later cold pass wins', () => {
    const cold = (clean: boolean) => ({ s: 2, d: '2026-11-03', bpm: 70, speed: 0.9, clean, score: 90, tab: 'faded' })
    const a = prog({
      xp: 10,
      lessons: { 'w1-02': lessonRec({ plays: 9, hist: [{ s: 1, d: '2026-11-01', best: 70 }, { s: 2, d: '2026-11-03', best: 72, cold: cold(false) }] as LessonRecord['hist'], review: { step: 1, due: 4, coldPasses: 0, lastColdS: 0, learned: false } }) },
    })
    const b = prog({
      xp: 20,
      lessons: { 'w1-02': lessonRec({ plays: 4, hist: [{ s: 2, d: '2026-11-03', best: 75, cold: cold(true) }, { s: 3, d: '2026-11-05', best: 76 }] as LessonRecord['hist'], review: { step: 2, due: 6, coldPasses: 1, lastColdS: 2, learned: false } }) },
    })
    for (const m of [merge(a, b), merge(b, a)]) {
      const r = m.lessons['w1-02']
      expect(r.plays).toBe(9)
      expect(r.hist).toEqual([
        { s: 1, d: '2026-11-01', best: 70 },
        { s: 2, d: '2026-11-03', best: 75, cold: cold(true) },
        { s: 3, d: '2026-11-05', best: 76 },
      ])
      expect(r.review).toMatchObject({ lastColdS: 2, coldPasses: 1 })
    }
  })

  it('a newer failed cold test on one copy is not undone by the other copy', () => {
    const c = (s: number, clean: boolean) => ({ s, d: `2026-11-0${s}`, cold: { s, d: `2026-11-0${s}`, bpm: 70, speed: 1, clean, score: clean ? 95 : 50, tab: 'hidden' } })
    const learned = { step: 2, due: 7, coldPasses: 2, lastColdS: 2, learned: true }
    const failed = { step: 1, due: 5, coldPasses: 0, lastColdS: 2, learned: false }
    const a = prog({ xp: 10, lessons: { 'w1-02': lessonRec({ plays: 3, hist: [c(1, true), c(2, true), c(4, false)] as LessonRecord['hist'], review: failed }) } })
    const b = prog({ xp: 20, lessons: { 'w1-02': lessonRec({ plays: 5, hist: [c(1, true), c(2, true)] as LessonRecord['hist'], review: learned }) } })
    for (const m of [merge(a, b), merge(b, a)]) expect(m.lessons['w1-02'].review).toEqual(failed)
  })

  it('week XP and run samples are combined; the weekly note stays dismissed', () => {
    const run = (at: number, id = 'w1-02') => ({ at, id, bpm: 70, swing: false, mean: null, spread: null, n: 10, tab: 'full', quiet: false, cold: false, clean: true, bend: null })
    const a = prog({ xp: 10, weekXp: ['2026-10-26', '2026-11-02'], runs: [run(1), run(3)] as Progress['runs'], seenWeekly: true })
    const b = prog({ xp: 20, weekXp: ['2026-10-19', '2026-11-02'], runs: [run(2), run(3), run(3, 'w1-03')] as Progress['runs'] })
    delete (b as Partial<Progress>).seenWeekly
    const m = merge(b, a)
    expect(m.weekXp).toEqual(['2026-10-19', '2026-10-26', '2026-11-02'])
    expect(m.runs.map((r) => `${r.at}${r.id}`)).toEqual(['1w1-02', '2w1-02', '3w1-02', '3w1-03'])
    expect(m.seenWeekly).toBe(true)
  })

  it('old copies without the new fields merge, and the result still loads as progress', () => {
    const old = { v: 1, xp: 10, lessons: { 'w1-02': lessonRec({ plays: 1 }) }, planStreak: { days: 3, last: '2026-11-01' }, streak: { days: 3, last: '2026-11-01', eggs: 0 } }
    const m = merge(old, prog({ xp: 1 }))
    expect(m.plan).toBeNull()
    expect(m.planStreak).toBeUndefined()
    expect(m.sessions).toEqual({ log: [], before: 0 })
    expect(importProgress(JSON.stringify(m))).not.toBeNull()
  })
  it('null when a side is unreadable', () => {
    expect(mergeLessonsProgress('{', '{}')).toBeNull()
    expect(mergeLessonsProgress('null', '{}')).toBeNull()
  })
})

describe('mergeValues (lists)', () => {
  const songs = (xs: [string, string, number][]) => JSON.stringify(xs.map(([title, artist, n]) => ({ title, artist, n })))

  it('band songs: the winner keeps its items, the other side adds what it lacks', () => {
    const w = songs([['Wonderwall', 'Oasis', 1]])
    const o = songs([['wonderwall', 'OASIS', 2], ['Zombie', 'The Cranberries', 3]])
    const m = JSON.parse(mergeValues('band-songs', w, o)!) as { n: number }[]
    expect(m.map((x) => x.n)).toEqual([1, 3])
  })

  it('id lists: the same set both ways, and merging again changes nothing', () => {
    const a = JSON.stringify([{ id: 'a', v: 1 }, { id: 'b', v: 1 }])
    const b = JSON.stringify([{ id: 'b', v: 2 }, { id: 'c', v: 2 }])
    for (const k of ['tone-presets', 'jam-pinned-phrases']) {
      const ab = JSON.parse(mergeValues(k, a, b)!) as { id: string }[]
      const ba = JSON.parse(mergeValues(k, b, a)!) as { id: string }[]
      expect(ab.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
      expect(ba.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
      const again = mergeValues(k, JSON.stringify(ab), b)
      expect(again).toBe(JSON.stringify(ab))
    }
  })

  it('song history: newest first, at most 300', () => {
    const mk = (from: number, n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `s${from + i}`, startedAt: from + i })))
    const m = JSON.parse(mergeValues('song-history', mk(0, 200), mk(150, 200))!) as { startedAt: number }[]
    expect(m).toHaveLength(300)
    expect(m[0].startedAt).toBe(349)
    for (let i = 1; i < m.length; i++) expect(m[i - 1].startedAt).toBeGreaterThan(m[i].startedAt)
  })

  it('favourites are combined only on the first sign-in', () => {
    expect(mergeValues('song-favorites', '["a"]', '["b"]')).toBeNull()
    expect(JSON.parse(mergeValues('song-favorites', '["a","b"]', '["b","c",3]', true)!)).toEqual(['a', 'b', 'c'])
  })

  it('a missing side counts as empty; unreadable or non-list keys give null', () => {
    expect(JSON.parse(mergeValues('tone-presets', null, '[{"id":"x"}]')!)).toEqual([{ id: 'x' }])
    expect(mergeValues('tone-presets', '{bad', '[]')).toBeNull()
    expect(mergeValues('tone-presets', '{}', '[]')).toBeNull()
    expect(mergeValues('lessons-prefs', '[]', '[]')).toBeNull()
  })

  it('practice and skills keys use their own merges', () => {
    expect(isMergeKey(PRACTICE_KEY)).toBe(true)
    expect(isMergeKey(SKILLS_KEY)).toBe(true)
    expect(isMergeKey('band-songs')).toBe(true)
    expect(isMergeKey('lessons-progress')).toBe(false)
    expect(JSON.parse(mergeValues(PRACTICE_KEY, null, null)!)).toEqual({ v: 1, devices: {} })
    expect(JSON.parse(mergeValues(SKILLS_KEY, null, null)!).v).toBe(1)
  })
})
