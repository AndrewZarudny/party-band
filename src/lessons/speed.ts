// Speed trainer: per-lesson Auto speed. A tempo counts once it is clean on the first try and twice more.
import type { Lesson, LessonRecord, LessonResult, Prefs, Speed, TempoTrial } from './types'

export const CLEAN_RUN = 0.9 // heuristic: share of events good or better for a clean run (same as a clean loop pass)
export const EARN_PASSES = 3 // research: a clean first run plus two more
export const MIN_SPEED = 0.6
export const FULL_SPEED = 1
export const OVER_SPEED = 1.15
export const START_SPEED = 0.85
export const EASY_START = 0.7
/** Manual choices in the intro; 1.1 only once overdrive is open. */
export const MANUAL_SPEEDS: Speed[] = [0.7, 0.85, 1, 1.1]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Rounds to the 0.01 grid, so 0.85 + 0.04 is exactly 0.89 and 1 compares as 1. Old 0.05-grid values stay valid. */
export const snapSpeed = (v: number): Speed => Math.round(v * 100) / 100

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
  overdrive: boolean
  topBefore: Speed // fastest earned speed before this run (0 = none)
  top: Speed // fastest earned speed after it
  earned: boolean // this run earned its tempo
  trial: TempoTrial | undefined // the tempo being earned after this run
  clean: boolean // this run was clean
}

/** One step of about 3 BPM (heuristic: the middle of the research's "a few BPM", 2–4), as a speed. */
export function tempoStep(lesson: Lesson): Speed {
  return Math.max(0.01, snapSpeed(3 / lesson.bpm))
}

export function bpmAt(lesson: Lesson, speed: Speed): number {
  return Math.round(lesson.bpm * speed)
}

/** "64 BPM (85%)" */
export const bpmPct = (lesson: Lesson, s: Speed) => `${bpmAt(lesson, s)} BPM (${pct(s)})`

/**
 * A clean run: passed with at least CLEAN_RUN of its events good or better.
 * Jams: passed with a 2-star score. The sync lesson is never clean.
 */
export function isCleanRun(lesson: Lesson, r: LessonResult): boolean {
  if (lesson.type === 'sync') return false
  if (lesson.type === 'improv') return r.passed && r.score >= lesson.stars[1]
  return r.passed && (r.cleanShare ?? 0) >= CLEAN_RUN - 1e-9
}

/** Jams keep the old rule: back up after any pass, slower only far under the pass mark. */
function jamStep(lesson: Lesson, before: LessonRecord | undefined, r: LessonResult, topBefore: Speed): SpeedStep {
  const played = snapSpeed(r.speed)
  // Above full speed (overdrive), jams still need a 3-star run to go faster.
  const up = played >= FULL_SPEED ? lesson.stars[2] : lesson.pass
  const overdrive = !!before?.overdrive || (r.passed && played >= FULL_SPEED && r.score >= lesson.stars[2])
  let s = played
  if (r.passed && r.score >= up) s += 0.05
  else if (r.score < lesson.pass - 15) s -= 0.1
  return {
    speed: clamp(snapSpeed(s), MIN_SPEED, overdrive ? OVER_SPEED : FULL_SPEED),
    overdrive,
    topBefore,
    top: r.passed ? Math.max(topBefore, played) : topBefore,
    earned: r.passed,
    trial: undefined,
    clean: isCleanRun(lesson, r),
  }
}

/**
 * The speed trainer's step after one run. `before` is the lesson record before the run.
 * A tempo is earned by a clean first run at it plus two more clean runs (research: Duke, the first trial
 * at a new tempo should be accurate). Then it goes up one tempo step. A first run that isn't clean goes
 * one step down.
 */
/**
 * The fastest earned speed (0 = none). A record passed before this trainer existed (no session history yet)
 * counts as earned at full speed; every run under the trainer adds a history entry.
 */
export function earnedTop(rec: LessonRecord | undefined): Speed {
  return rec?.topSpeed ?? (rec?.passedAt !== undefined && !rec.hist ? FULL_SPEED : 0)
}

export function nextSpeed(lesson: Lesson, before: LessonRecord | undefined, r: LessonResult): SpeedStep {
  const topBefore = earnedTop(before)
  if (lesson.type === 'improv') return jamStep(lesson, before, r, topBefore)
  const played = snapSpeed(r.speed)
  const clean = isCleanRun(lesson, r)
  const step = tempoStep(lesson)
  const old = before?.trial
  const cont = !!old && Math.abs(old.speed - played) < 1e-9
  let trial: TempoTrial | undefined = cont ? { ...old, clean: old.clean + (clean ? 1 : 0) } : { speed: played, first: clean, clean: clean ? 1 : 0 }
  let overdrive = !!before?.overdrive
  let top = topBefore
  let earned = false
  let next: Speed
  if (trial.first && trial.clean >= EARN_PASSES) {
    earned = true
    top = Math.max(topBefore, played)
    if (played >= FULL_SPEED - 1e-9 && r.score >= 95) overdrive = true
    next = played + step
    trial = undefined
  } else if (!trial.first) {
    next = played - step
    trial = undefined
  } else next = played
  // safety: a run far under the pass mark inside a trial drops two steps
  if (cont && !earned && r.score < lesson.pass - 10) {
    next = played - 2 * step
    trial = undefined
  }
  return {
    speed: clamp(snapSpeed(next), MIN_SPEED, overdrive ? OVER_SPEED : FULL_SPEED),
    overdrive,
    topBefore,
    top,
    earned,
    trial,
    clean,
  }
}
