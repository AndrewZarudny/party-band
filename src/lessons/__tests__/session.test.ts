import { describe, expect, it } from 'vitest'
import type { LessonRecord, LoopSummary, Progress, SessionDay, SessionMin, SessionPlan, StepKind, WeekShape } from '../types'
import type { SkillEntry } from '../../skills/data'
import { emptyStats } from '../../skills/data'
import {
  TEMPLATES,
  ctxDefault,
  knownChords,
  makeSessionPlan,
  markPocket,
  planAfterLoop,
  planAfterRun,
  planAfterSkill,
  planDone,
  planMinutes,
  planStarted,
  setPain,
  shapeFor,
  skipStep,
  swapOptions,
  swapStep,
  withSessionDay,
  withSessionMin,
  withTodayPlan,
} from '../session'
import { newProgress } from '../progress'
import { firstReview } from '../review'
import { dayNum } from '../heat'
import { at, rec, result } from './fixtures'

const NOW = at('2026-11-04') // a Wednesday; the week starts on Monday 2026-11-02
const ctx = ctxDefault()
const day = (d: string, o: Partial<SessionDay> = {}): SessionDay => ({ day: d, sec: 900, set: false, counted: true, pocket: false, ...o })
const passed = (o: Partial<LessonRecord> = {}) => rec({ passedAt: 1, plays: 3, stars: 2, best: 85, playsDay: '2026-10-01', lastPlayed: at('2026-10-01').getTime(), ...o })
const kinds = (p: Progress) => p.plan?.steps.map((s) => s.kind) ?? []
const entry = (game: SkillEntry['game'], score = 10, detail?: string): SkillEntry => ({ id: `${game}-${score}`, game, at: 1, score, ...(detail ? { detail } : {}) })

/** Tap In done, World 1 passed (passed before the clean-run trainer: it counts as an earned tempo), Spider Walk earned. */
function base(log: SessionDay[] = []): Progress {
  const p = newProgress()
  p.lessons['w1-01'] = rec({ plays: 1, passedAt: 1 })
  for (const id of ['w1-02', 'w1-03', 'w1-05', 'w1-04']) p.lessons[id] = passed()
  p.lessons['w2-01'] = passed({ topSpeed: 0.9, hist: [] })
  p.sessions = { log, before: 0 }
  return p
}
const plan = (p: Progress, now = NOW, c = ctx) => ({ ...p, plan: makeSessionPlan(p, now, c) })

describe('templates and the week', () => {
  it('every template sums to its session length', () => {
    for (const min of [20, 30] as SessionMin[])
      for (const shape of ['A', 'B', 'C', 'D'] as WeekShape[]) expect(TEMPLATES[min][shape].reduce((a, [, m]) => a + m, 0)).toBe(min)
  })

  it('the shape follows counted sessions this week before today: A, B, C, D, D', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']
    const today = at('2026-11-06')
    const shapes = [0, 1, 2, 3, 4].map((n) => shapeFor(base(days.slice(0, n).concat(n === 4 ? ['2026-11-05'] : []).map((d) => day(d))), n === 4 ? at('2026-11-07') : today))
    expect(shapes).toEqual(['A', 'B', 'C', 'D', 'D'])
    // A pocket day and last week's sessions don't count.
    expect(shapeFor(base([day('2026-10-30'), day('2026-11-02', { counted: false, pocket: true })]), NOW)).toBe('A')
  })

  it('plans fill the session length (spare minutes go to guided work, else the session is shorter), listen-back included', () => {
    const guided = (pl: SessionPlan) => pl.steps.some((s) => ['new', 'changes', 'ear', 'mix'].includes(s.kind))
    const fits = (pl: SessionPlan, min: number) => (guided(pl) ? expect(planMinutes(pl)).toBe(min) : expect(planMinutes(pl)).toBeLessThanOrEqual(min))
    for (const min of [20, 30] as SessionMin[])
      for (const log of [[], [day('2026-11-02')], [day('2026-11-02'), day('2026-11-03')], [day('2026-11-01'), day('2026-11-02'), day('2026-11-03')]]) {
        const p = { ...base(log), sessionMin: min }
        fits(makeSessionPlan(p, NOW, ctx), min)
        const lb = makeSessionPlan(p, NOW, { ...ctx, unratedTake: true })
        fits(lb, min)
        expect(lb.steps[1]).toMatchObject({ kind: 'listenback', min: 1, skill: { game: 'record' } })
      }
  })

  it('a brand-new player gets Tap In alone; a plan is made once per day', () => {
    const f = withTodayPlan(newProgress(), NOW, ctx)!
    expect(f.plan!.steps.map((s) => [s.kind, s.lessonId])).toEqual([['new', 'w1-01']])
    expect(f.plan).toMatchObject({ v: 2, day: '2026-11-04', min: 30, shape: 'A' })
    const real = withTodayPlan({ ...f, lessons: { 'w1-01': rec({ plays: 1 }) } }, NOW, ctx)!
    expect(real.plan!.steps.length).toBeGreaterThan(1)
    expect(withTodayPlan(real, NOW, ctx)).toBeNull()
  })
})

describe('new material: block, then interleave', () => {
  it('A has a new step; B and D never do', () => {
    const a = plan(base())
    // The 12-week plan's first fortnight comes first: Light Touch is passed, so Downstroke Lock is next.
    expect(a.plan.steps.find((s) => s.kind === 'new')).toMatchObject({ lessonId: 'w3-06', why: 'Practise it on its own. Rest 20–30 s between runs.' })
    const b = plan(base([day('2026-11-02')]))
    expect(b.plan.shape).toBe('B')
    expect(kinds(b)).not.toContain('new')
    const d = plan(base([day('2026-11-02'), day('2026-11-03'), day('2026-11-04')]), at('2026-11-05'))
    expect(d.plan.shape).toBe('D')
    expect(kinds(d)).not.toContain('new')
  })

  const cWeek = () => base([day('2026-11-02'), day('2026-11-03')]) // sessions 1 and 2; today is session 3, shape C

  it('C: new only when fewer than 2 new items this week and the last one has an earned tempo', () => {
    const p = cWeek()
    p.lessons['w2-01'].firstS = 2
    const ok = plan(p)
    expect(ok.plan.shape).toBe('C')
    expect(ok.plan.steps.find((s) => s.kind === 'new')).toMatchObject({ lessonId: 'w3-06' })
    expect(ok.plan.steps.find((s) => s.kind === 'new')!.consolidate).toBeUndefined()
  })

  it('C: two new items this week, the last not earned yet: the same one again, blocked', () => {
    const p = cWeek()
    p.lessons['w2-01'].firstS = 1
    p.lessons['w2-02'] = rec({ plays: 4, firstS: 2, lastPlayed: 2 })
    const c = plan(p).plan.steps.find((s) => s.kind === 'new')
    expect(c).toMatchObject({ lessonId: 'w2-02', consolidate: true })
  })

  it('C: two new items this week, both earned: no new step, it is mixed instead', () => {
    const p = cWeek()
    p.lessons['w2-02'] = passed({ firstS: 1, topSpeed: 0.85, hist: [] })
    p.lessons['w2-03'] = passed({ firstS: 2, topSpeed: 0.85, hist: [] })
    const k = kinds(plan(p))
    expect(k).not.toContain('new')
    expect(k.filter((x) => x === 'mix').length).toBeGreaterThanOrEqual(1)
  })
})

describe('cold starts', () => {
  const due = () => {
    const p = base([day('2026-11-02')]) // today is session 2, shape B (two cold steps at 30 min)
    p.lessons['w1-02'].review = { ...firstReview(1), due: 2 }
    p.lessons['w1-03'].review = { ...firstReview(0), coldPasses: 1 }
    p.lessons['w1-05'].review = firstReview(0)
    p.lessons['w1-04'].review = { ...firstReview(0), due: 9 }
    return p
  }

  it('picks due items: soonest due, then fewest cold passes, then map order', () => {
    const steps = plan(due()).plan.steps.filter((s) => s.kind === 'cold')
    expect(steps.map((s) => s.lessonId)).toEqual(['w1-05', 'w1-03'])
    expect(steps[0].why).toMatch(/^First try, no warm-up, no tab\. \d+ BPM\.$/)
  })

  it('learned items get the quick-check line', () => {
    const p = due()
    p.lessons['w1-05'].review = { ...firstReview(0), learned: true, coldPasses: 2 }
    expect(plan(p).plan.steps.find((s) => s.lessonId === 'w1-05')!.why).toBe('Learned. A quick check that it still sticks.')
  })

  it('no due item: no cold step; with only the First Jam taste the jam keeps its minutes and changes gets the rest', () => {
    const p = plan(base([day('2026-11-02')])).plan
    expect(p.steps.some((s) => s.kind === 'cold')).toBe(false)
    expect(p.steps.find((s) => s.kind === 'jam')).toMatchObject({ lessonId: 'w2-05', min: 8 })
    expect(p.steps.find((s) => s.kind === 'changes')!.min).toBe(4 + 6)
    expect(planMinutes(p)).toBe(30)
  })

  it('an open jam lesson takes the spare minutes', () => {
    const b = base([day('2026-11-02')])
    b.lessons['w2-04'] = passed() // World 2 boss: World 3 and more jams open
    b.lessons['w3-04'] = passed()
    b.lessons['w4-04'] = passed()
    b.lessons['w5-06'] = passed()
    b.lessons['w6-05'] = passed()
    b.lessons['w7-04'] = passed()
    const p = plan(b).plan
    const jam = p.steps.find((s) => s.kind === 'jam')!
    expect(jam.lessonId).not.toBe('w2-05')
    expect(jam.min).toBe(8 + 6)
  })

  it('a new player with nothing due: spare minutes go to the new item, not the jam', () => {
    const p = plan(base()).plan // A: warm-up, cold (none due), new, changes, ear, jam
    expect(p.steps.find((s) => s.kind === 'new')!.min).toBe(8 + 3)
    expect(p.steps.find((s) => s.kind === 'jam')!.min).toBe(10)
  })

  it('only one due: the second cold step is dropped', () => {
    const p = base([day('2026-11-02')])
    p.lessons['w1-03'].review = firstReview(0)
    const steps = plan(p).plan.steps
    expect(steps.filter((s) => s.kind === 'cold').map((s) => s.lessonId)).toEqual(['w1-03'])
    expect(steps.find((s) => s.kind === 'jam')!.min).toBe(8)
    expect(steps.find((s) => s.kind === 'changes')!.min).toBe(4 + 3)
  })

  it('due items stay out of the warm-up and the mix, so the cold step is their first try', () => {
    const p = base([day('2026-11-02')]) // B: two cold slots
    for (const id of ['w1-02', 'w1-03', 'w1-05']) p.lessons[id].review = firstReview(0)
    const steps = plan(p).plan.steps
    const colds = steps.filter((s) => s.kind === 'cold').map((s) => s.lessonId)
    expect(colds).toEqual(['w1-02', 'w1-03'])
    const warm = steps.find((s) => s.kind === 'warmup')!
    expect(['w1-02', 'w1-03', 'w1-05']).not.toContain(warm.lessonId)
    // w1-05 is due too but has no cold slot today: it waits, it isn't mixed in warm
    for (const s of steps) expect(s.items ?? []).not.toContain('w1-05')
  })

  it('a drill on a due item is skipped; a drill on another item keeps that lesson out of the cold and mix steps', () => {
    const d = dayNum(NOW)
    const cell = (l: string, n = 30, bad = 18, wrong = 15) => ({ n, bad, wrong, early: 0, late: 0, err: 0, d, l })
    const due = base([day('2026-11-02')])
    due.lessons['w1-03'].review = firstReview(0)
    due.heat = { v: 1 as const, cells: { 'n:2.7': cell('w1-03'), 'n:1.3': cell('w1-03', 20, 1, 0) } }
    const a = plan(due).plan.steps
    expect(a[0].drill).toBeUndefined()
    expect(a.find((s) => s.kind === 'cold')!.lessonId).toBe('w1-03')
    const other = base([day('2026-11-02')])
    other.lessons['w1-02'].review = firstReview(0)
    other.heat = { v: 1 as const, cells: { 'n:2.7': cell('w1-03'), 'n:1.3': cell('w1-03', 20, 1, 0) } }
    const b = plan(other).plan.steps
    expect(b[0]).toMatchObject({ kind: 'warmup', drill: 'n:2.7', lessonId: 'w1-03' })
    for (const s of b.slice(1)) {
      expect(s.lessonId).not.toBe('w1-03')
      expect(s.items ?? []).not.toContain('w1-03')
    }
  })
})

describe('mix and skills', () => {
  it('mix takes items with an earned tempo, never today’s warm-up, new or cold items', () => {
    const p = base([day('2026-11-02')]) // B
    p.lessons['w1-03'].review = firstReview(0) // cold today
    const mix = plan(p).plan.steps.find((s) => s.kind === 'mix')!
    expect(mix.items).toEqual(['w1-02', 'w1-05', 'w1-04'])
    expect(mix.why).toMatch(/^[^:]+, .+, .+\. One run each, in turn\.$/)
    expect(mix.played).toEqual([])
  })

  it('items first played this session or without an earned tempo are left out; under 2 left, ear (changes is already in)', () => {
    const p = base([day('2026-11-02')])
    for (const id of ['w1-02', 'w1-03', 'w1-05']) p.lessons[id] = passed({ hist: [], firstS: 1 })
    p.lessons['w1-04'] = passed({ topSpeed: 1, hist: [], firstS: 2 }) // first played this session
    const k = plan(p).plan.steps.map((s) => s.kind)
    expect(k).not.toContain('mix')
    expect(k.filter((x) => x === 'ear')).toHaveLength(2)
  })

  it('changes uses the weakest pair of known chords; no pair: fretboard notes', () => {
    const p = base()
    p.lessons['w3-09'] = passed()
    const stats = { ...emptyStats(), best: { 'changes:A-D': 30, 'A-E': 0, 'changes:A-E': 20, 'changes:D-E': 40 } }
    const ch = makeSessionPlan(p, NOW, { unratedTake: false, stats }).steps.find((s) => s.kind === 'changes')!
    expect(ch.skill).toEqual({ game: 'changes', pair: 'A-E' })
    expect(ch.why).toBe('One-minute changes: A-E. Your best: 20. Retire it at 60.')
    const none = plan(base()).plan.steps.find((s) => s.kind === 'changes')!
    expect(none).toMatchObject({ skill: { game: 'find' }, why: 'Fretboard notes: find each note fast.' })
  })

  it('knownChords follows passed lessons, in CHANGE_CHORDS order', () => {
    const p = newProgress()
    expect(knownChords(p)).toEqual([])
    p.lessons['w3-09'] = passed()
    p.lessons['w3-02'] = passed()
    p.lessons['w3-10'] = passed()
    // Backbeat Scratch teaches E5 only; A5 comes with Downstroke Lock.
    expect(knownChords(p)).toEqual(['E', 'A', 'D', 'A7', 'D7', 'E7', 'E5'])
    p.lessons['w3-06'] = passed()
    expect(knownChords(p)).toEqual(['E', 'A', 'D', 'A7', 'D7', 'E7', 'E5', 'A5', 'D5'])
  })
})

describe('ticking steps', () => {
  it('runs and skill rounds tick their steps; a finished plan marks the day set and counted', () => {
    let p: Progress = plan(base())
    const steps = p.plan!.steps
    expect(steps.map((s) => s.kind)).toEqual(['warmup', 'new', 'changes', 'ear', 'jam'] satisfies StepKind[])
    let finished = 0
    for (const s of steps) {
      const r = s.lessonId ? planAfterRun(p, s.lessonId, result({ lessonId: s.lessonId, score: 80 }), NOW) : planAfterSkill(p, entry(s.skill!.game === 'find' ? 'find' : 'ear'), NOW)
      finished += r.finished ? 1 : 0
      p = r.progress
    }
    expect(finished).toBe(1)
    expect(planDone(p.plan!)).toBe(true)
    const sd = withSessionDay(p, NOW, 0)
    expect(sd.progress.sessions.log[0]).toMatchObject({ day: '2026-11-04', set: true, counted: true, min: 30, shape: 'A' })
  })

  it('a mix step is done after one run of 2 items; a rating ticks listen back; a changes pair must match', () => {
    const b = base([day('2026-11-02')])
    let p: Progress = plan(b, NOW, { unratedTake: true, stats: { ...emptyStats() } })
    const mi = p.plan!.steps.findIndex((s) => s.kind === 'mix')
    const items = p.plan!.steps[mi].items!
    p = planAfterRun(p, items[0], result({ lessonId: items[0] }), NOW).progress
    expect(p.plan!.steps[mi]).toMatchObject({ state: 'todo', played: [items[0]] })
    p = planAfterRun(p, items[1], result({ lessonId: items[1] }), NOW).progress
    expect(p.plan!.steps[mi].state).toBe('done')
    expect(planAfterSkill(p, entry('rate', 4), NOW).progress.plan!.steps.find((s) => s.kind === 'listenback')!.state).toBe('done')
    const q = { ...base(), lessons: { ...base().lessons, 'w3-09': passed() } }
    const qp = plan(q)
    const ci = qp.plan.steps.findIndex((s) => s.kind === 'changes')
    expect(planAfterSkill(qp, entry('changes', 30, 'D-E'), NOW).progress.plan!.steps[ci].state).toBe('todo')
    expect(planAfterSkill(qp, entry('changes', 30, qp.plan.steps[ci].skill?.game === 'changes' ? qp.plan.steps[ci].skill.pair : ''), NOW).progress.plan!.steps[ci].state).toBe('done')
  })

  it('a drill loop ticks only the drill step', () => {
    const d = dayNum(NOW)
    const cell = (n: number, bad: number, wrong: number) => ({ n, bad, wrong, early: 0, late: 0, err: 0, d, l: 'w1-03' })
    const p = { ...base(), heat: { v: 1 as const, cells: { 'n:2.7': cell(30, 18, 15), 'n:1.3': cell(20, 1, 0) } } }
    const q = plan(p)
    expect(q.plan.steps[0]).toMatchObject({ kind: 'warmup', drill: 'n:2.7', lessonId: 'w1-03' })
    const s = { passes: [{ speed: 0.85, acc: 0.5, clean: false }, { speed: 0.9, acc: 0.95, clean: true }], clean: 1, topSpeed: 0.9 } as LoopSummary
    expect(planAfterLoop(q, 'n:2.7', s, NOW).progress.plan!.steps[0]).toMatchObject({ state: 'done', score: 95, speed: 0.9 })
    expect(planAfterRun(q, 'w1-03', result({ lessonId: 'w1-03' }), NOW).progress.plan!.steps[0].state).toBe('todo')
  })

  it('swap and skip', () => {
    const p = plan(base())
    const ni = p.plan.steps.findIndex((s) => s.kind === 'new')
    const opts = swapOptions(p, ni, NOW)
    expect(opts).toEqual(['w2-02', 'w2-04']) // after the plan's lessons, map order; w2-03 waits for w2-02
    expect(swapStep(p, ni, NOW).plan!.steps[ni].lessonId).toBe('w2-02')
    expect(swapOptions(p, p.plan.steps.findIndex((s) => s.kind === 'changes'), NOW)).toEqual([])
    const sk = skipStep(p, 0)
    expect(sk.plan!.steps[0].state).toBe('skipped')
    expect(skipStep(sk, 0).plan!.steps[0].state).toBe('todo')
  })
})

describe('the session log', () => {
  it('600 s counts, 599 s does not, a pocket session does not; no-ops do not change anything', () => {
    const p = base()
    const short = withSessionDay(p, NOW, 599)
    expect(short).toMatchObject({ changed: true, counted: false })
    expect(withSessionDay(short.progress, NOW, 599).changed).toBe(false)
    expect(withSessionDay(short.progress, NOW, 600)).toMatchObject({ changed: true, counted: true })
    const pocket = markPocket(p, NOW)
    expect(pocket.sessions.log[0]).toMatchObject({ pocket: true, counted: false })
    expect(withSessionDay(pocket, NOW, 120).counted).toBe(false)
    expect(setPain(pocket, NOW, 'mild').sessions.log[0]).toMatchObject({ pocket: true, pain: 'mild' })
  })

  it('the week goal is a marker, not XP: met once per week, the goal stored with the day', () => {
    const p = { ...base([day('2026-11-02'), day('2026-11-03')]), xp: 100 }
    const met = withSessionDay(p, NOW, 700)
    expect(met).toMatchObject({ weekMet: true })
    expect(met.progress.xp).toBe(100)
    expect(met.progress.weekXp).toEqual(['2026-11-02'])
    expect(met.progress.sessions.log.find((d) => d.day === '2026-11-04')).toMatchObject({ counted: true, goal: 3 })
    const more = withSessionDay(met.progress, at('2026-11-05'), 900)
    expect(more).toMatchObject({ counted: true, weekMet: false })
    expect(more.progress.xp).toBe(100)
  })

  it('a new session length remakes today\'s plan until a step is done, then waits for the next session', () => {
    const p = plan(base())
    const fresh = withSessionMin(p, 20, NOW)
    expect(fresh).toMatchObject({ sessionMin: 20, plan: null })
    expect(withTodayPlan(fresh, NOW, ctx)!.plan).toMatchObject({ min: 20 })
    const started = planAfterSkill(p, entry('find'), NOW).progress
    expect(planStarted(started, NOW)).toBe(true)
    const later = withSessionMin(started, 20, NOW)
    expect(later.sessionMin).toBe(20)
    expect(later.plan).toBe(started.plan)
    expect(withSessionMin(p, 30, NOW)).toBe(p)
  })
})
