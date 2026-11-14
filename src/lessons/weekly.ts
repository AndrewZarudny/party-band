// The weekly review: at the start of a new week, the coach looks back at the week just finished (what improved,
// what is stuck) and names this week's focus. The focus is picked here from the data, so the plan can put those
// lessons first all week (session.ts) and the coach's words match what the plan does.
import type { Progress } from './types'
import { lessonById } from './data'
import { closestThirdStar, dayKey, isPassed, isPlateau, thirdStar, timingHabit } from './progress'
import { strugglingList, weekKey } from './review'
import { goalFacts } from './goal'
import { loadCheckIns } from './checkin'
import { loadJamHistory } from '../music/jamSummary'
import { songWork } from '../music/songRuns'
import { loadLevels } from '../music/songLevels'

const DAY = 86_400_000

/** Up to two lessons to focus on this week, with why: not sticking, then a plateau, a timing habit, a near third star. */
export function weekFocus(p: Progress, now: Date): { id: string; why: string }[] {
  const out: { id: string; why: string }[] = []
  const add = (id: string, why: string) => {
    if (out.length < 2 && !out.some((f) => f.id === id) && lessonById(id)) out.push({ id, why })
  }
  for (const id of strugglingList(p)) add(id, 'not sticking at its first tries yet')
  const played = Object.entries(p.lessons).sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)
  for (const [id, rec] of played) if (isPassed(p, id) && isPlateau(rec)) add(id, `no new best in ${rec.flat} runs`)
  for (const [id] of played) {
    const h = timingHabit(p.runs, id)
    if (h && now.getTime() - (p.lessons[id]?.lastPlayed ?? 0) < 14 * DAY) add(id, `usually about ${h.ms} ms ${h.dir}`)
  }
  const star = closestThirdStar(p)
  if (star) add(star.id, star.gap > 0 ? `${star.gap} points from its third star` : 'its third star needs full tempo')
  return out
}

/** The Monday (dayKey) of the week before `now`'s week. */
export const lastWeekKey = (now: Date) => weekKey(dayKey(new Date(now.getTime() - 7 * DAY)))

/** Facts about the week just finished, for the coach's weekly review. */
export function weeklyFacts(p: Progress, now: Date, name: string | null) {
  const from = new Date(lastWeekKey(now) + 'T00:00:00').getTime()
  const to = from + 7 * DAY
  const inWeek = (t: number) => t >= from && t < to
  const days = (p.sessions?.log ?? []).filter((d) => d.day >= lastWeekKey(now) && d.day < weekKey(dayKey(now)))
  const runs = (p.runs ?? []).filter((r) => inWeek(r.at))
  // Lessons that still exist (a deleted song's parts are gone).
  const perLesson = new Map<string, number>()
  for (const r of runs) if (lessonById(r.id)) perLesson.set(r.id, (perLesson.get(r.id) ?? 0) + 1)
  const title = (id: string) => lessonById(id)?.title ?? id
  return {
    moment: "the start of a new week: the player opened the app, and this is the weekly review of last week",
    player: name,
    dino: p.dinoName,
    lastWeek: {
      sessions: days.filter((d) => d.counted).length,
      sessionGoal: p.weekGoal ?? 3,
      minutes: Math.round(days.reduce((a, d) => a + d.sec, 0) / 60),
      handPain: days.some((d) => d.pain && d.pain !== 'none'),
    },
    mostPlayed: [...perLesson.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ lesson: title(id), runs: n, bestScorePercent: p.lessons[id]?.best ?? null, stars: p.lessons[id]?.stars ?? 0 })),
    passedLastWeek: Object.entries(p.lessons).filter(([, r]) => r.passedAt !== undefined && inWeek(r.passedAt)).map(([id]) => title(id)),
    stuck: Object.entries(p.lessons).filter(([id, r]) => lessonById(id) && isPassed(p, id) && isPlateau(r)).map(([id, r]) => ({ lesson: title(id), runsWithoutNewBest: r.flat })),
    notStickingYet: strugglingList(p).map(title),
    timingHabits: [...perLesson.keys()].map((id) => ({ id, h: timingHabit(p.runs, id) })).filter((x) => x.h).map((x) => ({ lesson: title(x.id), usually: x.h!.dir, byMs: x.h!.ms })),
    thirdStars: [...perLesson.keys()].map((id) => ({ id, t: thirdStar(lessonById(id), p.lessons[id]) })).filter((x) => x.t && x.t.gap <= 8).map((x) => ({ lesson: title(x.id), pointsToGo: x.t!.gap })),
    focusThisWeek: weekFocus(p, now).map((f) => ({ lesson: title(f.id), why: f.why })),
    songGoal: goalFacts((id) => isPassed(p, id), (id) => !!lessonById(id), loadLevels, now),
    // Free jams in the Jam tab: how much, and how the notes sat against the chords and the scale, against the week before.
    // Learn a song: runs per song and where each part's score moved last week.
    songWork: songWork(from, to),
    jamming: (() => {
      const all = loadJamHistory()
      const week = all.filter((j) => inWeek(j.at))
      if (!week.length) return null
      const prev = all.filter((j) => j.at >= from - 7 * DAY && j.at < from)
      const avg = (js: typeof all, f: (j: (typeof all)[number]) => number) => (js.length ? Math.round(js.reduce((a, j) => a + f(j), 0) / js.length) : null)
      return {
        jams: week.length,
        minutes: Math.round(week.reduce((a, j) => a + j.sec, 0) / 60),
        chordTonesPercent: avg(week, (j) => j.chordPct),
        outsidePercent: avg(week, (j) => j.outPct),
        weekBefore: prev.length ? { jams: prev.length, chordTonesPercent: avg(prev, (j) => j.chordPct), outsidePercent: avg(prev, (j) => j.outPct) } : null,
      }
    })(),
    // How the sessions felt to the player, in their own words (the check-ins after each session).
    checkIns: loadCheckIns()
      .filter((c) => c.day >= lastWeekKey(now) && c.day < weekKey(dayKey(now)))
      .map((c) => ({ day: c.day, felt: c.feel === 'easy' ? 'too easy' : c.feel === 'hard' ? 'too hard' : 'about right', note: c.note || null })),
    instruction:
      'Write the weekly review: what improved last week, what is stuck and what that means, then this week\'s focus, naming the focusThisWeek lessons and why (the plan puts them first all week). If the player left check-ins, say how the week felt to them and answer any note. "next" is the single most important thing for this week.',
  }
}

// ---- Shown once per week, until the player dismisses it ----------------------------------------------

const KEY = 'coach-week'
interface Saved {
  week: string // lastWeekKey the review is about
  note?: { message: string; next: string }
  seen?: boolean
}

function read(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
  } catch {
    return null
  }
}
function write(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

/** The review to show this week: when the player practised last week and hasn't dismissed it yet. */
export function weeklyDue(p: Progress, now: Date): boolean {
  const week = lastWeekKey(now)
  const practised = (p.sessions?.log ?? []).some((d) => d.day >= week && d.day < weekKey(dayKey(now)) && d.sec > 0)
  const saved = read()
  return practised && !(saved?.week === week && saved.seen)
}

export const savedWeekly = (now: Date) => {
  const s = read()
  return s?.week === lastWeekKey(now) ? (s.note ?? null) : null
}
export const saveWeekly = (now: Date, note: { message: string; next: string }) => write({ week: lastWeekKey(now), note })
export const dismissWeekly = (now: Date) => write({ ...(read() ?? {}), week: lastWeekKey(now), seen: true })
