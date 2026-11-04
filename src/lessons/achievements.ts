// Achievements, checked after every finished run.
import type { AchievementDef, Lesson, LessonResult, Progress } from './types'
import { LESSONS, WORLDS } from './data'

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-peep', name: 'First Peep', text: 'Pass your first lesson.' },
  { id: 'out-of-shell', name: 'Out of the Shell', text: 'Beat a world boss and hatch your dino.' },
  { id: 'first-jam', name: 'First Jam', text: 'Pass First Jam.' },
  { id: 'three-of-a-kind', name: 'Three of a Kind', text: 'Get 3 stars on any lesson.' },
  { id: 'clean-sheet', name: 'Clean Sheet', text: 'Finish a run without a miss or a wrong note.', cosmetic: 'shades' },
  { id: 'chain-gang', name: 'Chain Gang', text: 'Hit 32 good notes in a row.' },
  { id: 'big-roar', name: 'Big Roar', text: 'Keep a roar going for 30 seconds in one run.' },
  { id: 'right-on-time', name: 'Right on Time', text: 'Nail 20 notes in a row.' },
  { id: 'week-stomper', name: 'Week Stomper', text: 'Practise 7 days in a row.', cosmetic: 'bandana' },
  { id: 'month-stomper', name: 'Month Stomper', text: 'Practise 30 days in a row.', cosmetic: 'pick-crown' },
  { id: 'power-up', name: 'Power Up', text: 'Pass the power chord lesson in World 4.' },
  { id: 'bendy', name: 'Bendy', text: 'Bend 25 notes in tune.' },
  { id: 'free-spirit', name: 'Free Spirit', text: 'Get 3 stars on a free-play lesson.' },
  { id: 'comeback', name: 'Comeback', text: 'Pass a lesson after 3 or more tries.' },
  { id: 'late-show', name: 'Late Show', text: 'Pass a lesson between 10 pm and 4 am.' },
  { id: 'titan', name: 'Titan', text: 'Pass the final boss.', cosmetic: 'star-guitar' },
]

const passed = (p: Progress, id: string) => p.lessons[id]?.passedAt !== undefined

function bossPassed(p: Progress) {
  return WORLDS.some((w) => {
    const boss = w.lessons.find((id) => LESSONS.some((l) => l.id === id && l.boss)) ?? w.lessons[w.lessons.length - 1]
    return boss !== undefined && passed(p, boss)
  })
}

/** Ids earned by this run that `prev` did not have yet. `next` is the progress after the run. */
export function checkAchievements(prev: Progress, next: Progress, lesson: Lesson, r: LessonResult, now: Date): string[] {
  const hour = now.getHours()
  const improvIds = new Set(LESSONS.filter((l) => l.type === 'improv').map((l) => l.id))
  const records = Object.keys(next.lessons).map((id) => ({ id, rec: next.lessons[id] }))
  const prevRec = prev.lessons[lesson.id]
  const met: Record<string, boolean> = {
    'first-peep': passed(next, 'w1-01'),
    'out-of-shell': bossPassed(next),
    'first-jam': passed(next, 'w2-05'),
    'three-of-a-kind': records.some((x) => x.rec.stars === 3),
    'clean-sheet': r.clean,
    'chain-gang': r.bestChain >= 32,
    'big-roar': r.roarMs >= 30000,
    'right-on-time': r.perfectRun >= 20,
    'week-stomper': next.streak.days >= 7,
    'month-stomper': next.streak.days >= 30,
    'power-up': passed(next, 'w4-04'),
    bendy: next.stats.bendsInTune >= 25,
    'free-spirit': records.some((x) => improvIds.has(x.id) && x.rec.stars === 3),
    comeback: r.passed && prevRec?.passedAt === undefined && (prevRec?.fails ?? 0) >= 3,
    'late-show': r.passed && (hour >= 22 || hour < 4),
    titan: passed(next, 'w8-05'),
  }
  return ACHIEVEMENTS.filter((a) => met[a.id] && prev.achievements[a.id] === undefined).map((a) => a.id)
}
