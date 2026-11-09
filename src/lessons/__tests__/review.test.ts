import { describe, expect, it } from 'vitest'
import type { HistEntry, LessonRecord, Progress, ReviewState, SessionDay } from '../types'
import { HIST_MAX, LEARN_SESSIONS, SESSION_GAPS, applyCold, coldSpeedFor, firstReview, isCold, isReviewItem, retentionGap, sessionNow, sessionOf, weekKey, weekStatus } from '../review'
import { newProgress } from '../progress'
import { lessonById } from '../data'
import { tempoStep } from '../speed'
import { at, lesson, rec, result } from './fixtures'

const day = (d: string, o: Partial<SessionDay> = {}): SessionDay => ({ day: d, sec: 900, set: false, counted: true, pocket: false, ...o })
const withLog = (log: SessionDay[], before = 0): Progress => ({ ...newProgress(), sessions: { log, before } })
const L80 = lesson({ id: 't80', bpm: 80, type: 'notes' })

/** A cold attempt at session s: speed 1 by default (the cold target). */
function cold(r0: LessonRecord, s: number, clean: boolean, speed = 1, l = L80) {
  const r = rec({ ...r0, hist: r0.hist?.map((h) => ({ ...h })) })
  const out = applyCold(r, l, result({ bpm: Math.round(l.bpm * speed), speed, score: clean ? 95 : 50, at: 1000 + s }), s, `2026-11-${String(s).padStart(2, '0')}`, clean)
  return { rec: r, ...out }
}

describe('session numbers', () => {
  it('pocket-only and short days do not advance the number; counted days do; before adds', () => {
    const p = withLog([day('2026-11-02'), day('2026-11-03', { counted: false, pocket: true, sec: 300 }), day('2026-11-04', { counted: false, sec: 599 }), day('2026-11-05')], 10)
    expect(sessionOf(p, '2026-11-02')).toBe(11)
    expect(sessionOf(p, '2026-11-03')).toBe(12)
    expect(sessionOf(p, '2026-11-04')).toBe(12)
    expect(sessionOf(p, '2026-11-05')).toBe(12)
    expect(sessionOf(p, '2026-11-06')).toBe(13)
    expect(sessionNow(p, at('2026-11-06'))).toBe(13)
    expect(sessionNow(newProgress(), at('2026-11-06'))).toBe(1)
  })
})

describe('intervals', () => {
  it('first pass: due next session; clean colds: 2, 4, 8, then 8 again; a failed one steps back; floor 1', () => {
    expect(firstReview(5)).toEqual({ step: 0, due: 6, coldPasses: 0, lastColdS: 0, learned: false })
    let r = rec({ passedAt: 1, review: firstReview(1) })
    const gaps: number[] = []
    for (const s of [2, 4, 8, 16, 24]) {
      const o = cold(r, s, true, 0.9)
      gaps.push(o.review.due - s)
      r = o.rec
    }
    expect(gaps).toEqual([2, 4, 8, 8, 8])
    const f = cold(r, 32, false)
    expect(f.review.due - 32).toBe(4)
    let g = f.rec
    for (const s of [36, 37, 38]) g = cold(g, s, false).rec
    expect(g.review!.step).toBe(0)
    expect(g.review!.due).toBe(38 + SESSION_GAPS[0])
  })
})

describe('learned', () => {
  it('clean cold at the target in 2 separate sessions; the same session twice does not count', () => {
    let r = rec({ passedAt: 1, review: firstReview(1) })
    r = cold(r, 2, true).rec
    expect(r.review).toMatchObject({ coldPasses: 1, lastColdS: 2, learned: false })
    const same = cold(r, 2, true)
    expect(same.review.coldPasses).toBe(1)
    const o = cold(r, 4, true)
    expect(o.review).toMatchObject({ coldPasses: LEARN_SESSIONS, learned: true, learnedAt: 1004 })
    expect(o.xp.map((x) => x.label)).toContain('Learned')
    expect(o.lines.some((l) => l.endsWith('is learned: clean from cold at full tempo in two separate sessions.'))).toBe(true)
  })

  it('a clean cold below the target lengthens the interval but does not count', () => {
    const o = cold(rec({ passedAt: 1, review: firstReview(1) }), 2, true, 0.9)
    expect(o.review).toMatchObject({ step: 1, coldPasses: 0, lastColdS: 0, learned: false })
  })

  it('a failed cold resets cold passes and learned', () => {
    const learned: ReviewState = { step: 3, due: 10, coldPasses: 2, lastColdS: 6, learned: true, learnedAt: 5 }
    const o = cold(rec({ passedAt: 1, review: learned }), 10, false)
    expect(o.review).toMatchObject({ step: 2, coldPasses: 0, learned: false, due: 14 })
    expect(o.review.learnedAt).toBeUndefined()
  })
})

describe('return to review', () => {
  const lastBest = (best: number): LessonRecord => rec({ passedAt: 1, review: { step: 2, due: 5, coldPasses: 1, lastColdS: 3, learned: false }, hist: [{ s: 4, d: '2026-11-04', best }] })

  it('best 80 BPM last session, clean cold 68: back to step 0, not learned', () => {
    const o = cold(lastBest(80), 5, true, 68 / 80)
    expect(o.review).toMatchObject({ step: 0, learned: false, coldPasses: 0, due: 6 })
    expect(o.lines.some((l) => l.includes('goes back to review: cold 68 BPM, 12 BPM under your best'))).toBe(true)
  })

  it('clean cold 71: no reset', () => {
    const o = cold(lastBest(80), 5, true, 71 / 80)
    expect(o.review.step).toBe(3)
  })
})

describe('cold speed staircase', () => {
  it('a failed cold at 0.9 on an 80 BPM lesson: next cold test at 0.82', () => {
    expect(tempoStep(L80)).toBe(0.04)
    const o = cold(rec({ passedAt: 1, review: firstReview(1) }), 2, false, 0.9)
    expect(o.review.coldSpeed).toBe(0.82)
    expect(coldSpeedFor(L80, o.rec)).toBe(0.82)
  })

  it('a clean cold clears it, and the next test uses the newest in-session best', () => {
    const r = rec({ passedAt: 1, review: { ...firstReview(1), coldSpeed: 0.82 }, hist: [{ s: 1, d: '2026-11-01', best: 72 }] })
    const o = cold(r, 2, true, 0.82)
    expect(o.review.coldSpeed).toBeUndefined()
    expect(coldSpeedFor(L80, o.rec)).toBe(0.9) // 72 / 80
    o.rec.hist![1].best = 76 // later that session, a clean run at 76
    expect(coldSpeedFor(L80, o.rec)).toBe(0.95)
    expect(coldSpeedFor(L80, rec({ topSpeed: 0.85 }))).toBe(0.85)
    expect(coldSpeedFor(L80, undefined)).toBe(0.85)
  })
})

describe('retentionGap', () => {
  it('the gap and the one before it over two cold tests', () => {
    const hist: HistEntry[] = [
      { s: 1, d: '2026-11-01', best: 80 },
      { s: 2, d: '2026-11-03', best: 82, cold: { s: 2, d: '2026-11-03', bpm: 70, speed: 0.88, clean: true, score: 92, tab: 'faded' } },
      { s: 3, d: '2026-11-05', cold: { s: 3, d: '2026-11-05', bpm: 76, speed: 0.95, clean: true, score: 94, tab: 'hidden' } },
    ]
    expect(retentionGap(rec({ hist }))).toEqual({ best: 82, cold: 76, gap: 6, prevGap: 10, coldClean: true })
    const failed = [...hist, { s: 4, d: '2026-11-07', cold: { s: 4, d: '2026-11-07', bpm: 80, speed: 1, clean: false, score: 40, tab: 'hidden' as const } }]
    expect(retentionGap(rec({ hist: failed }))).toMatchObject({ gap: 6, coldClean: false })
    expect(retentionGap(undefined)).toEqual({ best: null, cold: null, gap: null, prevGap: null, coldClean: null })
  })

  it('a shrinking gap pays XP and says so', () => {
    const r = rec({
      passedAt: 1,
      review: { step: 1, due: 3, coldPasses: 0, lastColdS: 0, learned: false },
      hist: [
        { s: 1, d: '2026-11-01', best: 80 },
        { s: 2, d: '2026-11-02', best: 80, cold: { s: 2, d: '2026-11-02', bpm: 70, speed: 0.88, clean: true, score: 92, tab: 'faded' } },
      ],
    })
    const o = cold(r, 3, true, 0.95)
    expect(o.xp.map((x) => [x.label, x.value])).toEqual([
      ['Cold start passed', '+15'],
      ['Cold tempo up', '+18'],
      ['Gap shrinking', '+10'],
    ])
    expect(o.lines).toEqual(['Cold tempo on Test is up 6 BPM.', 'Retention gap on Test: 10 → 4 BPM. The tempo is sticking.'])
  })

  it('history keeps the newest HIST_MAX sessions', () => {
    let r = rec({ passedAt: 1, review: firstReview(0) })
    for (let s = 1; s <= HIST_MAX + 4; s++) r = cold(r, s, true, 0.8).rec
    expect(r.hist).toHaveLength(HIST_MAX)
    expect(r.hist![0].s).toBe(5)
  })
})

describe('isCold', () => {
  const base = () => {
    const p = withLog([day('2026-11-02')])
    p.lessons['w1-02'] = rec({ passedAt: 1, plays: 3, playsDay: '2026-11-02', playsToday: 2, review: firstReview(1) })
    return p
  }

  it('due and the first play today', () => {
    expect(isCold(base(), 'w1-02', at('2026-11-04'))).toBe(true)
    expect(isCold(base(), 'w1-02', at('2026-11-02'))).toBe(false) // session 1: not due yet, and played
  })

  it('not after a run or a clean loop today', () => {
    const p = base()
    p.lessons['w1-02'].playsDay = '2026-11-04'
    p.lessons['w1-02'].playsToday = 1
    expect(isCold(p, 'w1-02', at('2026-11-04'))).toBe(false)
    const q = base()
    q.lessons['w1-02'].loopDay = '2026-11-04'
    expect(isCold(q, 'w1-02', at('2026-11-04'))).toBe(false)
  })

  it('never for improv or sync', () => {
    expect(isReviewItem(lessonById('w2-05')!)).toBe(false)
    expect(isReviewItem(lessonById('w1-01')!)).toBe(false)
    const p = base()
    p.lessons['w2-05'] = rec({ passedAt: 1, review: firstReview(1) })
    expect(isCold(p, 'w2-05', at('2026-11-04'))).toBe(false)
  })
})

describe('weeks', () => {
  it('a Sunday maps to the Monday before it', () => {
    expect(weekKey('2026-11-08')).toBe('2026-11-02')
    expect(weekKey('2026-11-02')).toBe('2026-11-02')
    expect(weekKey('2026-11-09')).toBe('2026-11-09')
  })

  it('the week in progress never breaks the streak; a missed week resets it to 0 and nothing else', () => {
    // Weeks of Oct 19 and Oct 26: 3 sessions each. Week of Nov 2: 1 so far.
    const log = ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-28', '2026-10-30', '2026-11-03'].map((d) => day(d))
    const p = { ...withLog(log), weekGoal: 3 }
    const ws = weekStatus(p, at('2026-11-04'))
    expect(ws).toMatchObject({ week: '2026-11-02', done: 1, goal: 3, streak: 2 })
    expect(ws.counts.slice(-3)).toEqual([3, 3, 1])
    expect(ws.met.slice(-3)).toEqual([true, true, false])
    expect(ws.counts).toHaveLength(8)
    // Two more this week: met, the streak grows to 3.
    const met = { ...p, sessions: { log: [...log, day('2026-11-04'), day('2026-11-05')], before: 0 } }
    expect(weekStatus(met, at('2026-11-05')).streak).toBe(3)
    // The next week passes with nothing: 0, and the log is untouched.
    expect(weekStatus(p, at('2026-11-12')).streak).toBe(0)
    expect(p.sessions.log).toHaveLength(7)
  })

  it('past weeks keep the goal they had: changing the goal never erases or invents a streak', () => {
    // Two past weeks met at goal 3 (stored on the days); this week 1 so far.
    const log = ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-28', '2026-10-30'].map((d) => day(d, { goal: 3 }))
    const p = withLog([...log, day('2026-11-03')])
    const raised = { ...p, weekGoal: 4 }
    const ws = weekStatus(raised, at('2026-11-04'))
    expect(ws.streak).toBe(2)
    expect(ws.met.slice(-3)).toEqual([true, true, false])
    // Two-session weeks judged at goal 3 stay missed when the goal is lowered to 2.
    const two = ['2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28'].map((d) => day(d, { goal: 3 }))
    const lowered = { ...withLog(two), weekGoal: 2 }
    expect(weekStatus(lowered, at('2026-11-04')).streak).toBe(0)
    // A week recorded as met stays met.
    expect(weekStatus({ ...lowered, weekXp: ['2026-10-19', '2026-10-26'] }, at('2026-11-04')).streak).toBe(2)
  })
})
