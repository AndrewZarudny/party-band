// Listen mode and tab fading: how much tab a run shows, and how loud the band plays in listen mode.
import type { Lesson, LessonRecord, TabLevel } from './types'

/** Band volume multiplier in listen mode. Heuristic: loud enough to lead, still under the guitar. */
export const QUIET_BAND = 1.35

/** Tab fades as the item matures: full until the first cold pass, faded after one, hidden after two or once learned. */
export function tabLevelFor(rec: LessonRecord | undefined): TabLevel {
  const r = rec?.review
  if (!r) return 'full'
  if (r.learned || r.coldPasses >= 2) return 'hidden'
  if (r.coldPasses === 1) return 'faded'
  return 'full'
}

/** A free jam (improv): the session's wind-down, played in listen mode. */
export function isJam(lesson: Lesson): boolean {
  return lesson.type === 'improv'
}
