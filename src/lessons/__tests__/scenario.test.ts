// End-to-end scenarios across the session model, the speed trainer, swing timing, listen mode and metrics.
import { describe, expect, it } from 'vitest'
import type { Lesson, LessonResult, NoteEv, Progress, SessionPlan } from '../types'
import type { SkillEntry } from '../../skills/data'
import { emptyStats, record } from '../../skills/data'
import { FEELS } from '../../music/parts'
import { LESSONS, lessonById } from '../data'
import { buildChart } from '../charts'
import { Judge, WINDOWS } from '../judge'
import { swungBeat } from '../clock'
import { applyResult, importProgress } from '../progress'
import { autoSpeed, bpmAt, tempoStep } from '../speed'
import { SESSION_GAPS, coldRun, isCold, sessionNow } from '../review'
import { ctxDefault, planAfterRun, planAfterSkill, withSessionDay, withTodayPlan } from '../session'
import { tabLevelFor } from '../listen'
import {
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
import { PLAN_WEEKS, planWeek } from '../weeks'
import { at, chartOf, onset, rec, result } from './fixtures'

const lessonOf = (id: string) => lessonById(id) as Lesson

/** A clean run of `l` at `speed` (every event good or better). */
function clean(l: Lesson, speed: number, now: Date): LessonResult {
  const score = l.type === 'improv' ? Math.max(l.stars[1], 85) : 96
  return result({ lessonId: l.id, at: now.getTime(), bpm: bpmAt(l, speed), speed, score, stars: 3, passed: true, cleanShare: 1, clean: true, meanErrMs: 4, spreadMs: 18, counts: { ...result().counts, perfect: 12 } })
}

function sloppy(l: Lesson, speed: number, now: Date): LessonResult {
  return result({ lessonId: l.id, at: now.getTime(), bpm: bpmAt(l, speed), speed, score: 55, stars: 0, passed: false, cleanShare: 0.5 })
}

/** One run through the same steps LessonsMode.finish takes. `fromCard`: started from the Cold start card. */
function run(p: Progress, id: string, now: Date, make: (l: Lesson, s: number, n: Date) => LessonResult = clean, speed?: number, fromCard = false) {
  const l = lessonOf(id)
  const cold = coldRun(p, id, now, { fromCard, shuffle: false })
  const r = make(l, speed ?? autoSpeed(l, p.lessons[id]), now)
  const o = applyResult(p, l, r, now, { age: null, cold })
  return { progress: planAfterRun(o.progress, id, r, now).progress, outcome: o, cold }
}

/** An old save: daily streak, a daily XP goal, a v1 day plan and day-based review boxes. */
const OLD_SAVE = {
  v: 1,
  xp: 640,
  streak: { days: 9, last: '2026-10-30', eggs: 2 },
  daily: { day: '2026-10-30', xp: 120, passes: 1 },
  dailyGoal: 150,
  planStreak: { days: 3, last: '2026-10-30' },
  plan: { day: '2026-10-30', steps: [{ kind: 'review', lessonId: 'w1-02', min: 2, state: 'done', why: '', from: {} }], bonus: true },
  achievements: { 'first-peep': 1 },
  dinoName: 'Riff',
  lessons: {
    'w1-01': { best: 90, stars: 2, plays: 1, passedAt: 1 },
    'w1-02': { best: 92, stars: 3, plays: 6, passedAt: at('2026-10-20').getTime(), lastPass: at('2026-10-27').getTime(), box: 1, speed: 1, topSpeed: 1, miss: 2 },
    'w1-03': { best: 88, stars: 2, plays: 4, passedAt: at('2026-10-25').getTime(), box: 0, speed: 1, topSpeed: 1 },
    'w1-05': { best: 70, stars: 1, plays: 2, passedAt: at('2026-10-28').getTime(), box: 0 },
  },
}

describe('a week with an old save', () => {
  const MON = at('2026-11-02')
  const WED = at('2026-11-04')
  const FRI = at('2026-11-06')

  it('migrates the old save cleanly', () => {
    const p = importProgress(JSON.stringify(OLD_SAVE), MON)!
    expect(p).not.toBeNull()
    const raw = p as unknown as Record<string, unknown>
    for (const k of ['streak', 'daily', 'dailyGoal', 'planStreak']) expect(raw[k]).toBeUndefined()
    expect(p).toMatchObject({ xp: 640, dinoName: 'Riff', plan: null, weekGoal: 3, sessionMin: 30, achievements: { 'first-peep': 1 } })
    expect(p.seenWeekly).toBeUndefined()
    // Everything overdue under the old calendar is due in the first session.
    expect(sessionNow(p, MON)).toBe(1)
    for (const id of ['w1-02', 'w1-03', 'w1-05']) expect(p.lessons[id].review?.due).toBe(1)
    expect(isCold(p, 'w1-02', MON)).toBe(true)
  })

  it('3 sessions make an A/B/C week, new material in at most two, cold tests move the intervals', () => {
    let p = importProgress(JSON.stringify(OLD_SAVE), MON)!
    const ctx = ctxDefault()
    const shapes: string[] = []
    let newSessions = 0
    const plans: SessionPlan[] = []
    for (const now of [MON, WED, FRI]) {
      p = withTodayPlan(p, now, ctx) ?? p
      const plan = p.plan!
      plans.push(plan)
      shapes.push(plan.shape)
      if (plan.steps.some((s) => s.kind === 'new' && !s.consolidate)) newSessions++
      expect(plan.steps.reduce((a, s) => a + s.min, 0)).toBe(30)
      for (const step of plan.steps) {
        if (step.kind === 'mix') {
          for (const id of step.items ?? []) p = run(p, id, now).progress
        } else if (step.lessonId) {
          const before = p.lessons[step.lessonId]?.review
          const r = run(p, step.lessonId, now, clean, undefined, step.kind === 'cold')
          if (step.kind === 'cold') {
            // a clean cold-start test lengthens the gap one step
            expect(r.cold).toBe(true)
            const s = sessionNow(p, now)
            expect(r.progress.lessons[step.lessonId].review!.due).toBe(s + SESSION_GAPS[Math.min(3, (before?.step ?? 0) + 1)])
          }
          p = r.progress
          // a new item is practised blocked: two more clean runs earn its tempo
          if (step.kind === 'new') for (let i = 0; i < 2; i++) p = run(p, step.lessonId, now).progress
        } else if (step.skill) {
          const g = step.skill.game
          const e: SkillEntry = { id: `${step.kind}-${now.getTime()}`, game: g === 'record' ? 'rate' : g === 'mental' ? 'find' : g, at: now.getTime(), score: 30, ...(step.skill.game === 'changes' && step.skill.pair ? { detail: step.skill.pair } : {}) }
          p = planAfterSkill(p, e, now).progress
        }
      }
      expect(p.plan!.steps.every((s) => s.state !== 'todo')).toBe(true)
      const sd = withSessionDay(p, now, 25 * 60)
      expect(sd.counted).toBe(true)
      p = sd.progress
    }
    expect(shapes).toEqual(['A', 'B', 'C'])
    expect(newSessions).toBeLessThanOrEqual(2)
    expect(plans[1].steps.some((s) => s.kind === 'new')).toBe(false)
    // Every plan ends with a jam in listen mode.
    for (const pl of plans) expect(pl.steps[pl.steps.length - 1].kind).toBe('jam')
    // The third session met the week goal once.
    expect(p.weekXp).toEqual(['2026-11-02'])
    expect(p.sessions.log.filter((d) => d.counted).map((d) => d.day)).toEqual(['2026-11-02', '2026-11-04', '2026-11-06'])
  })

  it('a failed cold-start test shortens the gap and slows the next cold test', () => {
    let p = importProgress(JSON.stringify(OLD_SAVE), MON)!
    // Session 1: a clean cold pass at full speed → step 1, due in 2 sessions.
    p = run(p, 'w1-03', MON, clean, undefined, true).progress
    p = withSessionDay(p, MON, 900).progress
    expect(p.lessons['w1-03'].review).toMatchObject({ step: 1, due: 3, coldPasses: 1 })
    // Session 2 (Wed): not due yet, so not cold.
    p = withSessionDay(p, WED, 900).progress
    expect(isCold(p, 'w1-03', WED)).toBe(false)
    // Session 3 (Fri): due; the cold test fails → one step shorter, the next cold test is slower.
    expect(sessionNow(p, FRI)).toBe(3)
    const l = lessonOf('w1-03')
    const r = run(p, 'w1-03', FRI, sloppy, 1, true)
    expect(r.cold).toBe(true)
    expect(r.progress.lessons['w1-03'].review).toMatchObject({ step: 0, due: 4, learned: false, coldPasses: 0 })
    expect(r.progress.lessons['w1-03'].review!.coldSpeed).toBeCloseTo(1 - 2 * tempoStep(l))
  })
})

describe('only the Cold start card makes a cold test', () => {
  const MON = at('2026-11-02')

  it('a due item played from the map, a warm-up or a mix is an ordinary run: the review does not move', () => {
    const p = importProgress(JSON.stringify(OLD_SAVE), MON)!
    expect(isCold(p, 'w1-02', MON)).toBe(true)
    const before = p.lessons['w1-02'].review
    for (const make of [clean, sloppy]) {
      const r = run(p, 'w1-02', MON, make)
      expect(r.cold).toBe(false)
      expect(r.outcome.cold).toBeNull()
      expect(r.progress.lessons['w1-02'].review).toEqual(before)
      expect(r.progress.runs[r.progress.runs.length - 1].cold).toBe(false)
      // Played before session numbers: it stays firstS 0, never "new this week".
      expect(r.progress.lessons['w1-02'].firstS).toBe(0)
    }
    // Shuffle never counts, from the card either.
    expect(coldRun(p, 'w1-02', MON, { fromCard: true, shuffle: true })).toBe(false)
    expect(coldRun(p, 'w1-02', MON, { fromCard: true, shuffle: false })).toBe(true)
  })

  it('an old save never starts "learned", so Locked In waits for real cold starts', () => {
    const save = { ...OLD_SAVE, lessons: { ...OLD_SAVE.lessons, 'w1-03': { ...OLD_SAVE.lessons['w1-03'], box: 4, stars: 3 } } }
    const p = importProgress(JSON.stringify(save), MON)!
    expect(Object.values(p.lessons).some((r) => r.review?.learned)).toBe(false)
    const r = run(p, 'w1-03', MON)
    expect(r.outcome.newAchievements).not.toContain('locked-in')
  })
})

describe('the 12-week plan drives new material', () => {
  it('two new items a week reach the boogie shuffle by week 2 and box 1 in 8ths by week 6', () => {
    const start = at('2026-11-02')
    let p = importProgress(JSON.stringify({ v: 1, xp: 0, lessons: { 'w1-01': { plays: 1 } } }), start)!
    const firstNew: Record<string, number> = {}
    const ctx = ctxDefault()
    for (let week = 1; week <= 6; week++) {
      for (const off of [0, 2, 4]) {
        const now = new Date(start.getTime() + ((week - 1) * 7 + off) * 86400000)
        p = withTodayPlan(p, now, ctx) ?? p
        for (const step of p.plan!.steps) {
          if (step.kind === 'mix') {
            for (const id of step.items ?? []) p = run(p, id, now).progress
          } else if (step.lessonId) {
            if (step.kind === 'new' && !step.consolidate && firstNew[step.lessonId] === undefined) firstNew[step.lessonId] = week
            const reps = step.kind === 'new' ? 3 : 1
            for (let i = 0; i < reps; i++) p = run(p, step.lessonId, now, clean, undefined, step.kind === 'cold' && i === 0).progress
          }
        }
        p = withSessionDay(p, now, 25 * 60).progress
      }
    }
    expect(firstNew['w3-07']).toBeLessThanOrEqual(2)
    expect(firstNew['w5-11']).toBeLessThanOrEqual(6)
    // The first fortnight's plan lessons came first, in plan order.
    expect(Object.keys(firstNew).slice(0, 4)).toEqual(['w1-05', 'w3-06', 'w3-07', 'w4-01'])
  })
})

describe('clean-pass speed trainer', () => {
  it('raises the tempo only after a clean first run plus two more', () => {
    const now = at('2026-11-02')
    const l = lessonOf('w2-02')
    let p = importProgress(JSON.stringify({ v: 1, xp: 0, lessons: { 'w1-01': { plays: 1 } } }), now)!
    p.lessons['w2-02'] = rec({ speed: 0.85, plays: 2, hist: [] })
    const speeds: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = run(p, 'w2-02', now, clean, 0.85)
      p = r.progress
      speeds.push(p.lessons['w2-02'].speed!)
      if (i < 2) expect(r.outcome.speed?.earned).toBe(false)
      else expect(r.outcome.speed).toMatchObject({ earned: true, topAfter: 0.85 })
    }
    expect(speeds).toEqual([0.85, 0.85, +(0.85 + tempoStep(l)).toFixed(2)])
    expect(p.lessons['w2-02'].topSpeed).toBe(0.85)
    // A first run at the new tempo that isn't clean goes one step down, and earns nothing.
    const up = p.lessons['w2-02'].speed!
    const r = run(p, 'w2-02', now, sloppy, up)
    expect(r.progress.lessons['w2-02'].speed).toBeCloseTo(up - tempoStep(l))
    expect(r.outcome.xp).toBe(0)
  })
})

describe('swung shuffle', () => {
  // A notes lesson over a swinging band, with off-beat 8ths.
  const l = LESSONS.find((x) => {
    if (x.type !== 'notes' || !x.backing || !FEELS[x.backing.feel]?.swing) return false
    return buildChart(x).events.some((e) => e.kind === 'note' && Math.abs((e.beat * 2) % 2 - 1) < 1e-6)
  }) as Lesson
  const notes = () => buildChart(l).events.filter((e): e is NoteEv => e.kind === 'note')
  const judge = (swing: boolean) => {
    const c = chartOf(notes(), buildChart(l).bars)
    return new Judge(c, { start: 0, secPerBeat: 60 / l.bpm, windows: WINDOWS[l.timing], octaveOk: false, restGate: () => 0.01, listenBars: [], swing })
  }
  const play = (j: Judge, swingTimes: boolean) => {
    const spb = 60 / l.bpm
    const out = []
    for (const e of notes()) {
      const t = swungBeat(e.beat, swingTimes) * spb
      j.onset(onset(t, e.midi))
      out.push(...j.tick(t + 0.05))
    }
    out.push(...j.tick(1e6))
    return out
  }

  it('exists in the lesson data', () => {
    expect(l).toBeDefined()
  })

  it('notes played on the swung grid are judged on time', () => {
    const res = play(judge(true), true)
    expect(res.length).toBe(notes().length)
    expect(res.every((r) => r.verdict === 'perfect')).toBe(true)
    expect(Math.max(...res.map((r) => Math.abs(r.errMs ?? 0)))).toBeLessThanOrEqual(1)
  })

  it('the same notes played straight read early on the off-beats', () => {
    const res = play(judge(true), false)
    const early = res.filter((r) => (r.errMs ?? 0) < -100)
    expect(early.length).toBeGreaterThan(0)
  })
})

describe('listen mode', () => {
  it('a listen-mode run with the tab hidden still scores and is logged as such', () => {
    const now = at('2026-11-02')
    let p = importProgress(JSON.stringify({ v: 1, xp: 0, lessons: { 'w1-01': { plays: 1 } } }), now)!
    const jam = lessonOf('w2-05')
    const r = { ...clean(jam, 1, now), tab: 'hidden' as const, quiet: true }
    const o = applyResult(p, jam, r, now, { age: null, cold: false })
    p = o.progress
    expect(p.lessons['w2-05'].best).toBe(r.score)
    expect(p.lessons['w2-05'].passedAt).toBeDefined()
    expect(p.runs[p.runs.length - 1]).toMatchObject({ id: 'w2-05', tab: 'hidden', quiet: true })
    // Tab fades as an item matures: none → full, 1 cold pass → faded, learned → hidden.
    expect(tabLevelFor(undefined)).toBe('full')
    expect(tabLevelFor(rec({ review: { step: 1, due: 2, coldPasses: 1, lastColdS: 1, learned: false } }))).toBe('faded')
    expect(tabLevelFor(rec({ review: { step: 2, due: 4, coldPasses: 2, lastColdS: 2, learned: true } }))).toBe('hidden')
  })
})

describe('metrics from synthetic data', () => {
  function walk(v: unknown, path: string, bad: string[]) {
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(path)
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, bad))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, bad)
  }

  it('computes every metric without NaN, on empty and on full data', () => {
    const now = at('2026-11-20')
    const empty = importProgress(JSON.stringify({ v: 1, xp: 0, lessons: {} }), now)!
    // Three weeks of sessions with cold tests, jams, bends and skill rounds.
    let p = importProgress(JSON.stringify(OLD_SAVE), at('2026-11-02'))!
    let stats = emptyStats()
    const days = ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18', '2026-11-20']
    days.forEach((d, i) => {
      const t = at(d)
      p = withTodayPlan(p, t, ctxDefault()) ?? p
      for (const id of ['w1-02', 'w1-03', 'w1-05']) p = run(p, id, t, i % 3 === 2 ? sloppy : clean, undefined, true).progress
      const jam = lessonOf('w2-05')
      const jr = { ...clean(jam, 1, t), quiet: true, tab: 'hidden' as const, improv: { jam: { strong: 0.4 + i * 0.05, restBeats: 2, phrases: 4, silentBars: 1 } } as unknown as LessonResult['improv'], bendCents: 20 - i, swing: true }
      p = applyResult(p, jam, jr, t, { age: null, cold: false }).progress
      p = withSessionDay(p, t, 1500).progress
      if (i === 3) p.sessions.log[p.sessions.log.length - 1].pain = 'mild'
      const ms = t.getTime()
      stats = record(stats, 'changes', 20 + i * 3, 'A5-E5', ms).stats
      stats = record(stats, 'fretTime', 4000 - i * 200, '0', ms).stats
      stats = record(stats, 'fretTime', 3500 - i * 100, '1', ms).stats
      stats = record(stats, 'earFirst', 40 + i * 5, undefined, ms).stats
      stats = record(stats, 'drift', 30 - i, '4', ms).stats
      stats = record(stats, 'rate', 3, undefined, ms).stats
    })
    for (const [name, prog, st] of [['empty', empty, emptyStats()], ['full', p, stats]] as const) {
      const all = {
        cold: coldSeries(prog),
        rate: coldPassRate(prog),
        gaps: gapList(prog),
        straight: timingTrend(prog, false),
        swung: timingTrend(prog, true),
        drift: driftSeries(st),
        pairs: changesByPair(st),
        fret: fretTimes(st),
        ear: earFirstSeries(st),
        jam: jamQuality(prog, st),
        bends: bendSeries(prog),
        weeks: weeksVsGoal(prog, now),
        pain: painFlags(prog, now),
        minutes: minutesVsPlan(prog),
        week: planWeek(prog, now),
        checks: PLAN_WEEKS.map((w) => w.check(prog, st)),
      }
      const bad: string[] = []
      walk(all, name, bad)
      expect(bad).toEqual([])
      if (name === 'full') {
        expect(all.cold.length).toBeGreaterThan(0)
        expect(all.rate.total).toBeGreaterThan(0)
        expect(all.swung.length + all.straight.length).toBeGreaterThan(0)
        expect(all.drift[0]).toMatchObject({ gap: 4 })
        expect(all.fret[0].sec).not.toBeNull()
        expect(all.jam.strong.length).toBe(days.length)
        expect(all.bends.length).toBe(days.length)
        expect(all.pain).toEqual([{ day: '2026-11-09', pain: 'mild' }])
        expect(all.weeks.weeks.slice(-3).map((w) => w.count)).toEqual([3, 2, 3])
        expect(all.minutes.length).toBe(days.length)
        expect(all.week).toBe(3)
      }
    }
  })
})
