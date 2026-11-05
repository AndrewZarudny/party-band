// Today's session (research section 4): a 20 or 30 minute template shaped by the week (A/B/C/D),
// cold-start tests first, new material blocked, then mixed in once it has an earned tempo, and a jam to finish.
// One plan per practice day in progress.plan. Every function is pure and returns new objects.
import type { LessonResult, LoopSummary, PainLevel, Progress, SessionDay, SessionMin, SessionPlan, SessionStep, StepKind, WeekShape } from './types'
import type { SkillEntry, SkillStats } from '../skills/data'
import { bestKey, emptyStats } from '../skills/data'
import { CHANGE_CHORDS, weakestPair } from '../skills/chords'
import { WORLDS, lessonById } from './data'
import { PLAN_WEEKS, planWeek } from './weeks'
import { dayKey, daysAway, isPassed, isUnlocked, trimLog } from './progress'
import { autoSpeed, bpmAt, earnedTop } from './speed'
import { heatReady, spotLabel, topSpots } from './heat'
import { SESSION_MIN_SEC, coldSpeedFor, isCold, isReviewItem, sessionNow, sessionOf, weekKey, weekStatus } from './review'

export const WARMUPS = ['w1-02', 'w2-01', 'w5-01', 'w5-03']
export const SHAPE_LABEL: Record<WeekShape, string> = { A: 'New material', B: 'Review and ear', C: 'Consolidate, longer jam', D: 'Mostly jam and recording' }
export const KIND_LABEL: Record<StepKind, string> = {
  warmup: 'Warm-up',
  listenback: 'Listen back',
  cold: 'Cold start',
  new: 'New',
  mix: 'Mixed',
  changes: 'Changes',
  ear: 'By ear',
  jam: 'Jam',
}
export const REST_SEC = 25 // heuristic (research 20–30 s): rest between runs of a new item

export interface PlanCtx {
  unratedTake: boolean
  stats: SkillStats
}

/** Minutes per step (research section 4). Every list sums to the session length. */
export const TEMPLATES: Record<SessionMin, Record<WeekShape, [StepKind, number][]>> = {
  30: {
    A: [['warmup', 2], ['cold', 3], ['new', 8], ['changes', 4], ['ear', 3], ['jam', 10]],
    B: [['warmup', 2], ['cold', 3], ['cold', 3], ['mix', 5], ['changes', 4], ['ear', 5], ['jam', 8]],
    C: [['warmup', 2], ['cold', 3], ['new', 8], ['mix', 4], ['jam', 13]],
    D: [['warmup', 2], ['cold', 3], ['changes', 3], ['jam', 22]],
  },
  // 20 minutes: changes and ear take turns (A has changes, B has ear); C and D give that block to the jam.
  20: {
    A: [['warmup', 2], ['cold', 3], ['new', 6], ['changes', 3], ['jam', 6]],
    B: [['warmup', 2], ['cold', 3], ['mix', 4], ['ear', 5], ['jam', 6]],
    C: [['warmup', 2], ['cold', 3], ['new', 5], ['jam', 10]],
    D: [['warmup', 2], ['cold', 3], ['jam', 15]],
  },
}

const DRILL_MIN_SCORE = 0.2
const SYNC_ID = 'w1-01'
const TASTE_ID = 'w2-05' // First Jam: the World 1 taste of playing over a band

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** Every lesson id in map order. */
const ORDER = WORLDS.flatMap((w) => w.lessons)
const isSync = (id: string) => lessonById(id)?.type === 'sync'
const isImprov = (id: string) => lessonById(id)?.type === 'improv'
/** Tap In was played or skipped: the real plan can start. */
const syncDone = (p: Progress) => (p.lessons[SYNC_ID]?.plays ?? 0) >= 1
/** The plan made before Tap In: one Tap In step, replaced once Tap In is done. */
const setupOnly = (plan: SessionPlan) => plan.steps.length > 0 && plan.steps.every((s) => s.lessonId !== null && isSync(s.lessonId))

/** A plan context with no skill data (tests, and before the skill stats load). */
export const ctxDefault = (): PlanCtx => ({ unratedTake: false, stats: emptyStats() })

// ---- chords you know ----

const CHORDS_BY: [string[], string[]][] = [
  [['w3-02'], ['E5']],
  [['w3-06', 'w4-01'], ['A5', 'E5']],
  [['w3-05'], ['G', 'D', 'C']],
  [['w3-04'], ['Em']],
  [['w3-09'], ['A', 'D', 'E']],
  [['w3-10'], ['A7', 'D7', 'E7']],
  [['w4-02'], ['G5']],
  [['w3-06', 'w4-05'], ['D5']],
]

/** Chords taught by passed lessons, in CHANGE_CHORDS order. */
export function knownChords(p: Progress): string[] {
  const got = new Set<string>()
  for (const [ids, chords] of CHORDS_BY) if (ids.some((id) => isPassed(p, id))) for (const c of chords) got.add(c)
  return CHANGE_CHORDS.filter((c) => got.has(c))
}

// ---- the week ----

const counted = (p: Progress) => (p.sessions?.log ?? []).filter((d) => d.counted)

/** Counted sessions this week before today: 0 → A, 1 → B, 2 → C, 3 or more → D. */
export function shapeFor(p: Progress, now: Date): WeekShape {
  const today = dayKey(now)
  const wk = weekKey(today)
  const n = counted(p).filter((d) => d.day < today && weekKey(d.day) === wk).length
  return (['A', 'B', 'C', 'D'] as const)[Math.min(3, n)]
}

/** Session numbers of this week's counted sessions before today. */
function weekSessionsBefore(p: Progress, now: Date): Set<number> {
  const today = dayKey(now)
  const wk = weekKey(today)
  return new Set(counted(p).filter((d) => d.day < today && weekKey(d.day) === wk).map((d) => sessionOf(p, d.day)))
}

// ---- step choice ----

interface Pick {
  id: string
  why: string
  drill?: string
  consolidate?: boolean
}

/** Today's drill warm-up: the top trouble spot, once there is enough data and its lesson still exists. */
function drillPick(p: Progress, now: Date): Pick | null {
  if (!heatReady(p.heat, now)) return null
  const s = topSpots(p.heat, now, 1)[0]
  if (!s || s.score < DRILL_MIN_SCORE || !lessonById(s.lessonId)) return null
  return { id: s.lessonId, drill: s.key, why: `Your top trouble spot: ${spotLabel(s.key)}.` }
}

/** Warm-ups never use an item due for a cold start: its first try today must be the cold test. */
function warmupList(p: Progress, now: Date): string[] {
  const passed = WARMUPS.filter((id) => isPassed(p, id)).reverse()
  return (passed.length ? passed : WARMUPS.filter((id) => isUnlocked(p, id))).filter((id) => !isCold(p, id, now))
}

/** Due cold-start items: soonest due first, then fewest cold passes, then map order. */
export function coldList(p: Progress, now: Date): string[] {
  return ORDER.map((id, i) => ({ id, i, r: p.lessons[id]?.review }))
    .filter((x) => x.r && isCold(p, x.id, now))
    .sort((a, b) => (a.r?.due ?? 0) - (b.r?.due ?? 0) || (a.r?.coldPasses ?? 0) - (b.r?.coldPasses ?? 0) || a.i - b.i)
    .map((x) => x.id)
}

function coldWhy(p: Progress, id: string): string {
  const lesson = lessonById(id)
  const rec = p.lessons[id]
  if (!lesson) return ''
  if (rec?.review?.learned) return 'Learned. A quick check that it still sticks.'
  return `First try, no warm-up, no tab. ${bpmAt(lesson, coldSpeedFor(lesson, rec))} BPM.`
}

const NEW_WHY = 'Practise it on its own. Rest 20–30 s between runs.'

/**
 * New lessons: first the 12-week plan's lessons up to this fortnight (in plan order), then the rest in map order
 * (open, not passed, not free, not sync); else passed ones to polish, fewest stars first.
 */
function newList(p: Progress, now: Date): { ids: string[]; polish: boolean } {
  const fresh = (id: string) => !isSync(id) && !lessonById(id)?.free && isUnlocked(p, id) && !isPassed(p, id)
  const week = planWeek(p, now)
  const planned = PLAN_WEEKS.filter((w) => w.from <= week).flatMap((w) => w.lessons).filter(fresh)
  const open = [...planned, ...ORDER.filter((id) => fresh(id) && !planned.includes(id))]
  if (open.length) return { ids: open, polish: false }
  const ids = ORDER.filter((id) => !isSync(id) && isPassed(p, id) && p.lessons[id].stars < 3)
    .map((id, i) => ({ id, i, stars: p.lessons[id].stars }))
    .sort((a, b) => a.stars - b.stars || a.i - b.i)
    .map((x) => x.id)
  return { ids, polish: true }
}

/** Has an earned tempo: set by the clean-run trainer, or passed before it existed (no session history). */
const hasEarned = (p: Progress, id: string) => earnedTop(p.lessons[id]) > 0

/**
 * The C-session rule: new material only when this week brought fewer than 2 new items (jams aren't new material)
 * and the newest one has an earned tempo (nothing left to consolidate).
 */
/** Lessons that count as new material: not Tap In, not jams, not the easy warm-ups. */
const isMaterial = (id: string) => !isSync(id) && !isImprov(id) && !WARMUPS.includes(id)

function newAllowedInC(p: Progress, now: Date, s: number): boolean {
  const earlier = weekSessionsBefore(p, now)
  const ids = Object.keys(p.lessons).filter(isMaterial)
  const newThisWeek = ids.filter((id) => earlier.has(p.lessons[id].firstS ?? -1)).length
  return newThisWeek < 2 && consolidatePick(p, s) === null
}

/** The newest item first played in the last 2 sessions that has no earned tempo yet (firstS 0: an old save, never). */
function consolidatePick(p: Progress, s: number): string | null {
  const ids = Object.keys(p.lessons).filter((id) => {
    const rec = p.lessons[id]
    const l = lessonById(id)
    return !!l && isMaterial(id) && rec.firstS !== undefined && rec.firstS >= 1 && rec.firstS >= s - 2 && rec.firstS < s && rec.topSpeed === undefined
  })
  ids.sort((a, b) => (p.lessons[b].firstS ?? 0) - (p.lessons[a].firstS ?? 0) || (p.lessons[b].lastPlayed ?? 0) - (p.lessons[a].lastPlayed ?? 0))
  return ids[0] ?? null
}

/** Mix items: review items with an earned tempo, not first played this session, not due a cold start, newest first. */
function mixList(p: Progress, s: number, used: Set<string>, now: Date): string[] {
  return ORDER.filter((id) => {
    const l = lessonById(id)
    const rec = p.lessons[id]
    return !!l && !!rec && isReviewItem(l) && isPassed(p, id) && hasEarned(p, id) && rec.firstS !== s && !used.has(id) && !isCold(p, id, now)
  }).sort((a, b) => (p.lessons[b].firstS ?? -1) - (p.lessons[a].firstS ?? -1) || (p.lessons[b].passedAt ?? 0) - (p.lessons[a].passedAt ?? 0))
}

/** Items a mix step needs played before it is done: 2 in a short step, else all of them. */
const mixNeed = (step: SessionStep) => Math.min(step.items?.length ?? 0, step.min <= 5 ? 2 : (step.items?.length ?? 0))

function mixWhy(items: string[]): string {
  const [a, b, c] = items.map((id) => lessonById(id)?.title ?? id)
  return `${a}, ${b}${c ? `, ${c}` : ''}. One run each, in turn.`
}

/** Jams: free jams not played last session (least recently played first), else the furthest open jam, else First Jam. */
function jamList(p: Progress, s: number): string[] {
  const open = ORDER.filter((id) => isImprov(id) && isUnlocked(p, id))
  const free = open
    .filter((id) => lessonById(id)?.free && !(p.lessons[id]?.hist ?? []).some((h) => h.s === s - 1))
    .sort((a, b) => (p.lessons[a]?.lastPlayed ?? 0) - (p.lessons[b]?.lastPlayed ?? 0))
  const rest = open.filter((id) => !free.includes(id)).reverse()
  const all = [...free, ...rest]
  return all.length ? all : [TASTE_ID]
}

const JAM_WHY = 'Wind down: jam in listen mode, band loud, no tab. Record the last 2 minutes if you like.'
const jamWhy = (p: Progress, id: string) =>
  isUnlocked(p, id) ? JAM_WHY : 'A taste of World 2: free play with the band. A is the open A string, C is G string fret 5.'

function changesStep(p: Progress, ctx: PlanCtx): Pick & { skill: SessionStep['skill'] } {
  const pair = weakestPair(ctx.stats, knownChords(p))
  if (!pair) return { id: '', skill: { game: 'find' }, why: 'Fretboard notes: find each note fast.' }
  const best = ctx.stats.best[bestKey('changes', pair)]
  return { id: '', skill: { game: 'changes', pair }, why: best === undefined ? `One-minute changes: ${pair}. Your first try sets the baseline. Retire it at 60.` : `One-minute changes: ${pair}. Your best: ${best}. Retire it at 60.` }
}

function lessonStep(p: Progress, kind: StepKind, pick: Pick, min: number): SessionStep {
  const rec = p.lessons[pick.id]
  const lesson = lessonById(pick.id)
  const step: SessionStep = {
    kind,
    lessonId: pick.id,
    min,
    state: 'todo',
    why: pick.why,
    from: { best: rec?.best ?? 0, stars: rec?.stars ?? 0, speed: lesson ? autoSpeed(lesson, rec) : 1, loops: rec?.loops ?? 0 },
  }
  if (pick.drill) step.drill = pick.drill
  if (pick.consolidate) step.consolidate = true
  return step
}

function skillStep(kind: StepKind, skill: SessionStep['skill'], why: string, min: number): SessionStep {
  return { kind, lessonId: null, skill, min, state: 'todo', why, from: { best: 0, stars: 0, speed: 1, loops: 0 } }
}

/** A fresh session plan for `now`'s practice day. */
export function makeSessionPlan(p: Progress, now: Date, ctx: PlanCtx): SessionPlan {
  const today = dayKey(now)
  const min = p.sessionMin ?? 30
  const shape = shapeFor(p, now)
  const away = daysAway(p, today)
  const plan = (steps: SessionStep[]): SessionPlan => (away === null ? { v: 2, day: today, min, shape, steps } : { v: 2, day: today, min, shape, steps, away })

  // A brand-new player: Tap In first, nothing else.
  if (!syncDone(p)) return plan([lessonStep(p, 'new', { id: SYNC_ID, why: 'Set up your timing first.' }, 5)])

  const s = sessionNow(p, now)
  const used = new Set<string>()
  const colds = coldList(p, now)
  let extraJam = 0
  let spare = 0
  const steps: SessionStep[] = []
  const kinds = TEMPLATES[min][shape].map(([k]) => k)

  for (const [kind, m] of TEMPLATES[min][shape]) {
    if (kind === 'warmup') {
      // A drill on an item due for a cold start would warm it up: then the plain warm-up instead.
      const dp = drillPick(p, now)
      const d = dp && !colds.includes(dp.id) ? dp : null
      const id = d ? null : (warmupList(p, now).find((x) => !used.has(x)) ?? null)
      if (d) {
        // Cold, new and mix steps skip the drilled lesson.
        used.add(d.id)
        steps.push(lessonStep(p, 'warmup', d, m))
      } else if (id) {
        used.add(id)
        steps.push(lessonStep(p, 'warmup', { id, why: 'Easy start. Shake off the day.' }, m))
      } else extraJam += m
      if (ctx.unratedTake) {
        steps.push(skillStep('listenback', { game: 'record' }, "Listen to last session's jam take and rate it.", 1))
        extraJam -= 1
      }
    } else if (kind === 'cold') {
      const id = colds.find((x) => !used.has(x))
      if (!id) {
        extraJam += m
        continue
      }
      used.add(id)
      steps.push(lessonStep(p, 'cold', { id, why: coldWhy(p, id) }, m))
    } else if (kind === 'new') {
      const allowed = shape === 'A' || (shape === 'C' && newAllowedInC(p, now, s))
      const cons = allowed ? null : consolidatePick(p, s)
      if (cons && !used.has(cons)) {
        used.add(cons)
        steps.push(lessonStep(p, 'new', { id: cons, consolidate: true, why: "Last session's new one again, on its own, until it's slow and clean." }, m))
        continue
      }
      if (allowed) {
        const { ids, polish } = newList(p, now)
        const id = ids.find((x) => !used.has(x))
        if (id) {
          used.add(id)
          steps.push(lessonStep(p, 'new', { id, why: polish ? 'Go for 3 stars.' : NEW_WHY }, m))
          continue
        }
        extraJam += m
        continue
      }
      // Nothing to consolidate: interleave instead.
      steps.push({ ...skillStep('mix', undefined, '', m), lessonId: null })
    } else if (kind === 'mix') {
      steps.push({ ...skillStep('mix', undefined, '', m), lessonId: null })
    } else if (kind === 'changes') {
      const c = changesStep(p, ctx)
      steps.push(skillStep('changes', c.skill, c.why, m))
    } else if (kind === 'ear') {
      steps.push(skillStep('ear', { game: 'ear' }, 'Call and response: copy short phrases by ear.', m))
    } else if (kind === 'jam') {
      const id = jamList(p, s)[0]
      // Only the First Jam taste so far: the jam keeps its own minutes, the rest goes to guided work below.
      const extra = id === TASTE_ID ? Math.min(0, extraJam) : extraJam
      spare = extraJam - extra
      steps.push(lessonStep(p, 'jam', { id, why: jamWhy(p, id) }, m + extra))
    }
  }

  // Mix steps are filled last, so they skip today's new and cold items.
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]
    if (st.kind !== 'mix') continue
    const items = mixList(p, s, used, now).slice(0, 3)
    if (items.length >= 2) {
      for (const id of items) used.add(id)
      steps[i] = { ...st, items, played: [], why: mixWhy(items) }
      continue
    }
    // Fewer than 2 items with an earned tempo: changes, or ear when changes is already in the plan.
    const hasChanges = steps.some((x) => x.kind === 'changes') || kinds.includes('changes')
    if (hasChanges) steps[i] = skillStep('ear', { game: 'ear' }, 'Call and response: copy short phrases by ear.', st.min)
    else {
      const c = changesStep(p, ctx)
      steps[i] = skillStep('changes', c.skill, c.why, st.min)
    }
  }
  // Spare minutes (no cold item, no warm-up) go to blocked reps of the new item, else changes or ear;
  // with none of those the session is simply shorter.
  if (spare > 0) {
    const to = ['new', 'changes', 'ear', 'mix'].map((k) => steps.find((x) => x.kind === k)).find((x) => x !== undefined)
    if (to) to.min += spare
  }
  return plan(steps)
}

/** Progress with today's plan, or null when today's v2 plan is already stored (no save needed). */
export function withTodayPlan(p: Progress, now: Date, ctx: PlanCtx): Progress | null {
  const plan = p.plan
  if (plan && plan.v === 2 && plan.day === dayKey(now) && !(setupOnly(plan) && syncDone(p))) return null
  return { ...p, plan: makeSessionPlan(p, now, ctx) }
}

export function planDone(plan: SessionPlan): boolean {
  const done = plan.steps.filter((s) => s.state === 'done').length
  return plan.steps.length > 0 && !plan.steps.some((s) => s.state === 'todo') && done >= Math.min(2, plan.steps.length)
}

/** First todo step, -1 when none. */
export function nextStepIndex(plan: SessionPlan): number {
  return plan.steps.findIndex((s) => s.state === 'todo')
}

/** Minutes of the steps still in the plan (todo and done, not skipped). */
export function planMinutes(plan: SessionPlan): number {
  return plan.steps.reduce((a, s) => a + (s.state === 'skipped' ? 0 : s.min), 0)
}

type Ticked = { progress: Progress; finished: boolean }

/** Marks `step` (inside `next`) done and keeps its best score. */
function finishStep(next: Progress, step: SessionStep, score: number, speed: number): Ticked {
  const plan = next.plan as SessionPlan
  const wasDone = planDone(plan)
  step.state = 'done'
  if (step.score === undefined || score >= step.score) {
    step.score = score
    step.speed = speed
  }
  return { progress: next, finished: !wasDone && planDone(plan) }
}

const todayPlan = (p: Progress, now: Date) => (p.plan && p.plan.v === 2 && p.plan.day === dayKey(now) ? p.plan : null)

/** Ticks the step for this run: a lesson step of that lesson, or one item of a mix step. */
export function planAfterRun(p: Progress, lessonId: string, r: LessonResult, now: Date): Ticked {
  const same = { progress: p, finished: false }
  const plan = todayPlan(p, now)
  if (!plan) return same
  // Tap In done: drop the setup plan, the home screen makes the real one.
  if (setupOnly(plan) && syncDone(p)) return { progress: { ...p, plan: null }, finished: false }
  const next = clone(p)
  const steps = (next.plan as SessionPlan).steps
  const step = steps.find((s) => s.state === 'todo' && s.lessonId === lessonId && !s.drill)
  if (step) return finishStep(next, step, r.score, r.speed)
  const mix = steps.find((s) => s.state === 'todo' && s.kind === 'mix' && s.items?.includes(lessonId) && !s.played?.includes(lessonId))
  if (!mix) return same
  mix.played = [...(mix.played ?? []), lessonId]
  if (mix.played.length < mixNeed(mix)) return { progress: next, finished: false }
  return finishStep(next, mix, r.score, r.speed)
}

/** A drill loop ticks today's drill step: score = its best pass. */
export function planAfterLoop(p: Progress, drillKey: string, s: LoopSummary, now: Date): Ticked {
  const same = { progress: p, finished: false }
  if (!todayPlan(p, now) || !s.passes.length) return same
  const next = clone(p)
  const step = (next.plan as SessionPlan).steps.find((x) => x.drill === drillKey && x.state === 'todo')
  if (!step) return same
  const score = Math.round(100 * Math.max(...s.passes.map((x) => x.acc)))
  const speed = s.topSpeed || s.passes[s.passes.length - 1].speed
  return finishStep(next, step, score, speed)
}

/** A skill round ticks the first todo skill step of its game (a rating ticks Listen back). */
export function planAfterSkill(p: Progress, e: SkillEntry, now: Date): Ticked {
  const same = { progress: p, finished: false }
  if (!todayPlan(p, now)) return same
  const next = clone(p)
  const step = (next.plan as SessionPlan).steps.find((s) => {
    if (s.state !== 'todo' || !s.skill) return false
    if (e.game === 'rate') return s.kind === 'listenback'
    if (s.kind === 'listenback') return false
    if (s.skill.game !== e.game) return false
    return s.skill.game !== 'changes' || !s.skill.pair || s.skill.pair === e.detail
  })
  if (!step) return same
  return finishStep(next, step, e.score, 1)
}

/** Ids of the lesson steps other than i (mix items included). */
const otherIds = (plan: SessionPlan, i: number) => new Set(plan.steps.filter((_, j) => j !== i).flatMap((s) => [...(s.lessonId ? [s.lessonId] : []), ...(s.items ?? [])]))

function candidates(p: Progress, step: SessionStep, now: Date): string[] {
  const s = sessionNow(p, now)
  if (step.kind === 'warmup') return warmupList(p, now)
  if (step.kind === 'cold') return coldList(p, now)
  if (step.kind === 'new') return step.consolidate ? [] : newList(p, now).ids
  if (step.kind === 'jam') return jamList(p, s).filter((id) => isUnlocked(p, id))
  return []
}

function whyFor(p: Progress, step: SessionStep, id: string): string {
  if (step.kind === 'cold') return coldWhy(p, id)
  if (step.kind === 'warmup') return 'Easy start. Shake off the day.'
  if (step.kind === 'jam') return jamWhy(p, id)
  return isPassed(p, id) ? 'Go for 3 stars.' : NEW_WHY
}

/** Other lesson ids for step i (never one another step already uses). Drill, mix and skill steps have none. */
export function swapOptions(p: Progress, i: number, now = new Date()): string[] {
  const plan = p.plan
  const step = plan?.steps[i]
  if (!plan || !step || !step.lessonId || step.drill) return []
  const others = otherIds(plan, i)
  return candidates(p, step, now).filter((id) => id !== step.lessonId && !others.has(id))
}

/** Step i with the next option of its kind, cycling; why and from are refreshed. */
export function swapStep(p: Progress, i: number, now: Date): Progress {
  const plan = p.plan
  const step = plan?.steps[i]
  if (!plan || !step || !step.lessonId || step.drill) return p
  const others = otherIds(plan, i)
  const list = candidates(p, step, now).filter((id) => !others.has(id))
  const at = list.indexOf(step.lessonId)
  const id = list[(at + 1) % list.length]
  if (!id || id === step.lessonId) return p
  const next = clone(p)
  ;(next.plan as SessionPlan).steps[i] = lessonStep(next, step.kind, { id, why: whyFor(next, step, id) }, step.min)
  return next
}

/** Todo <-> skipped. Done steps stay done. */
export function skipStep(p: Progress, i: number): Progress {
  const step = p.plan?.steps[i]
  if (!step || step.state === 'done') return p
  const next = clone(p)
  const s = (next.plan as SessionPlan).steps[i]
  s.state = s.state === 'todo' ? 'skipped' : 'todo'
  return next
}

/** What got better in today's done steps: best score, stars, earned tempo, loops, cold passes. Only real gains. */
export function improvements(p: Progress, plan: SessionPlan): string[] {
  const lines: string[] = []
  for (const s of plan.steps) {
    const ids = s.kind === 'mix' ? (s.played ?? []) : s.lessonId ? [s.lessonId] : []
    if (s.state !== 'done' && !(s.kind === 'mix' && ids.length)) continue
    for (const id of ids) {
      const rec = p.lessons[id]
      const lesson = lessonById(id)
      const title = lesson?.title
      if (!rec || !lesson || !title || isSync(id)) continue
      if (s.kind !== 'mix') {
        if (rec.best > s.from.best) lines.push(s.from.best > 0 ? `${title}: best ${s.from.best}% → ${rec.best}%` : `${title}: first score ${rec.best}%`)
        if (rec.stars > s.from.stars) {
          const d = rec.stars - s.from.stars
          lines.push(`${title}: +${d} star${d === 1 ? '' : 's'}`)
        }
        const dl = (rec.loops ?? 0) - (s.from.loops ?? 0)
        if (dl > 0) lines.push(`${title}: ${dl} loop${dl === 1 ? '' : 's'} locked in`)
        if (autoSpeed(lesson, rec) > s.from.speed && rec.topSpeed !== undefined) lines.push(`${title}: ${bpmAt(lesson, rec.topSpeed)} BPM earned`)
      }
      const cold = (rec.hist ?? []).find((h) => h.cold?.d === plan.day)?.cold
      if (cold?.clean) lines.push(`${title}: clean from cold at ${cold.bpm} BPM`)
    }
  }
  // A drill step shares its lesson with another step at times: say each line once.
  return [...new Set(lines)]
}

// ---- the session log ----

function upsertDay(p: Progress, day: string, fn: (d: SessionDay) => SessionDay): Progress {
  const log = p.sessions?.log ?? []
  const old = log.find((d) => d.day === day) ?? { day, sec: 0, set: false, counted: false, pocket: false }
  const nd = fn({ ...old })
  const t = trimLog([...log.filter((d) => d.day !== day), nd], p.sessions?.before ?? 0)
  return { ...p, sessions: t }
}

/**
 * Today's session day from the practice log and the plan. A day counts with a finished plan or 10 minutes of playing.
 * When the day that meets the week goal turns counted, the week is recorded as met (no XP: XP is for competence).
 */
export function withSessionDay(p: Progress, now: Date, practiceSec: number): { progress: Progress; changed: boolean; counted: boolean; weekMet: boolean } {
  const today = dayKey(now)
  const old = (p.sessions?.log ?? []).find((d) => d.day === today)
  const plan = todayPlan(p, now)
  const nd: SessionDay = { day: today, sec: Math.max(old?.sec ?? 0, Math.round(practiceSec)), set: !!old?.set || (!!plan && planDone(plan)), counted: false, pocket: !!old?.pocket }
  nd.counted = !!old?.counted || nd.set || nd.sec >= SESSION_MIN_SEC
  const min = plan?.min ?? old?.min
  if (min) nd.min = min
  const shape = plan?.shape ?? old?.shape
  if (shape) nd.shape = shape
  if (old?.pain) nd.pain = old.pain
  // The goal this week is judged by, kept with the day so a later change of goal never rewrites past weeks.
  const goal = old?.goal ?? (nd.counted ? (p.weekGoal ?? 3) : undefined)
  if (goal !== undefined) nd.goal = goal
  if (old && JSON.stringify(old) === JSON.stringify(nd)) return { progress: p, changed: false, counted: nd.counted, weekMet: false }
  let next = upsertDay(p, today, () => nd)
  let weekMet = false
  if (nd.counted && !old?.counted) {
    const ws = weekStatus(next, now)
    const wk = weekKey(today)
    if (ws.done >= ws.goal && !(next.weekXp ?? []).includes(wk)) {
      weekMet = true
      next = { ...next, weekXp: [...(next.weekXp ?? []), wk].slice(-20) }
    }
  }
  return { progress: next, changed: true, counted: nd.counted, weekMet }
}

/** Today's plan was started: some step is done. */
export function planStarted(p: Progress, now: Date): boolean {
  return !!todayPlan(p, now)?.steps.some((s) => s.state === 'done')
}

/** A new session length. Today's plan is dropped (the home screen remakes it) unless a step of it is done already. */
export function withSessionMin(p: Progress, min: SessionMin, now: Date): Progress {
  if (p.sessionMin === min) return p
  const plan = todayPlan(p, now)
  return { ...p, sessionMin: min, plan: plan && !planStarted(p, now) ? null : p.plan }
}

/** A pocket session was played today (it never makes the day count). */
export function markPocket(p: Progress, now: Date): Progress {
  return upsertDay(p, dayKey(now), (d) => ({ ...d, pocket: true }))
}

/** The hand-health check-in for today. */
export function setPain(p: Progress, now: Date, pain: PainLevel): Progress {
  return upsertDay(p, dayKey(now), (d) => ({ ...d, pain }))
}

/** Pain flagged on the last counted session before today, if any. */
export function lastPain(p: Progress, now: Date): PainLevel | null {
  const today = dayKey(now)
  const prev = counted(p).filter((d) => d.day < today)
  return prev[prev.length - 1]?.pain ?? null
}

/** Today's session day, if any. */
export function todayDay(p: Progress, now: Date): SessionDay | null {
  const today = dayKey(now)
  return (p.sessions?.log ?? []).find((d) => d.day === today) ?? null
}

/** The pocket card opens by itself when the week goal is met or yesterday was a session. */
export function pocketOpen(p: Progress, now: Date): boolean {
  if (weekStatus(p, now).done >= (p.weekGoal ?? 3)) return true
  const y = dayKey(new Date(now.getTime() - 86400000))
  return counted(p).some((d) => d.day === y)
}
