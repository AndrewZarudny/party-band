// Speed trainer: per-lesson Auto speed that follows the player's scores.
import type { Lesson, LessonRecord, LessonResult, Prefs, Speed } from './types'

export const MIN_SPEED = 0.6
export const FULL_SPEED = 1
export const OVER_SPEED = 1.15
export const START_SPEED = 0.85
export const EASY_START = 0.7
/** Manual choices in the intro; 1.1 only once overdrive is open. */
export const MANUAL_SPEEDS: Speed[] = [0.7, 0.85, 1, 1.1]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Rounds to the 0.05 grid, so 0.85 + 0.05 is exactly 0.9 and 1 compares as 1. */
export const snapSpeed = (v: number): Speed => Math.round(v * 20) / 20

/** A stored speed, cleaned; undefined when it isn't one. */
export function cleanSpeed(v: unknown): Speed | undefined {
  return typeof v === 'number' && isFinite(v) ? clamp(snapSpeed(v), MIN_SPEED, OVER_SPEED) : undefined
}

export const speedCap = (rec: LessonRecord | undefined): Speed => (rec?.overdrive ? OVER_SPEED : FULL_SPEED)

/** "85%" */
export const pct = (s: Speed) => `${Math.round(s * 100)}%`

/**
 * The Auto speed for a lesson's next run.
 * Jams start at full speed: a slower band doesn't make note choice easier, it only drags the groove.
 */
export function autoSpeed(lesson: Lesson, rec: LessonRecord | undefined): Speed {
  if (rec?.speed !== undefined) return clamp(snapSpeed(rec.speed), MIN_SPEED, speedCap(rec))
  if (lesson.type === 'improv') return FULL_SPEED
  if (!rec) return START_SPEED
  if (rec.passedAt !== undefined) return FULL_SPEED // passed before Auto existed
  return rec.fails >= 2 ? EASY_START : START_SPEED
}

/**
 * Score lines for Auto: `up` or more on a pass speeds up, under `down` slows down 10%.
 * `down` sits below the pass mark, so a near miss needs two fails in a row (5%) before slowing.
 * Jams: back up after any pass, slow only for a run far under the pass mark.
 */
export function speedLimits(lesson: Lesson): { up: number; down: number } {
  if (lesson.type === 'improv') return { up: lesson.pass, down: lesson.pass - 15 }
  return { up: 90, down: Math.min(60, lesson.pass - 10) }
}

/** The manual pick for this lesson, or null for Auto. */
export function pickFor(prefs: Prefs, lessonId: string): Speed | null {
  const p = prefs.speedPick
  return p && p.lessonId === lessonId ? p.speed : null
}

/** The speed the next run of `lesson` plays at. The sync lesson is always full speed. */
export function speedFor(lesson: Lesson, rec: LessonRecord | undefined, prefs: Prefs): Speed {
  if (lesson.type === 'sync') return FULL_SPEED
  return pickFor(prefs, lesson.id) ?? autoSpeed(lesson, rec)
}

/** One step slower for the Slower buttons. */
export const slowerSpeed = (s: Speed): Speed => clamp(snapSpeed(s - 0.15), MIN_SPEED, FULL_SPEED)

export interface SpeedStep {
  speed: Speed // next Auto speed
  miss: number // failed runs in a row since the last pass or slow-down
  overdrive: boolean
  topBefore: Speed // fastest passed speed before this run (0 = never passed)
  top: Speed // fastest passed speed after it
}

/** The speed trainer's step after one run. `before` is the lesson record before the run. */
export function nextSpeed(lesson: Lesson, before: LessonRecord | undefined, r: LessonResult): SpeedStep {
  const improv = lesson.type === 'improv'
  const played = snapSpeed(r.speed)
  const lim = speedLimits(lesson)
  // Above full speed (overdrive), jams still need a 3-star run to go faster.
  const up = improv && played >= FULL_SPEED ? lesson.stars[2] : lim.up
  const down = lim.down
  const topBefore = before?.topSpeed ?? (before?.passedAt !== undefined ? FULL_SPEED : 0)
  const overdrive = !!before?.overdrive || (r.passed && played >= FULL_SPEED && r.score >= (improv ? lesson.stars[2] : 95))
  let miss = r.passed ? 0 : (before?.miss ?? 0) + 1
  let s = played
  if (r.passed && r.score >= up) s += 0.05
  else if (r.score < down) {
    s -= 0.1
    miss = 0
  } else if (miss >= 2) {
    s -= 0.05
    miss = 0
  }
  return {
    speed: clamp(snapSpeed(s), MIN_SPEED, overdrive ? OVER_SPEED : FULL_SPEED),
    miss,
    overdrive,
    topBefore,
    top: r.passed ? Math.max(topBefore, played) : topBefore,
  }
}
