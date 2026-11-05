import { beforeEach, describe, expect, it } from 'vitest'
import type { Progress, SessionDay } from '../types'
import { applyResult, dayKey, dinoStageFor, eggCracked, importProgress, isUnlocked, levelFor, loadProgress, newProgress, nextLesson, recordSkip, saveProgress, stageOpen, starsInStage } from '../progress'
import { GROWTH, LESSONS, STAGES, lessonById } from '../data'
import { legacyOpen, legacyStage } from '../legacyMap'
import { newList } from '../session'
import { bpmAt, tempoStep } from '../speed'
import { at, oldMapSave, rec, result } from './fixtures'

const by = (id: string) => lessonById(id)!
const DAY = at('2026-11-04')
const ctx = { age: null, cold: false }
const started = () => recordSkip(newProgress(), 'w1-01', DAY)
const labels = (o: { lines: { label: string }[] }) => o.lines.map((l) => l.label)
const counted = (day: string): SessionDay => ({ day, sec: 900, set: true, counted: true, pocket: false })

describe('applyResult: XP only for real gains', () => {
  it('a first pass gives first-pass and star XP, nothing for playing', () => {
    const l = by('w1-02')
    const o = applyResult(started(), l, result({ score: 92, stars: 2, passed: true, speed: 1 }), DAY, ctx)
    const xp = Math.round(0.5 * l.xp) + 2 * Math.round(0.25 * l.xp)
    expect(labels(o)).toEqual(['First pass', 'New stars', 'Total'])
    expect(o.xp).toBe(xp)
    expect(o.progress.xp).toBe(xp)
    expect(o.lines[o.lines.length - 1]).toEqual({ label: 'Total', value: `+${xp}` })
    expect(o.competence).toContain(`First pass: ${l.title}.`)
  })

  it('a failed run gives 0 XP and counts a fail', () => {
    const o = applyResult(started(), by('w1-02'), result({ score: 10, stars: 0, passed: false, playedSec: 5 }), DAY, ctx)
    expect(o.xp).toBe(0)
    expect(o.lines).toEqual([{ label: 'Total', value: '+0' }])
    const r = o.progress.lessons['w1-02']
    expect(r).toMatchObject({ plays: 1, fails: 1, best: 10, stars: 0 })
    expect(r.passedAt).toBeUndefined()
  })

  it('replays with the same stars give no XP; a first clean run gives 30 once', () => {
    let p = applyResult(started(), by('w1-02'), result({ score: 92, stars: 2, passed: true }), DAY, ctx).progress
    const again = applyResult(p, by('w1-02'), result({ score: 92, stars: 2, passed: true }), DAY, ctx)
    expect(again.xp).toBe(0)
    p = again.progress
    const clean = applyResult(p, by('w1-02'), result({ score: 99, stars: 2, passed: true, clean: true }), DAY, ctx)
    expect(labels(clean)).toEqual(['First clean run', 'Total'])
    expect(clean.xp).toBe(30)
    expect(applyResult(clean.progress, by('w1-02'), result({ score: 99, stars: 2, passed: true, clean: true }), DAY, ctx).xp).toBe(0)
  })

  it('an earned tempo (clean first run plus two more) gives 10 XP and a competence line', () => {
    const l = by('w1-02')
    let p = applyResult(started(), l, result({ score: 92, stars: 2, passed: true, speed: 0.85, cleanShare: 1 }), DAY, ctx).progress
    p = applyResult(p, l, result({ score: 92, stars: 2, passed: true, speed: 0.85, cleanShare: 1 }), DAY, ctx).progress
    const o = applyResult(p, l, result({ score: 92, stars: 2, passed: true, speed: 0.85, cleanShare: 1 }), DAY, ctx)
    expect(labels(o)).toEqual(['Tempo earned', 'Total'])
    expect(o.xp).toBe(10)
    expect(o.speed).toMatchObject({ played: 0.85, earned: true, topAfter: 0.85, trial: null, clean: true })
    expect(o.competence[0]).toBe(`${l.title}: ${bpmAt(l, 0.85)} BPM earned. Next: ${bpmAt(l, 0.85 + tempoStep(l))} BPM.`)
    expect(o.progress.lessons['w1-02'].topSpeed).toBe(0.85)
    expect(o.progress.lessons['w1-02'].trial).toBeUndefined()
  })

  it('the sync lesson gets no speed step', () => {
    const s = applyResult(newProgress(), by('w1-01'), result({ lessonId: 'w1-01', score: 90, passed: true }), DAY, ctx)
    expect(s.speed).toBeNull()
    expect(s.progress.lessons['w1-01'].speed).toBeUndefined()
    expect(s.progress.runs).toHaveLength(0)
  })

  it('keeps the best score and stars, and unlocks the next lesson', () => {
    const p = started()
    expect(isUnlocked(p, 'w4-01')).toBe(false)
    const o = applyResult(p, by('w1-05'), result({ lessonId: 'w1-05', score: 85, stars: 2, passed: true }), DAY, ctx)
    expect(o.unlocked).toEqual(['w4-01'])
    expect(o.stageOpened).toBeNull()
    const o2 = applyResult(o.progress, by('w1-05'), result({ lessonId: 'w1-05', score: 70, stars: 1, passed: true }), DAY, ctx)
    expect(o2.progress.lessons['w1-05']).toMatchObject({ best: 85, stars: 2, plays: 2 })
    expect(o2.unlocked).toEqual([])
  })

  it('a run sample per non-sync run, with the session number of the first play', () => {
    const o = applyResult(started(), by('w1-02'), result({ score: 85, stars: 2, passed: true, bpm: 70, swing: true, tab: 'faded', meanErrMs: 12, spreadMs: 20, at: 5 }), DAY, ctx)
    expect(o.progress.runs).toEqual([expect.objectContaining({ at: 5, id: 'w1-02', bpm: 70, swing: true, tab: 'faded', cold: false, mean: 12, spread: 20, bend: null })])
    expect(o.progress.lessons['w1-02'].firstS).toBe(1)
  })

  it('shuffle mode: practice only, the straight record is unchanged', () => {
    const p = applyResult(started(), by('w1-02'), result({ score: 70, stars: 1, passed: true }), DAY, ctx).progress
    const o = applyResult(p, by('w1-02'), result({ score: 95, stars: 3, passed: true, shuffle: true, swing: true }), DAY, ctx)
    expect(o.xp).toBe(0)
    expect(o.progress.lessons['w1-02']).toMatchObject({ best: 70, stars: 1, shuffleBest: 95, plays: 2 })
    expect(o.competence).toEqual(['Shuffle mode: 95%. Practice only; your straight record is unchanged.'])
    expect(o.speed).toBeNull()
  })

  it('never changes the progress it was given, and picks fun lines once', () => {
    const p = started()
    const before = JSON.stringify(p)
    const o = applyResult(p, by('w1-02'), result({ score: 92, passed: true, at: 123 }), DAY, ctx)
    expect(JSON.stringify(p)).toBe(before)
    expect(o.factLines.length).toBeGreaterThan(0)
    const ids = o.factLines.flatMap((l) => (l.factId ? [l.factId] : []))
    expect(o.progress.recentFacts).toEqual(ids)
  })
})

describe('applyResult: reviews and cold starts', () => {
  it('a first pass of a review item starts its review, due next session', () => {
    const o = applyResult(started(), by('w1-02'), result({ score: 92, stars: 2, passed: true }), DAY, ctx)
    expect(o.progress.lessons['w1-02'].review).toEqual({ step: 0, due: 2, coldPasses: 0, lastColdS: 0, learned: false })
    expect(o.review).toEqual(o.progress.lessons['w1-02'].review)
  })

  it('a clean cold start moves the review and pays XP', () => {
    const l = by('w1-02')
    let p: Progress = applyResult(started(), l, result({ score: 92, stars: 2, passed: true, speed: 1, bpm: l.bpm, cleanShare: 1 }), at('2026-11-03'), ctx).progress
    p = { ...p, sessions: { log: [counted('2026-11-03')], before: 0 } }
    const o = applyResult(p, l, result({ score: 95, stars: 2, passed: true, speed: 1, bpm: l.bpm, cleanShare: 1, tab: 'faded' }), DAY, { age: null, cold: true })
    expect(o.cold).toMatchObject({ s: 2, d: '2026-11-04', bpm: l.bpm, clean: true, tab: 'faded' })
    expect(o.review).toMatchObject({ step: 1, due: 4, coldPasses: 1, lastColdS: 2, learned: false })
    expect(labels(o)).toContain('Cold start passed')
    expect(o.progress.runs[o.progress.runs.length - 1]).toMatchObject({ cold: true, clean: true })
    expect(o.newAchievements).toContain('cold-start')
  })
})

describe('levels and unlocks', () => {
  it('levels need more XP each time', () => {
    expect(levelFor(0)).toEqual({ level: 1, into: 0, need: 100 })
    expect(levelFor(100)).toEqual({ level: 2, into: 0, need: 146 })
    expect(levelFor(245).level).toBe(2)
    expect(levelFor(246).level).toBe(3)
  })

  it('the practice day starts at 4 am', () => {
    expect(dayKey(new Date('2026-11-05T03:59:00'))).toBe('2026-11-04')
    expect(dayKey(new Date('2026-11-05T04:00:00'))).toBe('2026-11-05')
  })

  it('nextLesson: Tap In first, then the plan in order; a skipped Tap In never blocks', () => {
    let p = newProgress()
    expect(nextLesson(p)).toBe('w1-01')
    expect(isUnlocked(p, 'w1-05')).toBe(false)
    p = recordSkip(p, 'w1-01', DAY)
    expect(nextLesson(p)).toBe('w1-05')
    p = applyResult(p, by('w1-05'), result({ lessonId: 'w1-05', score: 92, passed: true }), DAY, ctx).progress
    expect(nextLesson(p)).toBe('w4-01')
    // An extra passed on the side never moves Continue.
    p = applyResult(p, by('w1-02'), result({ score: 92, passed: true }), DAY, ctx).progress
    expect(nextLesson(p)).toBe('w4-01')
  })

  it('a stage opens when the previous checkpoint is passed; extras open with it', () => {
    const p = newProgress()
    expect(stageOpen(p, 1)).toBe(true)
    expect(stageOpen(p, 2)).toBe(false)
    expect(stageOpen(p, 7)).toBe(false)
    for (const id of STAGES[0].extra) expect(isUnlocked(p, id), id).toBe(true)
    expect(isUnlocked(p, 'w3-01')).toBe(false)
    p.lessons['w3-07'] = rec({ passedAt: 1, stars: 1 })
    expect(stageOpen(p, 2)).toBe(true)
    expect(stageOpen(p, 7)).toBe(true)
    expect(isUnlocked(p, 'w3-09')).toBe(true)
    expect(isUnlocked(p, 'w3-01')).toBe(true)
    expect(isUnlocked(p, 'w2-06')).toBe(false)
    expect(isUnlocked(p, 'w2-03')).toBe(false)
    expect(stageOpen(p, 3)).toBe(false)
  })

  it('passing a checkpoint reports the stage it opened', () => {
    let p = recordSkip(newProgress(), 'w1-01', DAY)
    for (const id of ['w1-05', 'w4-01', 'w3-06']) p = applyResult(p, by(id), result({ lessonId: id, score: 90, passed: true }), DAY, ctx).progress
    const o = applyResult(p, by('w3-07'), result({ lessonId: 'w3-07', score: 90, passed: true }), DAY, ctx)
    expect(o.stageOpened).toBe(2)
    expect(o.unlocked).toEqual(expect.arrayContaining(['w3-09', 'w3-01', 'w2-02', 'w2-04', 'w3-03']))
    expect(o.stageAfter).toBe(o.stageBefore + 1)
  })

  it('free jams open with stage 5, never block, and are left out of stage stars and Continue', () => {
    const s5 = STAGES[4]
    const free = s5.core.filter((id) => lessonById(id)?.free)
    expect(free).toEqual(['w8-06', 'w8-07', 'w8-10'])
    const p = newProgress()
    for (const id of free) expect(isUnlocked(p, id)).toBe(false)
    p.lessons['w6-05'] = rec({ passedAt: 1, stars: 1 })
    for (const id of free) expect(isUnlocked(p, id)).toBe(true)
    expect(starsInStage(p, 5).max).toBe(3 * (s5.core.length - free.length))
    // The checkpoint follows the box 2 lesson, skipping the free jams.
    p.lessons['w5-08'] = rec({ passedAt: 1, stars: 1 })
    expect(isUnlocked(p, 'w8-03')).toBe(false)
    p.lessons['w5-09'] = rec({ passedAt: 1, stars: 1 })
    expect(isUnlocked(p, 'w8-03')).toBe(true)
    for (const id of free) expect(nextLesson(p)).not.toBe(id)
  })

  it('a played lesson never locks', () => {
    const p = newProgress()
    expect(isUnlocked(p, 'w6-03')).toBe(false)
    p.lessons['w6-03'] = rec({ plays: 1 })
    expect(isUnlocked(p, 'w6-03')).toBe(true)
  })
})

describe('the map follows the plan: migration from the old world map', () => {
  const migrated = () => importProgress(JSON.stringify(oldMapSave()))!

  it('the old save: kept lessons stay open, the dino keeps its stage, Continue is Power Pair', () => {
    const raw = oldMapSave()
    const p = migrated()
    expect(p.mapV).toBe(2)
    expect(p.keepOpen).toEqual(['w1-01', 'w1-02', 'w1-03', 'w1-05', 'w1-04', 'w2-01', 'w2-02', 'w2-03', 'w2-05', 'w2-06', 'w2-04', 'w3-06', 'w3-07'])
    expect(p.dinoBonus).toBe(1)
    expect(dinoStageFor(p)).toBe(1)
    expect(nextLesson(p)).toBe('w4-01')
    for (const id of ['w2-03', 'w2-06', 'w2-04', 'w3-02', 'w8-01', 'w3-07']) expect(isUnlocked(p, id), id).toBe(true)
    for (const id of ['w3-09', 'w3-10', 'w3-01', 'w3-03']) expect(isUnlocked(p, id), id).toBe(false)
    // Records are untouched.
    expect(JSON.stringify(p.lessons)).toBe(JSON.stringify(importProgress(JSON.stringify({ ...raw, mapV: 2 }))!.lessons))
  })

  it('migrating twice changes nothing', () => {
    const p = migrated()
    expect(importProgress(JSON.stringify(p))).toEqual(p)
    expect(importProgress(JSON.stringify({ ...p, mapV: undefined }))).toEqual(p)
  })

  it("an untouched plan the old map picked is dropped, so today's plan is remade; a started one is kept", () => {
    const step = (kind: string, lessonId: string, state: string) => ({ kind, lessonId, min: 8, state, why: '', from: { best: 0, stars: 0, speed: 1, loops: 0 } })
    const oldPlan = (state: string) => ({ v: 2, day: '2026-11-04', min: 30, shape: 'A', steps: [step('new', 'w1-05', state), step('jam', 'w2-05', 'todo')] })
    expect(importProgress(JSON.stringify({ ...oldMapSave(), plan: oldPlan('todo') }))!.plan).toBeNull()
    const kept = importProgress(JSON.stringify({ ...oldMapSave(), plan: oldPlan('done') }))!
    expect(kept.plan?.steps.map((s) => [s.lessonId, s.state])).toEqual([['w1-05', 'done'], ['w2-05', 'todo']])
    // A save already on the new map keeps its plan as it is.
    expect(importProgress(JSON.stringify({ ...oldMapSave(), mapV: 2, plan: oldPlan('todo') }))!.plan?.steps).toHaveLength(2)
  })

  it('the dino grows on the next checkpoint, and never drops below the old stage', () => {
    const p = migrated()
    p.lessons['w3-07'] = rec({ passedAt: 2, stars: 1 })
    expect(dinoStageFor(p)).toBe(2)
    const all = newProgress()
    for (const id of GROWTH) all.lessons[id] = rec({ passedAt: 1, stars: 1 })
    expect(dinoStageFor(all)).toBe(8)
    expect(eggCracked(newProgress())).toBe(false)
  })

  it('nothing the old map had open locks, and the dino never shrinks', () => {
    const fixtures: Record<string, unknown>[] = [oldMapSave()]
    // A player deep into the old map: worlds 1 to 4 cleared, some of world 5.
    const deep = oldMapSave()
    const lessons = deep.lessons as Record<string, unknown>
    for (const id of ['w2-03', 'w2-06', 'w2-07', 'w2-04', 'w3-01', 'w3-02', 'w3-07', 'w3-03', 'w3-05', 'w3-09', 'w3-10', 'w3-04', 'w4-01', 'w4-02', 'w4-03', 'w4-05', 'w4-06', 'w4-04', 'w5-01', 'w5-11']) {
      lessons[id] = rec({ best: 80, stars: 2, plays: 2, passedAt: 1000 })
    }
    fixtures.push(deep)
    // Stars instead of a boss: 70% of world 1 opens world 2 under the old rules.
    fixtures.push({ v: 1, xp: 0, lessons: { 'w1-01': rec({ plays: 1 }), 'w1-02': rec({ stars: 3, passedAt: 1 }), 'w1-03': rec({ stars: 3, passedAt: 1 }), 'w1-05': rec({ stars: 3, passedAt: 1 }), 'w1-04': rec({ stars: 2, plays: 3 }) } })
    for (const raw of fixtures) {
      const before = importProgress(JSON.stringify({ ...raw, mapV: 2 }))!
      const p = importProgress(JSON.stringify(raw))!
      for (const id of legacyOpen(before)) expect(isUnlocked(p, id), id).toBe(true)
      expect(dinoStageFor(p)).toBeGreaterThanOrEqual(legacyStage(before))
      const n = nextLesson(p)
      const nl = newList(p)
      if (n && !nl.polish && lessonById(n)?.type !== 'sync') expect(nl.ids[0]).toBe(n)
    }
    expect(LESSONS.length).toBe(58)
  })
})

describe('saved progress', () => {
  beforeEach(() => localStorage.clear())

  it('fills fields an old save lacks', () => {
    const old = { v: 1, xp: 50, lessons: { 'w1-02': { best: 80, stars: 2, plays: 3 } } }
    const p = importProgress(JSON.stringify(old))!
    expect(p.xp).toBe(50)
    expect(p.plan).toBeNull()
    expect(p.heat).toBeUndefined()
    expect(p.recentFacts).toEqual([])
    expect(p.dinoName).toBe('Pebble')
    expect(p).toMatchObject({ sessionMin: 30, weekGoal: 3, sessions: { log: [], before: 0 }, weekXp: [], runs: [] })
    // Played before session numbers: firstS 0, so it never counts as new this week.
    expect(p.lessons['w1-02']).toEqual(rec({ best: 80, stars: 2, plays: 3, firstS: 0 }))
  })

  it('migrates a day-streak save: old fields gone, day boxes become session reviews, the weekly note shows', () => {
    const NOW = at('2026-11-10')
    const old = {
      v: 1,
      xp: 900,
      streak: { days: 12, last: '2026-11-09', eggs: 1 },
      daily: { day: '2026-11-09', xp: 80, passes: 2 },
      dailyGoal: 200,
      planStreak: { days: 4, last: '2026-11-09' },
      plan: { day: '2026-11-10', steps: [{ kind: 'review', lessonId: 'w1-02', min: 2, state: 'todo', why: '', from: {} }], bonus: false },
      achievements: { 'first-peep': 5 },
      dinoName: 'Rex',
      heat: { v: 1, cells: {} },
      lessons: {
        // box 0, passed 3 days ago: was due (1 day) → due in session 1
        'w1-02': { best: 90, stars: 2, plays: 5, passedAt: at('2026-11-07').getTime(), box: 0, miss: 1, speed: 0.9 },
        // box 3, passed yesterday: not due (14 days) → step 3, due 1 + 8; never learned without real cold starts
        'w1-03': { best: 95, stars: 3, plays: 9, passedAt: at('2026-10-01').getTime(), lastPass: at('2026-11-09').getTime(), box: 3 },
        // box 2 but 1 star: not learned
        'w2-01': { best: 70, stars: 1, plays: 4, passedAt: at('2026-10-01').getTime(), lastPass: at('2026-11-08').getTime(), box: 2 },
        // jams never get a review
        'w2-05': { best: 70, stars: 1, plays: 2, passedAt: 1, box: 1 },
      },
    }
    const p = importProgress(JSON.stringify(old), NOW)!
    const raw = p as unknown as Record<string, unknown>
    for (const k of ['streak', 'daily', 'dailyGoal', 'planStreak']) expect(raw[k]).toBeUndefined()
    expect(p).toMatchObject({ xp: 900, weekGoal: 3, sessionMin: 30, plan: null, dinoName: 'Rex', achievements: { 'first-peep': 5 } })
    expect(p.seenWeekly).toBeUndefined()
    expect(p.heat).toBeDefined()
    expect(p.lessons['w1-02'].review).toEqual({ step: 0, due: 1, coldPasses: 0, lastColdS: 0, learned: false })
    expect(p.lessons['w1-03'].review).toEqual({ step: 3, due: 9, coldPasses: 0, lastColdS: 0, learned: false })
    expect(p.lessons['w2-01'].review).toMatchObject({ step: 2, due: 5, learned: false, coldPasses: 0 })
    expect(p.lessons['w2-05'].review).toBeUndefined()
    for (const id of Object.keys(p.lessons)) {
      const r = p.lessons[id] as unknown as Record<string, unknown>
      expect(r.box).toBeUndefined()
      expect(r.lastPass).toBeUndefined()
      expect(r.miss).toBeUndefined()
    }
    expect(p.lessons['w1-02'].speed).toBe(0.9)
  })

  it('a brand-new save never shows the weekly note; a dismissed one stays dismissed', () => {
    expect(newProgress().seenWeekly).toBe(true)
    expect(newProgress()).toMatchObject({ mapV: 2, keepOpen: [], dinoBonus: 0 })
    const p = importProgress(JSON.stringify({ ...newProgress(), seenWeekly: true }))!
    expect(p.seenWeekly).toBe(true)
  })

  it('cleans bad stored values', () => {
    const p = importProgress(
      JSON.stringify({
        v: 1,
        xp: -5,
        lessons: { 'w1-02': { best: 'x', stars: 7, speed: 3, topSpeed: 'x', loops: 2.6, hist: [{ s: 1, d: 'bad' }, { s: 2, d: '2026-11-04', best: 70 }], trial: { speed: 'x' } }, junk: 5 },
        weekGoal: 9,
        sessionMin: 45,
        dinoName: '   ',
        cosmetics: ['shades', 'cape'],
        recentFacts: ['a', 3, 'b'],
        sessions: { log: [{ day: '2026-11-04', sec: 700, counted: true, pain: 'ouch' }, { day: 'nope' }], before: 2 },
        weekXp: ['2026-11-02', 5],
        runs: [{ at: 1, id: 'w1-02', bpm: 70 }, { at: 'x' }],
        mapV: 2,
        plan: { v: 2, day: '2026-11-04', min: 30, shape: 'B', steps: [{ kind: 'new', lessonId: 'nope' }, { kind: 'jam', lessonId: 'w2-05', state: 'weird' }, { kind: 'changes', lessonId: null, skill: { game: 'changes', pair: 'A-D' } }] },
      }),
    )!
    expect(p.xp).toBe(0)
    expect(p.lessons.junk).toBeUndefined()
    expect(p.lessons['w1-02']).toMatchObject({ best: 0, stars: 3, speed: 1.15, loops: 3, hist: [{ s: 2, d: '2026-11-04', best: 70 }] })
    expect(p.lessons['w1-02'].topSpeed).toBeUndefined()
    expect(p.lessons['w1-02'].trial).toBeUndefined()
    expect(p).toMatchObject({ weekGoal: 3, sessionMin: 30, dinoName: 'Pebble', cosmetics: ['shades'], recentFacts: ['a', 'b'], weekXp: ['2026-11-02'] })
    expect(p.sessions).toEqual({ log: [{ day: '2026-11-04', sec: 700, set: false, counted: true, pocket: false }], before: 2 })
    expect(p.runs).toHaveLength(1)
    expect(p.plan?.steps.map((s) => [s.kind, s.state])).toEqual([
      ['jam', 'todo'],
      ['changes', 'todo'],
    ])
  })

  it('refuses things that are not progress', () => {
    expect(importProgress('nope')).toBeNull()
    expect(importProgress('[]')).toBeNull()
    expect(importProgress(JSON.stringify({ v: 2, xp: 1, lessons: {} }))).toBeNull()
  })

  it('round-trips through storage, and keeps a corrupt save as a backup', () => {
    const p = applyResult(started(), by('w1-02'), result({ score: 92, passed: true }), DAY, ctx).progress
    saveProgress(p)
    expect(loadProgress()).toEqual(p)
    localStorage.setItem('lessons-progress', '{broken')
    expect(loadProgress().xp).toBe(0)
    expect(localStorage.getItem('lessons-progress-bak')).toBe('{broken')
  })
})
