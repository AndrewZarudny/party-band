import { describe, expect, it } from 'vitest'
import type { HistEntry, LessonRecord, Progress, ReviewState, RunSample, SessionDay } from '../types'
import type { SkillEntry, SkillStats } from '../../skills/data'
import { emptyStats } from '../../skills/data'
import {
  addDays,
  bendSeries,
  changesByPair,
  coldPassRate,
  coldSeries,
  driftSeries,
  earFirstSeries,
  fretTimes,
  gapList,
  jamQuality,
  minutesVsPlan,
  painFlags,
  timingTrend,
  weeksVsGoal,
} from '../metrics'
import { PLAN_WEEKS, planRow, planWeek } from '../weeks'
import { at, rec } from './fixtures'

function prog(over: Partial<Progress> = {}): Progress {
  return {
    v: 1,
    xp: 0,
    lessons: {},
    dinoName: 'Rex',
    achievements: {},
    cosmetics: [],
    stats: { bendsInTune: 0 },
    recentFacts: [],
    totalSec: 0,
    plan: null,
    created: 0,
    sessionMin: 30,
    weekGoal: 3,
    sessions: { log: [], before: 0 },
    weekXp: [],
    runs: [],
    ...over,
  }
}

const review = (over: Partial<ReviewState> = {}): ReviewState => ({ step: 1, due: 5, coldPasses: 0, lastColdS: 0, learned: false, ...over })
const cold = (s: number, bpm: number, clean: boolean): HistEntry['cold'] => ({ s, d: '', bpm, speed: 1, clean, score: 80, tab: 'faded' })
const withHist = (hist: HistEntry[], over: Partial<LessonRecord> = {}) => rec({ passedAt: 1, review: review(), hist, ...over })

const run = (over: Partial<RunSample> = {}): RunSample => ({
  at: 1,
  id: 'w1-02',
  bpm: 60,
  swing: false,
  mean: 10,
  spread: 20,
  n: 10,
  tab: 'full',
  quiet: false,
  cold: false,
  clean: true,
  bend: null,
  ...over,
})

let eid = 0
const ent = (game: SkillEntry['game'], score: number, detail?: string, atMs = ++eid): SkillEntry => ({ id: `e${++eid}`, game, at: atMs, score, ...(detail ? { detail } : {}) })
const skills = (history: SkillEntry[], best: Record<string, number> = {}): SkillStats => ({ ...emptyStats(), history, best })
const day = (d: string, over: Partial<SessionDay> = {}): SessionDay => ({ day: d, sec: 1200, set: true, counted: true, pocket: false, ...over })

describe('cold-start series', () => {
  it('lists review items in map order with their cold attempts by session', () => {
    const p = prog({
      lessons: {
        'w3-01': withHist([{ s: 2, d: '', best: 70 }, { s: 3, d: '', cold: cold(3, 62, false) }, { s: 5, d: '', cold: cold(5, 66, true) }], { review: review({ due: 9, learned: true }) }),
        'w1-02': withHist([{ s: 1, d: '', cold: cold(1, 55, true) }]),
        'w2-01': rec({ passedAt: 1 }), // no review: left out
      },
    })
    const c = coldSeries(p)
    expect(c.map((x) => x.id)).toEqual(['w1-02', 'w3-01'])
    expect(c[1].points).toEqual([
      { s: 3, bpm: 62, clean: false },
      { s: 5, bpm: 66, clean: true },
    ])
    expect(c[1]).toMatchObject({ learned: true, due: 9 })
    expect(c[1].target).toBeGreaterThan(0)
    expect(coldPassRate(p)).toEqual({ clean: 2, total: 3 })
  })
})

describe('retention gap list', () => {
  it('gives the gap and its trend', () => {
    const hist: HistEntry[] = [
      { s: 1, d: '', best: 80 },
      { s: 2, d: '', cold: cold(2, 68, true), best: 82 },
      { s: 3, d: '', cold: cold(3, 76, true) },
    ]
    const g = gapList(prog({ lessons: { 'w1-02': withHist(hist) } }))
    expect(g).toEqual([{ id: 'w1-02', title: expect.any(String), best: 82, cold: 76, gap: 6, prevGap: 12, trend: 'shrinking' }])
  })

  it('a single gap has no trend; no clean cold, no row', () => {
    const one = gapList(prog({ lessons: { 'w1-02': withHist([{ s: 1, d: '', best: 70 }, { s: 2, d: '', cold: cold(2, 66, true) }]) } }))
    expect(one[0]).toMatchObject({ gap: 4, prevGap: null, trend: null })
    expect(gapList(prog({ lessons: { 'w1-02': withHist([{ s: 1, d: '', best: 70 }, { s: 2, d: '', cold: cold(2, 60, false) }]) } }))).toEqual([])
  })
})

describe('timing trend', () => {
  it('splits swing from straight and needs 8 graded hits', () => {
    const p = prog({ runs: [run({ at: 3, swing: true, mean: -5 }), run({ at: 1 }), run({ at: 2, n: 7 }), run({ at: 4, mean: null })] })
    expect(timingTrend(p, false)).toEqual([{ at: 1, mean: 10, spread: 20 }])
    expect(timingTrend(p, true)).toEqual([{ at: 3, mean: -5, spread: 20 }])
  })
})

describe('skill metrics', () => {
  it('drift by silent bars, target only after 4', () => {
    const s = skills([ent('drift', 30, '4', 2), ent('drift', 20, '4', 3), ent('drift', 40, '1', 1), ent('clock', 50)])
    const d = driftSeries(s)
    expect(d.map((r) => r.gap)).toEqual([1, 4])
    expect(d[0]).toMatchObject({ last: 40, met: null })
    expect(d[1]).toMatchObject({ last: 20, met: true })
    expect(driftSeries(skills([ent('drift', 25, '4')]))[0].met).toBe(false)
  })

  it('changes per pair: core pairs first, last 8, retired at 60', () => {
    const hist = [...Array.from({ length: 10 }, (_, i) => ent('changes', 30 + i, 'C-G', i + 1)), ent('changes', 61, 'A-E', 20), ent('changes', 25, 'A-D', 21)]
    const rows = changesByPair(skills(hist, { 'changes:C-G': 39, 'changes:A-E': 61, 'changes:A-D': 25 }))
    expect(rows.map((r) => r.pair)).toEqual(['A-D', 'A-E', 'C-G'])
    expect(rows[2].last).toEqual([32, 33, 34, 35, 36, 37, 38, 39])
    expect(rows[1]).toMatchObject({ best: 61, retired: true, core: true })
    expect(rows[0].retired).toBe(false)
  })

  it('fret times: median of the last 5 per string, in seconds, target on low E and A', () => {
    const hist = [ent('fretTime', 9000, '0', 1), ...[2000, 2400, 2600, 5000, 2200].map((ms, i) => ent('fretTime', ms, '0', i + 2)), ent('fretTime', 3500, '1', 10), ent('fretTime', 4000, '3', 11)]
    const f = fretTimes(skills(hist))
    expect(f[0]).toMatchObject({ label: 'Low E', sec: 2.4, rounds: 5, met: true })
    expect(f[1]).toMatchObject({ sec: 3.5, met: false })
    expect(f[3]).toMatchObject({ sec: 4, target: false, met: null })
    expect(f[5]).toMatchObject({ sec: null, rounds: 0 })
  })

  it('ear first-try series, oldest first', () => {
    expect(earFirstSeries(skills([ent('earFirst', 75, undefined, 5), ent('ear', 4), ent('earFirst', 50, undefined, 2)]))).toEqual([
      { at: 2, score: 50 },
      { at: 5, score: 75 },
    ])
  })
})

describe('jams, bends, health', () => {
  it('jam quality from jam runs and take ratings', () => {
    const p = prog({
      runs: [
        run({ at: 2, jam: { strong: 0.6, restBeats: 1.5, phrases: 4, silentBars: 0 } }),
        run({ at: 1, jam: { strong: null, restBeats: 2, phrases: 2, silentBars: 1 } }),
        run({ at: 3 }),
      ],
    })
    const j = jamQuality(p, skills([ent('rate', 4, 'take1', 7)]))
    expect(j.strong).toEqual([{ at: 2, share: 0.6 }])
    expect(j.rest).toEqual([
      { at: 1, beats: 2 },
      { at: 2, beats: 1.5 },
    ])
    expect(j.ratings).toEqual([{ at: 7, score: 4 }])
  })

  it('bends: only runs with a graded bend', () => {
    expect(bendSeries(prog({ runs: [run({ at: 2, bend: 25 }), run({ at: 1 })] }))).toEqual([{ at: 2, cents: 25, id: 'w1-02' }])
  })

  it('weeks vs goal: 12 weeks, this week last, pocket days apart', () => {
    // 2026-11-05 is a Thursday; its week starts Monday 2026-11-02.
    const log = [day('2026-11-02'), day('2026-11-03'), day('2026-11-04', { counted: false, set: false, sec: 200, pocket: true }), day('2026-10-27'), day('2026-10-28'), day('2026-10-29')]
    const w = weeksVsGoal(prog({ sessions: { log, before: 0 } }), at('2026-11-05'))
    expect(w.weeks).toHaveLength(12)
    expect(w.weeks[11]).toEqual({ week: '2026-11-02', count: 2, pocket: 1, met: false })
    expect(w.weeks[10]).toEqual({ week: '2026-10-26', count: 3, pocket: 0, met: true })
    expect(w.weeks[0].week).toBe(addDays('2026-11-02', -77))
    expect(w).toMatchObject({ goal: 3, done: 2, streak: 1 })
  })

  it('pain flags in the last 12 weeks; minutes vs plan per counted day', () => {
    const log = [day('2026-06-01', { pain: 'sharp' }), day('2026-10-20', { pain: 'mild', min: 30, sec: 1500 }), day('2026-11-01', { pain: 'none' }), day('2026-11-02', { counted: false, sec: 100 })]
    const p = prog({ sessions: { log, before: 0 } })
    expect(painFlags(p, at('2026-11-05'))).toEqual([{ day: '2026-10-20', pain: 'mild' }])
    expect(minutesVsPlan(p)).toEqual([
      { day: '2026-06-01', min: 20, plan: null },
      { day: '2026-10-20', min: 25, plan: 30 },
      { day: '2026-11-01', min: 20, plan: null },
    ])
  })
})

describe('12-week plan', () => {
  it('six rows covering weeks 1–12', () => {
    expect(PLAN_WEEKS.map((w) => [w.from, w.to])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
      [11, 12],
    ])
    expect(planRow(4)?.from).toBe(3)
    expect(planRow(13)).toBeNull()
  })

  it('planWeek counts from the first counted session', () => {
    expect(planWeek(prog(), at('2026-11-05'))).toBe(1)
    const log = [day('2026-10-01', { counted: false }), day('2026-10-08'), day('2026-10-20')]
    expect(planWeek(prog({ sessions: { log, before: 0 } }), at('2026-10-14'))).toBe(1)
    expect(planWeek(prog({ sessions: { log, before: 0 } }), at('2026-10-15'))).toBe(2)
    expect(planWeek(prog({ sessions: { log, before: 0 } }), at('2026-11-05'))).toBe(5)
  })

  it('weeks 1–2: boogie shuffle at 60 cold', () => {
    const check = PLAN_WEEKS[0].check
    const s = emptyStats()
    expect(check(prog(), s)).toBe('open')
    expect(check(prog({ lessons: { 'w3-07': withHist([{ s: 1, d: '', best: 60 }]) } }), s)).toBe('partial')
    expect(check(prog({ lessons: { 'w3-07': rec({ passedAt: 1 }) } }), s)).toBe('partial')
    expect(check(prog({ lessons: { 'w3-07': withHist([{ s: 2, d: '', cold: cold(2, 60, true) }]) } }), s)).toBe('met')
    expect(check(prog({ lessons: { 'w3-07': withHist([{ s: 2, d: '', cold: cold(2, 58, true) }], { passedAt: undefined }) } }), s)).toBe('open')
  })

  it('weeks 3–4: a changes baseline on all core pairs and the seventh shuffle at 70', () => {
    const check = PLAN_WEEKS[1].check
    const core = skills([], { 'changes:A-D': 10, 'changes:A-E': 12, 'changes:D-E': 8 })
    const shuffle = prog({ lessons: { 'w3-10': withHist([{ s: 2, d: '', cold: cold(2, 70, true) }]) } })
    expect(check(prog(), core)).toBe('partial')
    expect(check(shuffle, emptyStats())).toBe('partial')
    expect(check(shuffle, core)).toBe('met')
    expect(check(prog(), skills([], { 'changes:A-D': 10 }))).toBe('open')
  })

  it('weeks 5–6: box in 8ths at 70 cold and the licks passed', () => {
    const check = PLAN_WEEKS[2].check
    const both = prog({ lessons: { 'w5-11': withHist([{ s: 3, d: '', cold: cold(3, 70, true) }]), 'w5-07': rec({ passedAt: 1 }) } })
    expect(check(both, emptyStats())).toBe('met')
    expect(check(prog({ lessons: { 'w5-07': rec({ passedAt: 1 }) } }), emptyStats())).toBe('partial')
  })

  it('weeks 7–8: bends within 30 cents (median of the last 10) and ear at 60%', () => {
    const check = PLAN_WEEKS[3].check
    const bends = prog({ runs: [run({ at: 1, bend: 90 }), ...[20, 25, 35, 28, 30].map((b, i) => run({ at: i + 2, bend: b }))] })
    expect(check(bends, emptyStats())).toBe('partial')
    expect(check(bends, skills([], { earFirst: 62 }))).toBe('met')
    expect(check(prog(), skills([], { earFirst: 50 }))).toBe('open')
  })

  it('weeks 9–10: changes in the 40s on core pairs', () => {
    const check = PLAN_WEEKS[4].check
    expect(check(prog(), skills([], { 'changes:A-D': 41, 'changes:A-E': 45, 'changes:D-E': 40 }))).toBe('met')
    expect(check(prog(), skills([], { 'changes:A-D': 41, 'changes:A-E': 30 }))).toBe('partial')
    expect(check(prog(), skills([], { 'changes:G-C': 50 }))).toBe('open')
  })

  it('weeks 11–12: three choruses at 70–80 with no silent bar, and a 2-minute take', () => {
    const check = PLAN_WEEKS[5].check
    const jam = (bpm: number, silentBars: number) => prog({ runs: [run({ id: 'w8-12', bpm, jam: { strong: 0.5, restBeats: 1, phrases: 8, silentBars } })] })
    const take = skills([ent('record', 130)])
    expect(check(jam(75, 0), take)).toBe('met')
    expect(check(jam(75, 0), emptyStats())).toBe('partial')
    expect(check(jam(75, 1), take)).toBe('open')
    expect(check(jam(85, 0), take)).toBe('open')
  })
})
