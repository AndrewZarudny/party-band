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

  it("today's set: the later day wins; same day, more done steps, keeping a given bonus", () => {
    const step = (state: string) => ({ kind: 'review', lessonId: 'w1-02', min: 2, state, why: '', from: { best: 0, stars: 0, speed: 1 } })
    const early = prog({ xp: 900, plan: { day: '2026-11-03', steps: [step('done'), step('done')], bonus: true } as Progress['plan'], planStreak: { days: 4, last: '2026-11-03' } })
    const late = prog({ xp: 1, plan: { day: '2026-11-04', steps: [step('todo')], bonus: false } as Progress['plan'], planStreak: { days: 1, last: '2026-11-04' } })
    for (const m of [merge(early, late), merge(late, early)]) {
      expect(m.plan!.day).toBe('2026-11-04')
      expect(m.planStreak).toEqual({ days: 1, last: '2026-11-04' })
    }
    const one = prog({ xp: 999, plan: { day: '2026-11-04', steps: [step('done'), step('todo')], bonus: true } as Progress['plan'] })
    const two = prog({ xp: 1, plan: { day: '2026-11-04', steps: [step('done'), step('done')], bonus: false } as Progress['plan'] })
    const m = merge(one, two)
    expect(m.plan!.steps.every((s) => s.state === 'done')).toBe(true)
    expect(m.plan!.bonus).toBe(true)
    expect(m.xp).toBe(999)
  })

  it('old copies without plan fields merge, and the result still loads as progress', () => {
    const old = { v: 1, xp: 10, lessons: { 'w1-02': lessonRec({ plays: 1 }) } }
    const m = merge(old, prog({ xp: 1 }))
    expect(m.plan).toBeNull()
    expect(m.planStreak).toEqual({ days: 0, last: '' })
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
