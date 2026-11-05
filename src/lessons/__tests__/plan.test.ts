import { describe, expect, it } from 'vitest'
import type { LoopSummary, Progress, Stars } from '../types'
import { PLAN_BONUS, catchUp, makePlan, planAfterLoop, planAfterRun, planDone, planMinutes, planStreakNow, skipStep, swapOptions, swapStep, withTodayPlan } from '../plan'
import { applyResult, newProgress, recordSkip, reviewDue } from '../progress'
import { lessonById } from '../data'
import { speedFor } from '../speed'
import { dayNum } from '../heat'
import { at, result } from './fixtures'

const prefs = { speedPick: null } as Parameters<typeof speedFor>[2]

/** One run of a lesson, the way LessonsMode applies it: progress first, then today's set. */
function play(p: Progress, id: string, score: number, passed: boolean, day: string, stars?: Stars) {
  const l = lessonById(id)!
  const speed = speedFor(l, p.lessons[id], prefs)
  const st = stars ?? (passed ? (score >= l.stars[1] ? 2 : 1) : 0)
  const r = result({ lessonId: id, score, passed, speed, stars: st, at: Date.parse(day) })
  const o = applyResult(p, l, r, at(day), { age: null })
  return planAfterRun(o.progress, id, r, at(day))
}
const today = (p: Progress, day: string) => withTodayPlan(p, at(day)) ?? p

/** World 1 passed over two weeks, w2-01 and w2-02 passed lately. */
function midPlayer(): Progress {
  let m = recordSkip(newProgress(), 'w1-01', at('2026-10-20'))
  m = play(m, 'w1-02', 92, true, '2026-10-20').progress
  m = play(m, 'w1-03', 85, true, '2026-10-22').progress
  m = play(m, 'w1-04', 96, true, '2026-10-25', 3).progress
  m = play(m, 'w1-02', 93, true, '2026-10-26').progress
  m = play(m, 'w2-01', 88, true, '2026-11-01').progress
  m = play(m, 'w2-02', 75, true, '2026-11-03', 1).progress
  return m
}

describe('a fresh player', () => {
  it('gets Tap In alone, made once per day', () => {
    const f = today(newProgress(), '2026-11-04')
    expect(f.plan?.steps.map((s) => [s.kind, s.lessonId])).toEqual([['new', 'w1-01']])
    expect(withTodayPlan(f, at('2026-11-04'))).toBeNull()
  })

  it('after Tap In the setup set turns into a real set, with no bonus', () => {
    const f = today(newProgress(), '2026-11-04')
    const r = play(f, 'w1-01', 90, true, '2026-11-04')
    expect(r.finished).toBe(false)
    expect(r.bonus).toBe(0)
    expect(r.progress.plan!.steps.length).toBeGreaterThanOrEqual(2)
    expect(r.progress.plan!.steps.some((s) => s.lessonId === 'w1-01')).toBe(false)
  })

  it('gives the set bonus once, on the run that finishes the set (even a failed one)', () => {
    let p = play(today(newProgress(), '2026-11-04'), 'w1-01', 90, true, '2026-11-04').progress
    const steps = p.plan!.steps
    let finished = 0
    for (let i = 0; i < steps.length; i++) {
      const last = i === steps.length - 1
      const xp = p.xp
      const daily = p.daily.xp
      const r = play(p, steps[i].lessonId, last ? 40 : 92, !last, '2026-11-04')
      if (r.finished) {
        finished++
        expect(r.bonus).toBe(PLAN_BONUS)
        expect(r.progress.planStreak).toEqual({ days: 1, last: '2026-11-04' })
        expect(r.progress.daily.xp - daily).toBe(r.progress.xp - xp)
      }
      p = r.progress
    }
    expect(finished).toBe(1)
    expect(planDone(p.plan!)).toBe(true)
    expect(p.plan!.bonus).toBe(true)
    const again = play(p, steps[0].lessonId, 92, true, '2026-11-04')
    expect(again.finished).toBe(false)
    expect(again.bonus).toBe(0)
    expect(withTodayPlan(again.progress, at('2026-11-04'))).toBeNull()
  })
})

describe('a player in World 2', () => {
  const m = today(midPlayer(), '2026-11-04')
  const steps = m.plan!.steps

  it('builds warm-up, review, new and jam steps without repeats', () => {
    const ids = steps.map((s) => s.lessonId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(steps.find((s) => s.kind === 'new')?.lessonId).toBe('w2-03')
    expect(steps.find((s) => s.kind === 'warmup')?.lessonId).toBe('w2-01')
    expect(steps.find((s) => s.kind === 'jam')?.lessonId).toBe('w2-05')
    expect(steps.map((s) => s.state).every((s) => s === 'todo')).toBe(true)
    expect(planMinutes(m.plan!)).toBeGreaterThanOrEqual(11)
    expect(planMinutes(m.plan!)).toBeLessThanOrEqual(15)
  })

  it('review steps are lessons due today', () => {
    const rv = steps.filter((s) => s.kind === 'review')
    expect(rv.length).toBeGreaterThanOrEqual(1)
    for (const s of rv) expect(reviewDue(m.lessons[s.lessonId], '2026-11-04')).not.toBeNull()
  })

  it('steps done in any order finish the set once; the next day starts fresh and the plan streak grows', () => {
    let p = m
    let fin = 0
    for (const s of [...steps].reverse()) {
      const r = play(p, s.lessonId, 93, true, '2026-11-04')
      fin += r.finished ? 1 : 0
      p = r.progress
    }
    expect(fin).toBe(1)
    expect(p.plan!.steps.every((s) => s.state === 'done')).toBe(true)
    let n = today(p, '2026-11-05')
    expect(n.plan!.day).toBe('2026-11-05')
    expect(n.plan!.bonus).toBe(false)
    for (const s of n.plan!.steps) n = play(n, s.lessonId, 91, true, '2026-11-05').progress
    expect(n.planStreak).toEqual({ days: 2, last: '2026-11-05' })
  })

  it('swap cycles through other lessons of the kind, never one another step uses', () => {
    const i = steps.findIndex((s) => s.kind === 'review')
    const opts = swapOptions(m, i)
    const others = new Set(steps.filter((_, j) => j !== i).map((s) => s.lessonId))
    expect(opts.every((id) => !others.has(id) && id !== steps[i].lessonId)).toBe(true)
    const sw = swapStep(m, i, at('2026-11-04'))
    if (opts.length) expect(sw.plan!.steps[i].lessonId).toBe(opts[0])
    else expect(sw).toBe(m)
    expect(m.plan!.steps[i].lessonId).toBe(steps[i].lessonId) // pure
  })

  it('skip toggles todo and skipped; done steps stay; an all-skipped set is not done', () => {
    const sk = skipStep(m, 0)
    expect(sk.plan!.steps[0].state).toBe('skipped')
    expect(skipStep(sk, 0).plan!.steps[0].state).toBe('todo')
    let all = m
    for (let k = 0; k < steps.length; k++) all = skipStep(all, k)
    expect(planDone(all.plan!)).toBe(false)
    expect(planMinutes(all.plan!)).toBe(0)
    const done = play(m, steps[0].lessonId, 90, true, '2026-11-04').progress
    expect(skipStep(done, 0)).toBe(done)
  })
})

describe('a returning player', () => {
  it('after 10 days away: two due reviews, weakest first, and the plan streak restarts', () => {
    let p = today(midPlayer(), '2026-11-04')
    for (const s of p.plan!.steps) p = play(p, s.lessonId, 93, true, '2026-11-04').progress
    const back = today(p, '2026-11-14')
    expect(planStreakNow(back, at('2026-11-14'))).toBe(0)
    const rv = back.plan!.steps.filter((s) => s.kind === 'review')
    expect(rv).toHaveLength(2)
    expect(rv.every((s) => s.min === 2 && s.why.startsWith('Passed '))).toBe(true)
    expect(back.lessons[rv[0].lessonId].stars).toBeLessThanOrEqual(back.lessons[rv[1].lessonId].stars)

    const failed = play(back, rv[0].lessonId, 30, false, '2026-11-14').progress
    expect(failed.lessons[rv[0].lessonId].box).toBe(0)
    expect(failed.plan!.steps.find((s) => s.lessonId === rv[0].lessonId)?.state).toBe('done')
    let bk = failed
    for (const s of bk.plan!.steps.filter((x) => x.state === 'todo')) bk = play(bk, s.lessonId, 92, true, '2026-11-14').progress
    expect(bk.plan!.bonus).toBe(true)
    expect(bk.planStreak.days).toBe(1)
  })

  it('measures the break when the set is made, so replays the next day never bring the catch-up note back', () => {
    let p = today(midPlayer(), '2026-11-04')
    for (const s of p.plan!.steps) p = play(p, s.lessonId, 93, true, '2026-11-04').progress
    const back = today(p, '2026-11-14')
    expect(back.plan!.away).toBe(10)
    // Back after the break: play the non-review steps only, leaving reviews due.
    let d1 = back
    for (const s of back.plan!.steps.filter((x) => x.kind !== 'review')) d1 = play(d1, s.lessonId, 92, true, '2026-11-14').progress
    // The next day: practised yesterday, so no note, even after replaying yesterday's lessons today.
    let d2 = today(d1, '2026-11-15')
    expect(d2.plan!.away).toBe(1)
    for (const s of d2.plan!.steps.filter((x) => x.kind !== 'review')) d2 = play(d2, s.lessonId, 92, true, '2026-11-15').progress
    expect(catchUp(d2, at('2026-11-15'))).toBeNull()
  })
})

describe('the drill warm-up', () => {
  const base = () => {
    let p = recordSkip(newProgress(), 'w1-01', at('2026-11-01'))
    p = play(p, 'w1-02', 92, true, '2026-11-01').progress
    return p
  }
  const now = at('2026-11-05')
  const d = dayNum(now)
  const cell = (n: number, bad: number, wrong: number) => ({ n, bad, wrong, early: 0, late: 0, err: 0, d, l: 'w1-03' })

  it('replaces the warm-up when the heat has a strong spot', () => {
    const p = { ...base(), heat: { v: 1 as const, cells: { 'n:2.7': cell(30, 18, 15), 'n:1.3': cell(20, 1, 0) } } }
    const plan = makePlan(p, now)
    const w = plan.steps[0]
    expect(w).toMatchObject({ kind: 'warmup', drill: 'n:2.7', lessonId: 'w1-03' })
    expect(plan.steps.filter((s) => s.kind === 'warmup')).toHaveLength(1)
    expect(w.why).not.toMatch(/\d\.\d|undefined|NaN/)
  })

  it('a normal warm-up with too little heat, clean heat, or a spot from an unknown lesson', () => {
    const thin = { ...base(), heat: { v: 1 as const, cells: { 'n:2.7': cell(20, 12, 10) } } }
    const clean = { ...base(), heat: { v: 1 as const, cells: { 'n:2.7': cell(60, 2, 0) } } }
    const gone = { ...base(), heat: { v: 1 as const, cells: { 'n:2.7': { ...cell(30, 18, 15), l: 'gone' }, 'n:1.3': cell(20, 1, 0) } } }
    for (const p of [thin, clean, gone]) expect(makePlan(p, now).steps.some((s) => s.drill)).toBe(false)
  })

  it('a drill loop ticks the drill step with its best pass', () => {
    const p = { ...base(), heat: { v: 1 as const, cells: { 'n:2.7': cell(30, 18, 15), 'n:1.3': cell(20, 1, 0) } } }
    const q = { ...p, plan: makePlan(p, now) }
    const s = { passes: [{ speed: 0.85, acc: 0.5, clean: false }, { speed: 0.9, acc: 0.95, clean: true }], clean: 1, topSpeed: 0.9 } as LoopSummary
    const r = planAfterLoop(q, 'n:2.7', s, now)
    expect(r.progress.plan!.steps[0]).toMatchObject({ state: 'done', score: 95, speed: 0.9 })
    // a normal run of the same lesson does not tick the drill step
    const r2 = planAfterRun(q, 'w1-03', result({ lessonId: 'w1-03' }), now)
    expect(r2.progress.plan!.steps[0].state).toBe('todo')
  })
})
