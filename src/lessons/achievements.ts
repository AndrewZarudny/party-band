// Achievements, checked after every finished run.
import type { AchievementDef, Lesson, LessonResult, Progress } from './types'
import { GROWTH, LESSONS } from './data'
import { dayKey } from './progress'

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-peep', name: 'First Peep', text: 'Pass your first lesson.' },
  { id: 'out-of-shell', name: 'Out of the Shell', text: 'Pass a checkpoint and hatch your dino.' },
  { id: 'first-jam', name: 'First Jam', text: 'Pass First Jam.' },
  { id: 'three-of-a-kind', name: 'Three of a Kind', text: 'Get 3 stars on any lesson.' },
  { id: 'clean-sheet', name: 'Clean Sheet', text: 'Finish a run without a miss or a wrong note.', cosmetic: 'shades' },
  { id: 'chain-gang', name: 'Chain Gang', text: 'Hit 32 good notes in a row.' },
  { id: 'big-roar', name: 'Big Roar', text: 'Keep a roar going for 30 seconds in one run.' },
  { id: 'right-on-time', name: 'Right on Time', text: 'Nail 20 notes in a row.' },
  { id: 'week-stomper', name: 'Week Stomper', text: 'Meet your week goal 2 weeks in a row.', cosmetic: 'bandana' },
  { id: 'month-stomper', name: 'Month Stomper', text: 'Meet your week goal 4 weeks in a row.', cosmetic: 'pick-crown' },
  { id: 'power-up', name: 'Power Up', text: 'Pass Power Pair, your first power chords.' },
  { id: 'bendy', name: 'Bendy', text: 'Bend 25 notes in tune.' },
  { id: 'free-spirit', name: 'Free Spirit', text: 'Get 3 stars on a free-play lesson.' },
  { id: 'comeback', name: 'Comeback', text: 'Pass a lesson after 3 or more tries.' },
  { id: 'late-show', name: 'Late Show', text: 'Pass a lesson between 10 pm and 4 am.' },
  { id: 'titan', name: 'Titan', text: 'Pass the last checkpoint: three choruses without stopping.', cosmetic: 'star-guitar' },
  { id: 'cold-start', name: 'Cold Start', text: 'Pass a cold-start test.' },
  { id: 'locked-in', name: 'Locked In', text: 'Learn your first item: clean from cold in two sessions.' },
]

const passed = (p: Progress, id: string) => p.lessons[id]?.passedAt !== undefined

/** A checkpoint or an encore passed: the dino grows. */
const growthPassed = (p: Progress) => GROWTH.some((id) => passed(p, id))

/** A clean cold-start test was logged by this run (a new cold entry dated today). */
function cleanColdNow(prev: Progress, next: Progress, id: string, today: string): boolean {
  const had = new Set((prev.lessons[id]?.hist ?? []).filter((e) => e.cold).map((e) => e.s))
  return (next.lessons[id]?.hist ?? []).some((e) => e.cold?.clean && e.cold.d === today && !had.has(e.s))
}

/** Ids earned by this run that `prev` did not have yet. `next` is the progress after the run; `weeks` = week streak. */
export function checkAchievements(prev: Progress, next: Progress, lesson: Lesson, r: LessonResult, now: Date, weeks: number): string[] {
  const hour = now.getHours()
  const improvIds = new Set(LESSONS.filter((l) => l.type === 'improv').map((l) => l.id))
  const records = Object.keys(next.lessons).map((id) => ({ id, rec: next.lessons[id] }))
  const prevRec = prev.lessons[lesson.id]
  const met: Record<string, boolean> = {
    'first-peep': passed(next, 'w1-01'),
    'out-of-shell': growthPassed(next),
    'first-jam': passed(next, 'w2-05'),
    'three-of-a-kind': records.some((x) => x.rec.stars === 3),
    'clean-sheet': r.clean,
    'chain-gang': r.bestChain >= 32,
    'big-roar': r.roarMs >= 30000,
    'right-on-time': r.perfectRun >= 20,
    'week-stomper': weeks >= 2,
    'month-stomper': weeks >= 4,
    'power-up': passed(next, 'w4-01'),
    bendy: next.stats.bendsInTune >= 25,
    'free-spirit': records.some((x) => improvIds.has(x.id) && x.rec.stars === 3),
    comeback: r.passed && prevRec?.passedAt === undefined && (prevRec?.fails ?? 0) >= 3,
    'late-show': r.passed && (hour >= 22 || hour < 4),
    titan: passed(next, 'w8-12'),
    'cold-start': cleanColdNow(prev, next, lesson.id, dayKey(now)),
    'locked-in': records.some((x) => x.rec.review?.learned === true),
  }
  return ACHIEVEMENTS.filter((a) => met[a.id] && prev.achievements[a.id] === undefined).map((a) => a.id)
}
