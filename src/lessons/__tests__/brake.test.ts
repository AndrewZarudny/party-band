// The plan's "repeat or move on" rules (section 4, 8 Nov 2026): the review brake, and full tempo for learned.
import { describe, expect, it } from 'vitest'
import type { LessonRecord, Progress, SessionDay, SessionMin } from '../types'
import { PLAN_PATH, lessonById } from '../data'
import { applyResult, importProgress, isPassed, newProgress } from '../progress'
import {
  LEARN_SESSIONS,
  REVIEW_BRAKE,
  applyCold,
  coldSpeedFor,
  firstReview,
  fullColds,
  isCold,
  isReviewItem,
  isStruggling,
  reviewBrake,
  standingLabel,
  standingOf,
  strugglingList,
} from '../review'
import { WARMUPS, ctxDefault, makeSessionPlan, stepOpensCold, stepSource, swapStep, withTodayPlan } from '../session'
import { at, lesson, rec, result } from './fixtures'

const NOW = at('2026-11-04') // Wednesday; no sessions this week yet: shape A, which has a New step
const ctx = ctxDefault()
const day = (d: string, o: Partial<SessionDay> = {}): SessionDay => ({ day: d, sec: 900, set: false, counted: true, pocket: false, ...o })

/** Review items on the plan's path, in order (not the warm-ups, so warm-up choice stays out of the way). */
const ITEMS = PLAN_PATH.filter((id) => {
  const l = lessonById(id)
  return !!l && isReviewItem(l) && !WARMUPS.includes(id)
})

/** Passed at 70%, and the newest cold test failed with `score`. due 99: not due again in these tests unless asked. */
function failing(score: number, o: { due?: number } = {}): LessonRecord {
  return rec({
    passedAt: 1,
    passedSpeed: 0.7,
    topSpeed: 0.7,
    plays: 4,
    stars: 1,
    best: 70,
    firstS: 1,
    playsDay: '2026-11-01',
    lastPlayed: at('2026-11-01').getTime(),
    review: { step: 0, due: o.due ?? 99, coldPasses: 0, lastColdS: 0, learned: false, coldSpeed: 0.6 },
    hist: [
      { s: 1, d: '2026-11-01', best: 56 },
      { s: 2, d: '2026-11-02', cold: { s: 2, d: '2026-11-02', bpm: 50, speed: 0.7, clean: false, score, tab: 'hidden' } },
    ],
  })
}

/** Tap In done and the first path lessons passed, so there is always a new lesson to offer. */
function base(): Progress {
  const p = newProgress()
  p.lessons['w1-01'] = rec({ plays: 1, passedAt: 1 })
  for (const id of WARMUPS.slice(0, 1)) p.lessons[id] = rec({ passedAt: 1, plays: 3, stars: 2, best: 85, playsDay: '2026-10-01', lastPlayed: 1 })
  return p
}

const withFailing = (scores: number[], o: { due?: number } = {}) => {
  const p = base()
  scores.forEach((s, i) => (p.lessons[ITEMS[i]] = failing(s, o)))
  return p
}
const newStep = (p: Progress, now = NOW) => makeSessionPlan(p, now, ctx).steps.find((s) => s.kind === 'new')

describe('struggling items', () => {
  it('needs a failed newest cold, or a clean one far under the best before it; learned and untested items are not counted', () => {
    const l = lessonById(ITEMS[0])!
    expect(isStruggling(l, failing(20))).toBe(true)
    // Not clean but at the 2-star mark (a few unsure chords, not memory): sticking. Under it: not.
    expect(isStruggling(l, failing(l.stars[1]))).toBe(false)
    expect(isStruggling(l, failing(l.stars[1] - 1))).toBe(true)
    // No cold test yet: nothing says it's failing.
    expect(isStruggling(l, rec({ passedAt: 1, review: firstReview(1) }))).toBe(false)
    // Learned: never struggling.
    const learned = failing(20)
    learned.review = { ...learned.review!, learned: true }
    expect(isStruggling(l, learned)).toBe(false)
    // Clean, 12 BPM under the best of the session before: struggling. 6 BPM under: fine.
    const gap = (bpm: number) =>
      rec({
        passedAt: 1,
        review: firstReview(1),
        hist: [
          { s: 1, d: '2026-11-01', best: 80 },
          { s: 2, d: '2026-11-02', cold: { s: 2, d: '2026-11-02', bpm, speed: bpm / l.bpm, clean: true, score: 92, tab: 'hidden' } },
        ],
      })
    expect(isStruggling(l, gap(68))).toBe(true)
    expect(isStruggling(l, gap(74))).toBe(false)
    // Jams are never review items.
    expect(isStruggling(lessonById('w2-05'), failing(10))).toBe(false)
  })

  it('lowest newest cold score first, then map order', () => {
    const p = withFailing([30, 8, 30, 15])
    expect(strugglingList(p)).toEqual([ITEMS[1], ITEMS[3], ITEMS[0], ITEMS[2]])
  })
})

describe('the review brake', () => {
  it(`is on from ${REVIEW_BRAKE} struggling items: 2 still get a new lesson, 3 do not`, () => {
    expect(REVIEW_BRAKE).toBe(3)
    const two = withFailing([20, 10])
    expect(reviewBrake(two)).toBe(false)
    const n2 = newStep(two)!
    expect(n2.brake).toBeUndefined()
    expect(isPassed(two, n2.lessonId!)).toBe(false) // a real new lesson

    const three = withFailing([20, 10, 30])
    expect(reviewBrake(three)).toBe(true)
    const n3 = newStep(three)!
    expect(n3).toMatchObject({ kind: 'new', brake: true, consolidate: true, lessonId: ITEMS[1] }) // score 10: lowest first
    expect(n3.why).toMatch(/^Review first/)
    expect(stepSource(n3)).toBe('Review first')
  })

  it('no step in the plan is a lesson not passed yet, in any week shape or length', () => {
    const p = withFailing([20, 10, 30, 25])
    const logs = [[], [day('2026-11-02')], [day('2026-11-02'), day('2026-11-03')], [day('2026-11-01'), day('2026-11-02'), day('2026-11-03')]]
    for (const min of [20, 30] as SessionMin[])
      for (const log of logs) {
        const q = { ...p, sessionMin: min, sessions: { log, before: 0 } }
        for (const s of makeSessionPlan(q, NOW, ctx).steps) {
          if (s.kind === 'new') expect(s.brake).toBe(true)
          if (s.lessonId && s.kind !== 'jam') expect(isPassed(q, s.lessonId)).toBe(true)
        }
      }
  })

  it('struggling items due a cold start today go to the cold steps; the New slot takes one that is not', () => {
    const p = withFailing([20, 10, 30], { due: 1 })
    p.lessons[ITEMS[3]] = failing(40) // not due
    const steps = makeSessionPlan(p, NOW, ctx).steps
    expect(steps.find((s) => s.kind === 'cold')?.lessonId).toBe(ITEMS[0]) // cold steps keep their own order
    expect(steps.find((s) => s.kind === 'new')?.lessonId).toBe(ITEMS[3])
  })

  it('swapping the review step cycles through struggling items and keeps it a review step', () => {
    const p = withFailing([20, 10, 30])
    const q = { ...p, plan: makeSessionPlan(p, NOW, ctx) }
    const i = q.plan.steps.findIndex((s) => s.kind === 'new')
    const swapped = swapStep(q, i, NOW).plan!.steps[i]
    expect(swapped).toMatchObject({ brake: true, consolidate: true, lessonId: ITEMS[0] })
  })

  it("an untouched plan made before the brake came on is made again; a started one is kept", () => {
    const two = withFailing([20, 10])
    const early = { ...two, plan: makeSessionPlan(two, NOW, ctx) }
    expect(withTodayPlan(early, NOW, ctx)).toBeNull()
    const three = { ...early, lessons: { ...early.lessons, [ITEMS[2]]: failing(5) } }
    const remade = withTodayPlan(three, NOW, ctx)
    expect(remade?.plan?.steps.find((s) => s.kind === 'new')).toMatchObject({ brake: true, lessonId: ITEMS[2] })
    const started = { ...three, plan: { ...early.plan, steps: early.plan.steps.map((s, j) => (j === 0 ? { ...s, state: 'done' as const } : s)) } }
    expect(withTodayPlan(started, NOW, ctx)).toBeNull()
  })
})

describe('a save shaped like week 1', () => {
  // 17 lessons passed in 5 days at 60-80%, every cold start scored 8-32, nothing learned, no 3 stars. No passedSpeed
  // field yet (an older save): the speed comes from the run log.
  function weekOne(): Progress {
    const ids = PLAN_PATH.filter((id) => lessonById(id)?.type !== 'sync').slice(0, 17)
    const lessons: Record<string, unknown> = { 'w1-01': rec({ plays: 1, passedAt: 1, firstS: 1 }) }
    const runs: unknown[] = []
    ids.forEach((id, i) => {
      const l = lessonById(id)!
      const speed = [0.6, 0.7, 0.8][i % 3]
      const passedAt = at('2026-11-04').getTime() + i * 60000
      const s = 1 + (i % 4)
      const r: Record<string, unknown> = { ...rec({ passedAt, plays: 3, stars: 1, best: 68, firstS: s, playsDay: '2026-11-08', lastPlayed: passedAt, topSpeed: speed }), hist: [{ s, d: '2026-11-04', best: Math.round(l.bpm * speed) }] }
      if (isReviewItem(l)) {
        const score = 8 + ((i * 7) % 25) // 8-32
        r.review = { step: 0, due: 6, coldPasses: 0, lastColdS: 0, learned: false, coldSpeed: 0.6 }
        r.hist = [...(r.hist as unknown[]), { s: 5, d: '2026-11-08', cold: { s: 5, d: '2026-11-08', bpm: Math.round(l.bpm * 0.92), speed: 0.92, clean: false, score, tab: 'hidden' } }]
      }
      lessons[id] = r
      runs.push({ at: passedAt + 2000, id, bpm: Math.round(l.bpm * speed), swing: false, mean: -100, spread: 60, n: 20, tab: 'full', quiet: false, cold: false, clean: false, bend: null })
    })
    const log = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'].map((d) => day(d))
    const raw = { v: 1, xp: 900, mapV: 2, lessons, runs, sessions: { log, before: 0 }, plan: null }
    return importProgress(JSON.stringify(raw), at('2026-11-10'))!
  }

  it('migrates: pass speeds come from the run log, nothing is learned, nothing is dropped', () => {
    const p = weekOne()
    const ids = Object.keys(p.lessons).filter((id) => id !== 'w1-01')
    expect(ids).toHaveLength(17)
    for (const id of ids) {
      expect([0.6, 0.7, 0.8]).toContain(p.lessons[id].passedSpeed)
      expect(standingOf(p.lessons[id])).toBe('passed')
      expect(standingLabel(p.lessons[id])).toMatch(/^Passed at (60|70|80)%$/)
    }
  })

  it('makes review-only plans: no new lesson in any shape', () => {
    const p = weekOne()
    expect(strugglingList(p).length).toBeGreaterThanOrEqual(REVIEW_BRAKE)
    for (const now of [at('2026-11-10'), at('2026-11-11'), at('2026-11-12')]) {
      const pl = makeSessionPlan(p, now, ctx)
      for (const s of pl.steps) {
        if (s.kind === 'new') expect(s.brake).toBe(true)
        if (s.lessonId && s.kind !== 'jam') expect(isPassed(p, s.lessonId)).toBe(true)
      }
    }
    // Monday of a new week: shape A, whose New slot goes to the lowest cold score.
    const a = makeSessionPlan(p, at('2026-11-09'), ctx)
    expect(a.shape).toBe('A')
    const n = a.steps.find((s) => s.kind === 'new')
    expect(n?.brake).toBe(true)
    expect(strugglingList(p)).toContain(n?.lessonId)
  })

  it('the review-first item is due its cold test too, so it opens with the Cold start card', () => {
    const p = weekOne()
    const mon = at('2026-11-09')
    const steps = makeSessionPlan(p, mon, ctx).steps
    const n = steps.find((s) => s.kind === 'new')!
    // Every struggling item failed its newest cold test, so all of them are due today.
    expect(isCold(p, n.lessonId!, mon)).toBe(true)
    expect(stepOpensCold(p, n, mon)).toBe(true)
    expect(stepOpensCold(p, steps.find((s) => s.kind === 'cold')!, mon)).toBe(true)
    // Played once today: the cold test is spent, the step opens as plain reps.
    const played = { ...p, lessons: { ...p.lessons, [n.lessonId!]: { ...p.lessons[n.lessonId!], playsDay: '2026-11-09', playsToday: 1 } } }
    expect(stepOpensCold(played, n, mon)).toBe(false)
    // A jam or warm-up step never does.
    for (const s of steps.filter((x) => x.kind === 'jam' || x.kind === 'warmup')) expect(stepOpensCold(p, s, mon)).toBe(false)
  })
})

describe('full speed counts', () => {
  const L80 = lesson({ id: 't80', bpm: 80, type: 'notes' })
  const cold = (r0: LessonRecord, s: number, clean: boolean, speed: number) => {
    const r = rec({ ...r0, hist: r0.hist?.map((h) => ({ ...h })) })
    applyCold(r, L80, result({ bpm: Math.round(80 * speed), speed, score: clean ? 95 : 40, at: 1000 + s }), s, `2026-11-${String(s).padStart(2, '0')}`, clean)
    return r
  }

  it('a clean cold at 92% does not count; at 100% it does; learned needs two separate sessions', () => {
    let r = rec({ passedAt: 1, passedSpeed: 0.7, review: firstReview(1) })
    r = cold(r, 2, true, 0.92)
    expect(r.review).toMatchObject({ coldPasses: 0, learned: false })
    expect(fullColds(r)).toBe(0)
    r = cold(r, 4, true, 1)
    expect(r.review).toMatchObject({ coldPasses: 1, learned: false })
    expect(standingLabel(r)).toBe('Passed at 70%')
    expect(cold(r, 4, true, 1).review?.learned).toBe(false) // the same session again
    r = cold(r, 6, true, 1)
    expect(r.review).toMatchObject({ coldPasses: LEARN_SESSIONS, learned: true })
    expect(standingOf(r)).toBe('learned')
    expect(standingLabel(r)).toBe('Learned')
  })

  it('cold tests step up toward full tempo after each clean one, and stay there', () => {
    // The staircase after a fail at 100% (tempo step 0.04 at 80 BPM): 0.92.
    let r = cold(rec({ passedAt: 1, review: firstReview(1), hist: [{ s: 1, d: '2026-11-01', best: 64 }] }), 2, false, 1)
    expect(coldSpeedFor(L80, r)).toBe(0.92)
    r = cold(r, 3, true, 0.92)
    expect(coldSpeedFor(L80, r)).toBe(0.96)
    r = cold(r, 5, true, 0.96)
    expect(coldSpeedFor(L80, r)).toBe(1)
    r = cold(r, 9, true, 1)
    // A slower practice session afterwards doesn't pull the cold test back under full tempo.
    r.hist!.push({ s: 10, d: '2026-11-10', best: 60 })
    expect(coldSpeedFor(L80, r)).toBe(1)
  })

  it('a clean cold at the slower speed the app asked for is climbing back, not struggling', () => {
    // Best 64 BPM (0.8); fails at 0.8 and 0.72, then clean at 0.64 (51 BPM): 13 BPM under the best.
    let r = cold(rec({ passedAt: 1, review: firstReview(1), hist: [{ s: 1, d: '2026-11-01', best: 64 }] }), 2, false, 0.8)
    r = cold(r, 3, false, coldSpeedFor(L80, r))
    expect(coldSpeedFor(L80, r)).toBe(0.64)
    const clean = rec({ ...r, hist: r.hist?.map((h) => ({ ...h })) })
    const o = applyCold(clean, L80, result({ bpm: 51, speed: 0.64, score: 95, at: 1004 }), 4, '2026-11-04', true)
    expect(isStruggling(L80, clean)).toBe(false)
    expect(o.lines.some((l) => l.includes('goes back to review'))).toBe(false)
    // The next test is one step up, not back at the 64 BPM that failed twice.
    expect(coldSpeedFor(L80, clean)).toBe(0.68)
    // A clean cold that far under the best with no slower speed asked for still counts as struggling.
    const plain = cold(rec({ passedAt: 1, review: firstReview(1), hist: [{ s: 1, d: '2026-11-01', best: 64 }] }), 2, true, 0.64)
    expect(isStruggling(L80, plain)).toBe(true)
  })

  it('applyResult keeps the fastest passing speed', () => {
    const l = lessonById(ITEMS[0])!
    let p = base()
    const run = (speed: number, passed: boolean, day: string) => {
      p = applyResult(p, l, result({ lessonId: l.id, speed, bpm: Math.round(l.bpm * speed), passed, score: passed ? 70 : 40, stars: passed ? 1 : 0, at: at(day).getTime() }), at(day), { age: null, cold: false }).progress
    }
    run(0.72, true, '2026-11-04')
    expect(p.lessons[l.id].passedSpeed).toBe(0.72)
    run(0.85, false, '2026-11-05')
    run(0.66, true, '2026-11-05')
    expect(p.lessons[l.id].passedSpeed).toBe(0.72)
    run(1, true, '2026-11-06')
    expect(standingLabel(p.lessons[l.id])).toBe('Passed at full tempo')
  })

  it('old records: no pass speed and no matching run says "Passed"; a learned item stays learned', () => {
    const raw = {
      v: 1,
      xp: 10,
      mapV: 2,
      lessons: {
        [ITEMS[0]]: rec({ passedAt: 5000, plays: 2, review: { step: 2, due: 9, coldPasses: 2, lastColdS: 4, learned: true } }),
        [ITEMS[1]]: rec({ passedAt: 5000, plays: 2 }),
      },
      runs: [{ at: 5000 + 10 * 60000, id: ITEMS[1], bpm: 50, swing: false, mean: null, spread: null, n: 0, tab: 'full', quiet: false, cold: false, clean: false, bend: null }],
    }
    const p = importProgress(JSON.stringify(raw), NOW)!
    expect(p.lessons[ITEMS[0]].review?.learned).toBe(true)
    expect(standingLabel(p.lessons[ITEMS[0]])).toBe('Learned')
    expect(p.lessons[ITEMS[1]].passedSpeed).toBeUndefined() // the run is 10 minutes off: not the pass
    expect(standingLabel(p.lessons[ITEMS[1]])).toBe('Passed')
    expect(standingLabel(undefined)).toBeNull()
  })
})
