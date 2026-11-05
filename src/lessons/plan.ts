// Today's set: a short daily practice plan (warm-up, what's due for review, one new lesson, a jam).
// One set per practice day, stored in progress.plan. Every function is pure and returns new objects.
import type { DayPlan, LessonResult, LoopSummary, PlanKind, PlanStep, Progress } from './types'
import { WORLDS, lessonById } from './data'
import { dayKey, daysBetween, isPassed, isUnlocked, reviewDue } from './progress'
import { autoSpeed, pct } from './speed'
import { heatReady, spotLabel, topSpots } from './heat'

export const PLAN_BONUS = 50
const DRILL_MIN_SCORE = 0.2
export const WARMUPS = ['w1-02', 'w2-01', 'w5-01', 'w5-03']
export const KIND_LABEL: Record<PlanKind, string> = { warmup: 'Warm-up', review: 'Review', new: 'New', jam: 'Jam' }

const SYNC_ID = 'w1-01'
const TASTE_ID = 'w2-05' // First Jam: the World 1 taste of playing over a band
const MINUTES: Record<PlanKind, number> = { warmup: 2, review: 2, new: 5, jam: 4 }

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** Every lesson id in map order. */
const ORDER = WORLDS.flatMap((w) => w.lessons)
const isSync = (id: string) => lessonById(id)?.type === 'sync'
/** Tap In was played or skipped: the real set can start. */
const syncDone = (p: Progress) => (p.lessons[SYNC_ID]?.plays ?? 0) >= 1
/** The set made before Tap In: one Tap In step, replaced once Tap In is done. */
const setupOnly = (plan: DayPlan) => plan.steps.length > 0 && plan.steps.every((s) => isSync(s.lessonId))

/** Due reviews first (stars up, most overdue first, map order), then passed lessons to polish (fewest stars first). */
function reviewLists(p: Progress, today: string): { due: string[]; polish: string[] } {
  const passed = ORDER.filter((id) => !isSync(id) && isPassed(p, id))
  const due = passed
    .map((id, i) => ({ id, i, rec: p.lessons[id], over: reviewDue(p.lessons[id], today) }))
    .filter((x) => x.over !== null)
    .sort((a, b) => a.rec.stars - b.rec.stars || (b.over ?? 0) - (a.over ?? 0) || a.i - b.i)
    .map((x) => x.id)
  const polish = passed
    .filter((id) => p.lessons[id].stars < 3 && !due.includes(id))
    .map((id, i) => ({ id, i, stars: p.lessons[id].stars }))
    .sort((a, b) => a.stars - b.stars || a.i - b.i)
    .map((x) => x.id)
  return { due, polish }
}

/** All lessons that fit a step of this kind, best first. Used steps are filtered by the caller. */
function candidates(p: Progress, kind: PlanKind, today: string): string[] {
  if (kind === 'new') {
    if (!syncDone(p)) return [SYNC_ID]
    const open = ORDER.filter((id) => !isSync(id) && isUnlocked(p, id) && !isPassed(p, id))
    if (open.length) return open
    // Everything open is passed: go back for stars.
    return ORDER.filter((id) => !isSync(id) && isPassed(p, id) && p.lessons[id].stars < 3)
      .map((id, i) => ({ id, i, stars: p.lessons[id].stars }))
      .sort((a, b) => a.stars - b.stars || a.i - b.i)
      .map((x) => x.id)
  }
  if (kind === 'warmup') {
    const passed = WARMUPS.filter((id) => isPassed(p, id)).reverse()
    return passed.length ? passed : WARMUPS.filter((id) => isUnlocked(p, id))
  }
  if (kind === 'review') {
    const { due, polish } = reviewLists(p, today)
    return [...due, ...polish]
  }
  // Jam: the furthest open improv lesson first; none open yet = a taste of First Jam.
  const jams = ORDER.filter((id) => lessonById(id)?.type === 'improv' && isUnlocked(p, id)).reverse()
  return jams.length ? jams : [TASTE_ID]
}

/** The one-line reason a lesson is in today's set. */
function whyFor(p: Progress, kind: PlanKind, id: string, today: string): string {
  const rec = p.lessons[id]
  if (kind === 'warmup') return 'Loosen up your hands.'
  if (kind === 'review') {
    const at = rec?.lastPass ?? rec?.passedAt
    if (rec && at !== undefined && reviewDue(rec, today) !== null) {
      const n = daysBetween(dayKey(new Date(at)), today)
      return `Passed ${n} day${n === 1 ? '' : 's'} ago. Time to check it.`
    }
    return 'Go for one more star.'
  }
  if (kind === 'new') {
    if (isSync(id)) return 'Set up your timing first.'
    return isPassed(p, id) ? 'Go for 3 stars.' : 'Next on your map.'
  }
  // The World 1 taste: no fretted notes learned yet, so point at the easy spots.
  return isUnlocked(p, id) ? 'Free play with the band.' : 'A taste of World 2: free play with the band. A is the open A string, C is G string fret 5.'
}

function makeStep(p: Progress, kind: PlanKind, id: string, min: number, today: string): PlanStep {
  const rec = p.lessons[id]
  const lesson = lessonById(id)
  return {
    kind,
    lessonId: id,
    min,
    state: 'todo',
    why: whyFor(p, kind, id, today),
    from: { best: rec?.best ?? 0, stars: rec?.stars ?? 0, speed: lesson ? autoSpeed(lesson, rec) : 1, loops: rec?.loops ?? 0 },
  }
}

/** Today's drill warm-up: the top trouble spot, once there is enough data and its lesson still exists. */
function drillPick(p: Progress, now: Date): { key: string; lessonId: string; why: string } | null {
  if (!heatReady(p.heat, now)) return null
  const s = topSpots(p.heat, now, 1)[0]
  if (!s || s.score < DRILL_MIN_SCORE || !lessonById(s.lessonId)) return null
  return { key: s.key, lessonId: s.lessonId, why: `Your top trouble spot: ${spotLabel(s.key)}.` }
}

/** A fresh set for `now`'s practice day. */
export function makePlan(p: Progress, now: Date): DayPlan {
  const today = dayKey(now)
  const used = new Set<string>()
  const pick = (kind: PlanKind, n = 1) => {
    const ids = candidates(p, kind, today).filter((id) => !used.has(id))
    // Polish only lessons not played today.
    const fresh = kind === 'review' ? ids.filter((id) => reviewDue(p.lessons[id], today) !== null || p.lessons[id].playsDay !== today) : ids
    const out = fresh.slice(0, n)
    for (const id of out) used.add(id)
    return out
  }

  // A brand-new player: Tap In first, nothing else.
  if (!syncDone(p)) return { day: today, steps: [makeStep(p, 'new', SYNC_ID, MINUTES.new, today)], bonus: false }

  // New first, so the other steps skip it.
  const newId = pick('new')[0]
  // The top trouble spot replaces the usual warm-up; its lesson can still be today's review or new lesson.
  const drill = drillPick(p, now)
  const warm = drill ? undefined : pick('warmup')[0]
  const { due } = reviewLists(p, today)
  const reviews = pick('review', due.filter((id) => !used.has(id)).length >= 2 ? 2 : 1)
  const jam = pick('jam')[0]

  const steps: PlanStep[] = []
  if (drill) steps.push({ ...makeStep(p, 'warmup', drill.lessonId, MINUTES.warmup, today), drill: drill.key, why: drill.why })
  else if (warm) steps.push(makeStep(p, 'warmup', warm, MINUTES.warmup, today))
  for (const id of reviews) steps.push(makeStep(p, 'review', id, reviews.length === 1 ? 2 * MINUTES.review : MINUTES.review, today))
  if (newId) steps.push(makeStep(p, 'new', newId, MINUTES.new, today))
  if (jam) steps.push(makeStep(p, 'jam', jam, MINUTES.jam, today))
  return { day: today, steps, bonus: false }
}

/** Progress with today's set, or null when the stored set is already today's (no save needed). */
export function withTodayPlan(p: Progress, now: Date): Progress | null {
  const plan = p.plan
  if (plan && plan.day === dayKey(now) && !(setupOnly(plan) && syncDone(p) && !plan.bonus)) return null
  return { ...p, plan: makePlan(p, now) }
}

export function planDone(plan: DayPlan): boolean {
  const done = plan.steps.filter((s) => s.state === 'done').length
  return plan.steps.length > 0 && !plan.steps.some((s) => s.state === 'todo') && done >= Math.min(2, plan.steps.length)
}

/** First todo step, -1 when none. */
export function nextStepIndex(plan: DayPlan): number {
  return plan.steps.findIndex((s) => s.state === 'todo')
}

/** Rough minutes of the steps still in the set (todo and done, not skipped). */
export function planMinutes(plan: DayPlan): number {
  return plan.steps.reduce((a, s) => a + (s.state === 'skipped' ? 0 : s.min), 0)
}

/** Ticks the step for this run; gives the bonus and counts the plan streak when this run finishes the set. */
export function planAfterRun(p: Progress, lessonId: string, r: LessonResult, now: Date): { progress: Progress; finished: boolean; bonus: number } {
  const today = dayKey(now)
  const same = { progress: p, finished: false, bonus: 0 }
  if (!p.plan || p.plan.day !== today) return same
  // Tap In done: the setup set turns into the real one.
  if (setupOnly(p.plan) && !p.plan.bonus && syncDone(p)) return { progress: { ...p, plan: makePlan(p, now) }, finished: false, bonus: 0 }

  const next = clone(p)
  const plan = next.plan as DayPlan
  const step = plan.steps.find((s) => s.lessonId === lessonId && !s.drill)
  if (!step) return same
  return finishStep(next, step, r.score, r.speed, today)
}

/** A drill loop ticks today's drill step: score = its best pass. Same set bonus rule as a run. */
export function planAfterLoop(p: Progress, drillKey: string, s: LoopSummary, now: Date): { progress: Progress; finished: boolean; bonus: number } {
  const today = dayKey(now)
  const same = { progress: p, finished: false, bonus: 0 }
  if (!p.plan || p.plan.day !== today || !s.passes.length) return same
  const next = clone(p)
  const step = (next.plan as DayPlan).steps.find((x) => x.drill === drillKey)
  if (!step) return same
  const score = Math.round(100 * Math.max(...s.passes.map((x) => x.acc)))
  const speed = s.topSpeed || s.passes[s.passes.length - 1].speed
  return finishStep(next, step, score, speed, today)
}

/** Marks `step` (inside `next`) done; gives the bonus and counts the plan streak when it finishes the set. */
function finishStep(next: Progress, step: PlanStep, score: number, speed: number, today: string): { progress: Progress; finished: boolean; bonus: number } {
  const plan = next.plan as DayPlan
  const wasDone = planDone(plan)
  step.state = 'done'
  if (step.score === undefined || score >= step.score) {
    step.score = score
    step.speed = speed
  }
  if (wasDone || plan.bonus || !planDone(plan)) return { progress: next, finished: false, bonus: 0 }

  // The set is finished: a one-off bonus and the plan streak.
  plan.bonus = true
  next.xp += PLAN_BONUS
  if (next.daily.day !== today) next.daily = { day: today, xp: 0, passes: 0 }
  next.daily.xp += PLAN_BONUS
  const ps = next.planStreak
  if (ps.last !== today) {
    ps.days = ps.last && daysBetween(ps.last, today) === 1 ? ps.days + 1 : 1
    ps.last = today
  }
  return { progress: next, finished: true, bonus: PLAN_BONUS }
}

/** Ids of the steps other than i. */
const otherIds = (plan: DayPlan, i: number) => new Set(plan.steps.filter((_, j) => j !== i).map((s) => s.lessonId))

/** Other lesson ids for step i (never one another step already uses). */
export function swapOptions(p: Progress, i: number): string[] {
  const plan = p.plan
  const step = plan?.steps[i]
  if (!plan || !step) return []
  const others = otherIds(plan, i)
  return candidates(p, step.kind, plan.day).filter((id) => id !== step.lessonId && !others.has(id))
}

/** Step i with the next option of its kind, cycling; why and from are refreshed. */
export function swapStep(p: Progress, i: number, now: Date): Progress {
  const plan = p.plan
  const step = plan?.steps[i]
  if (!plan || !step) return p
  const others = otherIds(plan, i)
  const list = candidates(p, step.kind, plan.day).filter((id) => !others.has(id))
  const at = list.indexOf(step.lessonId)
  const id = list[(at + 1) % list.length]
  if (!id || id === step.lessonId) return p
  const next = clone(p)
  const steps = (next.plan as DayPlan).steps
  steps[i] = makeStep(next, step.kind, id, step.min, dayKey(now))
  return next
}

/** Todo <-> skipped. Done steps stay done. */
export function skipStep(p: Progress, i: number): Progress {
  const step = p.plan?.steps[i]
  if (!step || step.state === 'done') return p
  const next = clone(p)
  const s = (next.plan as DayPlan).steps[i]
  s.state = s.state === 'todo' ? 'skipped' : 'todo'
  return next
}

/** What got better in today's done steps: best score, stars, Auto speed. Only real improvements. */
export function improvements(p: Progress, plan: DayPlan): string[] {
  const lines: string[] = []
  for (const s of plan.steps) {
    const rec = p.lessons[s.lessonId]
    const lesson = lessonById(s.lessonId)
    const title = lesson?.title
    if (s.state !== 'done' || !rec || !lesson || !title) continue
    if (rec.best > s.from.best) lines.push(s.from.best > 0 ? `${title}: best ${s.from.best}% → ${rec.best}%` : `${title}: first score ${rec.best}%`)
    if (rec.stars > s.from.stars) {
      const d = rec.stars - s.from.stars
      lines.push(`${title}: +${d} star${d === 1 ? '' : 's'}`)
    }
    const dl = (rec.loops ?? 0) - (s.from.loops ?? 0)
    if (dl > 0) lines.push(`${title}: ${dl} loop${dl === 1 ? '' : 's'} locked in`)
    if (!isSync(s.lessonId)) {
      const sp = autoSpeed(lesson, rec)
      if (sp > s.from.speed) lines.push(`${title}: Auto speed ${pct(s.from.speed)} → ${pct(sp)}`)
    }
  }
  // A drill step shares its lesson with another step at times: say each line once.
  return [...new Set(lines)]
}

/** Plan streak in days; 0 when the last finished set is older than yesterday. */
export function planStreakNow(p: Progress, now: Date): number {
  const { days, last } = p.planStreak
  if (!last || days <= 0) return 0
  return daysBetween(last, dayKey(now)) <= 1 ? days : 0
}
