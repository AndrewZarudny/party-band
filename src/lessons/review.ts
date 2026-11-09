// Spaced review counted in sessions, not days, with cold-start tests (research sections 2 and 4). Pure, no DOM.
import type { ColdAttempt, HistEntry, Lesson, LessonRecord, LessonResult, Progress, ReviewState, Speed, XpLine } from './types'
import { ORDER, lessonById } from './data'
import { dayKey } from './progress'
import { FULL_SPEED, MIN_SPEED, autoSpeed, pct, snapSpeed, speedCap, tempoStep } from './speed'

export const SESSION_GAPS = [1, 2, 4, 8] // sessions (research)
export const SESSION_MIN_SEC = 600 // heuristic: half the 20-minute template
export const LEARN_SESSIONS = 2 // research: clean from cold at full tempo in 2 separate sessions
export const REVIEW_DROP_BPM = 10 // heuristic (research): back to review when cold is this far under the last best
export const HIST_MAX = 16
/**
 * Plan section 4, "Repeat or move on" (added 8 Nov 2026, from week-1 data): while this many items are still
 * failing their cold start, sessions are review only, with no new lessons.
 */
export const REVIEW_BRAKE = 3

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Counted sessions before `day`, plus one: the number that day has (counted or not). */
export function sessionOf(p: Progress, day: string): number {
  const log = p.sessions?.log ?? []
  return (p.sessions?.before ?? 0) + log.filter((e) => e.counted && e.day < day).length + 1
}

export function sessionNow(p: Progress, now: Date): number {
  return sessionOf(p, dayKey(now))
}

/** Counted sessions so far, today included when it counts. */
export function sessionsCounted(p: Progress): number {
  return (p.sessions?.before ?? 0) + (p.sessions?.log ?? []).filter((e) => e.counted).length
}

export function isReviewItem(lesson: Lesson): boolean {
  return lesson.type === 'notes' || lesson.type === 'chords' || lesson.type === 'rhythm'
}

/** Due for a cold-start test, and not played or looped yet today. */
export function isCold(p: Progress, lessonId: string, now: Date): boolean {
  const lesson = lessonById(lessonId)
  const rec = p.lessons[lessonId]
  if (!lesson || !rec?.review || !isReviewItem(lesson)) return false
  const today = dayKey(now)
  if (rec.review.due > sessionNow(p, now)) return false
  if (rec.playsDay === today && rec.playsToday > 0) return false
  return rec.loopDay !== today
}

/**
 * Whether a finished run is scored as the item's cold-start test: only a run started from the Cold start card
 * (no warm-up, no tab) that is still the item's first try today, and never a shuffle run.
 * A first play of a due item from the map, a warm-up or a mix is an ordinary run: the item stays due.
 */
export function coldRun(p: Progress, lessonId: string, now: Date, o: { fromCard: boolean; shuffle: boolean }): boolean {
  return o.fromCard && !o.shuffle && isCold(p, lessonId, now)
}

/** The newest in-session best, as a speed. */
function newestBestSpeed(lesson: Lesson, rec: LessonRecord): Speed | undefined {
  const h = [...(rec.hist ?? [])].reverse().find((e) => e.best !== undefined)
  return h?.best !== undefined ? snapSpeed(h.best / lesson.bpm) : undefined
}

/** The newest cold-start test, if any. */
export function newestCold(rec: LessonRecord | undefined): ColdAttempt | undefined {
  return [...(rec?.hist ?? [])].reverse().find((e) => e.cold)?.cold
}

/**
 * The speed of the next cold-start test. After a failed one: the staircase down (review.coldSpeed), then one step up
 * after each clean one while it is still far under the best.
 * Otherwise the newest in-session best, but never under one tempo step above the last clean cold test:
 * only a clean cold start at full tempo counts toward learned (plan section 4), so cold tests climb to it and stay there.
 */
export function coldSpeedFor(lesson: Lesson, rec: LessonRecord | undefined): Speed {
  const base = rec?.review?.coldSpeed ?? (rec ? newestBestSpeed(lesson, rec) : undefined) ?? rec?.topSpeed ?? autoSpeed(lesson, rec)
  const c = rec?.review?.coldSpeed === undefined ? newestCold(rec) : undefined
  const up = c?.clean ? Math.min(FULL_SPEED, snapSpeed(c.speed + tempoStep(lesson))) : 0
  return clamp(snapSpeed(Math.max(base, up)), MIN_SPEED, speedCap(rec))
}

// ---- Struggling items and the review brake ------------------------------------------

/**
 * A review item that is started but not sticking: in review, not learned, and failing its cold start.
 * Failing means the newest cold test was not clean, or it was clean but more than REVIEW_DROP_BPM under the
 * in-session best before it. An item with no cold test yet isn't counted: nothing says it's failing.
 * A clean one at the slower speed the app asked for after a fail is climbing back (review.coldSpeed still set), not failing.
 */
export function isStruggling(lesson: Lesson | undefined, rec: LessonRecord | undefined): boolean {
  if (!lesson || !rec?.review || rec.review.learned || !isReviewItem(lesson)) return false
  const g = retentionGap(rec)
  if (g.coldClean === null) return false
  if (g.coldClean && rec.review.coldSpeed !== undefined) return false
  return !g.coldClean || (g.gap !== null && g.gap > REVIEW_DROP_BPM)
}

/** Struggling items, lowest newest cold score first, then map order. */
export function strugglingList(p: Progress): string[] {
  return ORDER.filter((id) => isStruggling(lessonById(id), p.lessons[id]))
    .map((id, i) => ({ id, i, score: newestCold(p.lessons[id])?.score ?? 0 }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.id)
}

/** The brake is on: REVIEW_BRAKE or more items are failing their cold start, so no new lessons are suggested. */
export function reviewBrake(p: Progress): boolean {
  return strugglingList(p).length >= REVIEW_BRAKE
}

// ---- Passed vs learned -----------------------------------------------------------------

export type Standing = 'open' | 'passed' | 'learned'

/** Passed unlocks the next lesson at any speed; learned needs clean cold starts at full tempo (plan section 4). */
export function standingOf(rec: LessonRecord | undefined): Standing {
  if (rec?.review?.learned) return 'learned'
  return rec?.passedAt !== undefined ? 'passed' : 'open'
}

/** "Learned", "Passed at 72%", "Passed at full tempo", or "Passed" when the pass speed isn't known; null when not passed. */
export function standingLabel(rec: LessonRecord | undefined): string | null {
  const st = standingOf(rec)
  if (st === 'learned') return 'Learned'
  if (st === 'open') return null
  const s = rec?.passedSpeed
  if (s === undefined) return 'Passed'
  return s >= FULL_SPEED - 1e-9 ? 'Passed at full tempo' : `Passed at ${pct(s)}`
}

/** Clean cold starts at full tempo so far, toward LEARN_SESSIONS. */
export function fullColds(rec: LessonRecord | undefined): number {
  return Math.min(LEARN_SESSIONS, rec?.review?.coldPasses ?? 0)
}

export interface GapInfo {
  best: number | null
  cold: number | null
  gap: number | null
  prevGap: number | null
  coldClean: boolean | null
}

interface GapRow {
  best: number | null
  cold: number
  gap: number | null
}

/** Clean cold attempts with the best of the session before them, oldest first; and whether the newest cold was clean. */
function gapRows(hist: HistEntry[]): { rows: GapRow[]; lastClean: boolean | null } {
  const rows: GapRow[] = []
  let prevBest: number | null = null
  let lastClean: boolean | null = null
  for (const e of hist) {
    if (e.cold) {
      lastClean = e.cold.clean
      if (e.cold.clean) rows.push({ best: prevBest, cold: e.cold.bpm, gap: prevBest === null ? null : prevBest - e.cold.bpm })
    }
    if (e.best !== undefined) prevBest = e.best
  }
  return { rows, lastClean }
}

/** In-session best of the last session before the newest clean cold attempt, minus that attempt's BPM. */
export function retentionGap(rec: LessonRecord | undefined): GapInfo {
  const { rows, lastClean } = gapRows(rec?.hist ?? [])
  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  return {
    best: last?.best ?? null,
    cold: last?.cold ?? null,
    gap: last?.gap ?? null,
    prevGap: prev?.gap ?? null,
    coldClean: lastClean,
  }
}

/** The entry for session `s` (created, kept in session order, trimmed to HIST_MAX). Mutates rec. */
export function histEntry(rec: LessonRecord, s: number, day: string): HistEntry {
  const hist = rec.hist ?? []
  let e = hist.find((x) => x.s === s)
  if (!e) {
    e = { s, d: day }
    hist.push(e)
    hist.sort((a, b) => a.s - b.s)
  }
  rec.hist = hist.slice(-HIST_MAX)
  return e
}

/** The review a review item gets on its first pass: due next session. */
export function firstReview(s: number): ReviewState {
  return { step: 0, due: s + SESSION_GAPS[0], coldPasses: 0, lastColdS: 0, learned: false }
}

const plusLine = (label: string, v: number): XpLine => ({ label, value: `+${v}` })

/**
 * A cold-start test: logs it on the session's hist entry and moves the review (mutates rec.hist and rec.review).
 * Returns the competence lines and XP lines it earned, in display order.
 */
export function applyCold(
  rec: LessonRecord,
  lesson: Lesson,
  r: LessonResult,
  s: number,
  day: string,
  clean: boolean,
): { review: ReviewState; cold: ColdAttempt; lines: string[]; xp: XpLine[] } {
  const before = rec.review ?? firstReview(s - 1)
  const review: ReviewState = { ...before }
  const wasLearned = review.learned
  const title = lesson.title
  const earlier = rec.hist ?? []
  // Best earlier clean cold BPM and the in-session best before this session.
  const prevColdBpm = Math.max(0, ...earlier.filter((e) => e.s < s && e.cold?.clean).map((e) => e.cold?.bpm ?? 0))
  const prevBestEntry = [...earlier].reverse().find((e) => e.s < s && e.best !== undefined)
  const prevBest = prevBestEntry?.best ?? null

  const cold: ColdAttempt = { s, d: day, bpm: r.bpm, speed: snapSpeed(r.speed), clean, score: r.score, tab: r.tab ?? 'full' }
  histEntry(rec, s, day).cold = cold

  const lines: string[] = []
  const xp: XpLine[] = []
  // Asked at a slower speed after a failed test: the app picked that tempo, so it isn't measured against the best.
  const stair = before.coldSpeed !== undefined
  if (clean) {
    review.step = Math.min(SESSION_GAPS.length - 1, review.step + 1)
    delete review.coldSpeed
    // Only full tempo counts toward learned (plan section 4); a clean cold under it moves the next one up a step.
    if (r.speed >= FULL_SPEED - 1e-9 && review.lastColdS !== s) {
      review.coldPasses++
      review.lastColdS = s
      if (review.coldPasses >= LEARN_SESSIONS && !review.learned) {
        review.learned = true
        review.learnedAt = r.at
      }
    }
    xp.push(plusLine('Cold start passed', 15))
    if (prevColdBpm > 0 && cold.bpm > prevColdBpm) {
      const d = cold.bpm - prevColdBpm
      xp.push(plusLine('Cold tempo up', Math.min(30, 3 * d)))
      lines.push(`Cold tempo on ${title} is up ${d} BPM.`)
    }
    const g = retentionGap(rec)
    if (g.gap !== null && g.prevGap !== null && g.gap < g.prevGap) {
      xp.push(plusLine('Gap shrinking', 10))
      lines.push(`Retention gap on ${title}: ${g.prevGap} → ${g.gap} BPM. The tempo is sticking.`)
    }
    if (stair && r.speed < FULL_SPEED - 1e-9 && prevBest !== null && prevBest - cold.bpm > REVIEW_DROP_BPM) {
      // Still far under the best: the next test climbs one step from here, not straight back up to the best.
      // Not a return to review: the result card already says the next one is a little faster.
      review.coldSpeed = Math.min(FULL_SPEED, snapSpeed(r.speed + tempoStep(lesson)))
    } else if (prevBest !== null && prevBest - cold.bpm > REVIEW_DROP_BPM) {
      review.step = 0
      review.learned = false
      review.coldPasses = 0
      delete review.learnedAt
      lines.push(`${title} goes back to review: cold ${cold.bpm} BPM, ${prevBest - cold.bpm} BPM under your best. Slow down a little and it will stick.`)
    } else if (review.learned && !wasLearned) {
      xp.push(plusLine('Learned', 40))
      lines.push(`${title} is learned: clean from cold at full tempo in two separate sessions.`)
    }
  } else {
    review.step = Math.max(0, review.step - 1)
    review.coldPasses = 0
    review.learned = false
    delete review.learnedAt
    // heuristic staircase: about 6 BPM down for the next cold test
    review.coldSpeed = Math.max(MIN_SPEED, snapSpeed(r.speed - 2 * tempoStep(lesson)))
  }
  review.due = s + SESSION_GAPS[review.step]
  rec.review = review
  return { review, cold, lines, xp }
}

// ---- Weeks ----------------------------------------------------------------------

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The Monday of a day key's week, as a day key. */
export function weekKey(day: string): string {
  const d = new Date(day + 'T12:00:00')
  if (isNaN(d.getTime())) return day
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return ymd(d)
}

/** The week key `n` weeks before `week`. */
function weeksBack(week: string, n: number): string {
  const d = new Date(week + 'T12:00:00')
  d.setDate(d.getDate() - 7 * n)
  return ymd(d)
}

export interface WeekStatus {
  week: string
  done: number
  goal: number
  streak: number
  met: boolean[]
  counts: number[]
}

/**
 * This week's sessions against the goal, the last `weeks` weeks (oldest first) and the week streak.
 * A past week is judged by the goal it had (stored on its counted days), so changing the goal never rewrites history;
 * a week recorded as met (weekXp) stays met.
 */
export function weekStatus(p: Progress, now: Date, weeks = 8): WeekStatus {
  const week = weekKey(dayKey(now))
  const goal = p.weekGoal ?? 3
  const per = new Map<string, number>()
  const goals = new Map<string, number>()
  for (const e of p.sessions?.log ?? []) {
    if (!e.counted) continue
    const k = weekKey(e.day)
    per.set(k, (per.get(k) ?? 0) + 1)
    if (e.goal !== undefined) goals.set(k, e.goal)
  }
  const metWeeks = new Set(p.weekXp ?? [])
  const isMet = (k: string) => (per.get(k) ?? 0) >= (k === week ? goal : (goals.get(k) ?? goal)) || metWeeks.has(k)
  const keys = Array.from({ length: weeks }, (_, i) => weeksBack(week, weeks - 1 - i))
  const counts = keys.map((k) => per.get(k) ?? 0)
  const met = keys.map(isMet)
  const done = per.get(week) ?? 0
  // The week in progress never breaks the streak: count from last week when it isn't met yet.
  let streak = 0
  for (let i = isMet(week) ? 0 : 1; i <= per.size + 1; i++) {
    if (!isMet(weeksBack(week, i))) break
    streak++
  }
  return { week, done, goal, streak, met, counts }
}
