// The 12-week plan (research section 5): what each fortnight is for, and whether its checkpoint is met. Pure.
import type { Progress, StageId } from './types'
import type { SkillStats } from '../skills/data'
import { bestKey, median } from '../skills/data'
import { CORE_PAIRS } from '../skills/chords'
import { PLAN_LESSONS, lessonById } from './data'
import { dayKey, daysBetween, nextLesson } from './progress'
import { REVIEW_BRAKE, strugglingList, weekStatus } from './review'

export type CheckState = 'met' | 'partial' | 'open'

export interface PlanWeek {
  from: number
  to: number
  focus: string
  stage: StageId // its stage on the map
  lessons: string[]
  checkpoint: string
  check: (p: Progress, stats: SkillStats) => CheckState
}

export const BEND_OK_CENTS = 30 // heuristic: bends "in tune" when the median of the last 10 is within 30 cents
export const EAR_FIRST_OK = 60 // heuristic for "most of a set" echoed at the first attempt
export const CHANGES_MID = 40 // research: one-minute changes "in the 40s"
export const TAKE_SEC = 120 // a recorded take of at least 2 minutes

const cleanCold = (p: Progress, id: string, bpm: number) => (p.lessons[id]?.hist ?? []).some((h) => !!h.cold?.clean && h.cold.bpm >= bpm)
const cleanInSession = (p: Progress, id: string, bpm: number) => (p.lessons[id]?.hist ?? []).some((h) => (h.best ?? 0) >= bpm)
const passed = (p: Progress, id: string) => p.lessons[id]?.passedAt !== undefined
const pairBest = (s: SkillStats, pair: string) => s.best[bestKey('changes', pair)]

/** Two halves: both met, one met, or neither. */
const halves = (a: boolean, b: boolean): CheckState => (a && b ? 'met' : a || b ? 'partial' : 'open')

export const PLAN_WEEKS: PlanWeek[] = [
  {
    from: 1,
    to: 2,
    focus: 'Setup, posture, muting; downstrokes with the band; A5, D5, E5 and the boogie shuffle',
    stage: 1,
    lessons: PLAN_LESSONS[0],
    checkpoint: 'One full 12-bar shuffle rhythm in A at 60 BPM without stopping',
    check: (p) => (cleanCold(p, 'w3-07', 60) ? 'met' : passed(p, 'w3-07') || cleanInSession(p, 'w3-07', 60) ? 'partial' : 'open'),
  },
  {
    from: 3,
    to: 4,
    focus: 'Open A, D, E, then A7, D7, E7; 8th strumming; notes on the low E string',
    stage: 2,
    lessons: PLAN_LESSONS[1],
    checkpoint: 'One-minute changes baseline per chord pair; shuffle at 70 BPM',
    check: (p, s) =>
      halves(
        CORE_PAIRS.every((k) => pairBest(s, k) !== undefined),
        cleanCold(p, 'w3-10', 70),
      ),
  },
  {
    from: 5,
    to: 6,
    focus: 'A minor pentatonic box 1; 2–3 blues licks; short call and response',
    stage: 3,
    lessons: PLAN_LESSONS[2],
    checkpoint: 'Box 1 in 8ths at 70 BPM up and down; licks over the 12-bar',
    check: (p) => halves(cleanCold(p, 'w5-11', 70), passed(p, 'w5-07')),
  },
  {
    from: 7,
    to: 8,
    focus: 'Bends, slides, vibrato; G, C, Em; notes on the A string',
    stage: 4,
    lessons: PLAN_LESSONS[3],
    checkpoint: 'Bends in tune; echo 2-bar phrases at the first attempt for most of a set',
    check: (p, s) => {
      const bends = p.runs
        .filter((r) => r.bend !== null)
        .sort((a, b) => a.at - b.at)
        .slice(-10)
        .map((r) => r.bend as number)
      const m = median(bends)
      const ear = (s.best[bestKey('earFirst')] ?? 0) >= EAR_FIRST_OK
      return halves(m !== null && m <= BEND_OK_CENTS, ear)
    },
  },
  {
    from: 9,
    to: 10,
    focus: 'A major pentatonic; landing on the root at chord changes; blues in E',
    stage: 5,
    lessons: PLAN_LESSONS[4],
    checkpoint: 'One-minute changes in the 40s on core pairs, heading for 60',
    check: (_p, s) => {
      const ok = CORE_PAIRS.filter((k) => (pairBest(s, k) ?? 0) >= CHANGES_MID).length
      return ok === CORE_PAIRS.length ? 'met' : ok > 0 ? 'partial' : 'open'
    },
  },
  {
    from: 11,
    to: 12,
    focus: 'One relaxed rock song plus a 12-bar jam',
    stage: 6,
    lessons: PLAN_LESSONS[5],
    checkpoint: '3 choruses (rhythm, solo, rhythm) at 70–80 BPM without stopping, recorded',
    check: (p, s) => {
      const run = p.runs.some((r) => r.id === 'w8-12' && r.bpm >= 70 && r.bpm <= 80 && r.jam?.silentBars === 0)
      const take = s.history.some((e) => e.game === 'record' && e.score >= TAKE_SEC)
      return run && take ? 'met' : run ? 'partial' : 'open'
    },
  },
]

/** Weeks since the first counted session, 1-based (min 1); 1 before any session. */
export function planWeek(p: Progress, now: Date): number {
  const first = p.sessions.log.find((d) => d.counted)?.day
  if (!first) return 1
  const days = daysBetween(first, dayKey(now))
  return Number.isFinite(days) ? Math.max(1, Math.floor(days / 7) + 1) : 1
}

/** The plan row for a week number; null past week 12. */
export function planRow(week: number): PlanWeek | null {
  return PLAN_WEEKS.find((w) => week >= w.from && week <= w.to) ?? null
}

// ---- Pace: where the calendar says you'd be, where your lessons are, and what to do about the difference ----

export type PaceState = 'ahead' | 'on' | 'behind' | 'finished'

export interface Pace {
  week: number // the calendar week of the plan (1 = the week of the first counted session)
  state: PaceState
  /** Fortnights between where the lessons are and where the calendar is: above 0 ahead, below 0 behind. */
  offset: number
  working: PlanWeek | null // the fortnight whose lessons are being worked on; null when all are passed
  passed: number // lessons passed in the working fortnight
  total: number
  headline: string // "Week 3 of 12: on schedule"
  advice: string[] // what to do next, most useful first
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Pace against the 12-week plan. The calendar gives the fortnight you'd be in; the lessons passed give the one you
 * are in. Ahead only counts as good news when the earlier checkpoints are met and nothing is failing its cold start:
 * lessons opened faster than they stick is the pattern the plan's review brake exists for.
 */
export function pace(p: Progress, stats: SkillStats, now: Date): Pace {
  const week = planWeek(p, now)
  const lessonsPassed = (w: PlanWeek) => w.lessons.filter((id) => passed(p, id)).length
  const wi = PLAN_WEEKS.findIndex((w) => lessonsPassed(w) < w.lessons.length)
  const working = wi < 0 ? null : PLAN_WEEKS[wi]
  const calendar = Math.min(PLAN_WEEKS.length - 1, Math.floor((Math.min(week, 12) - 1) / 2))
  const offset = (wi < 0 ? PLAN_WEEKS.length : wi) - calendar
  const stuck = strugglingList(p).length
  const brake = stuck >= REVIEW_BRAKE
  const unmet = PLAN_WEEKS.slice(0, wi < 0 ? PLAN_WEEKS.length : wi).filter((w) => w.check(p, stats) !== 'met')
  const ws = weekStatus(p, now)
  const next = nextLesson(p)
  const nextTitle = next ? (lessonById(next)?.title ?? null) : null
  const state: PaceState = wi < 0 ? 'finished' : offset > 0 ? 'ahead' : offset < 0 ? 'behind' : 'on'
  const label = week > 12 ? 'Past week 12' : `Week ${week} of 12`
  const advice: string[] = []
  const sessionsLeft = Math.max(0, ws.goal - ws.done)

  if (state === 'finished') {
    advice.push('Every plan lesson is passed. Keep the reviews going, jam, and work through your songs.')
  } else if (state === 'behind') {
    advice.push(`The calendar is in weeks ${PLAN_WEEKS[calendar].from}–${PLAN_WEEKS[calendar].to}; your lessons are in weeks ${working!.from}–${working!.to}. That is fine: the plan is a guide, not a deadline.`)
    if (brake) advice.push(`First clear the review: ${plural(stuck, 'lesson')} ${stuck === 1 ? "isn't" : "aren't"} sticking yet. New lessons come back once a few pass their cold start.`)
    else if (nextTitle) advice.push(`To catch up, keep the new block in every session it comes up. Next: ${nextTitle}.`)
    if (sessionsLeft > 0) advice.push(`${plural(sessionsLeft, 'more session')} this week ${sessionsLeft === 1 ? 'reaches' : 'reach'} your goal of ${ws.goal}. Regular sessions catch up faster than long ones.`)
    else advice.push('Your week goal is met. One more session this week is the quickest way to catch up.')
  } else if (state === 'ahead') {
    if (brake || unmet.length) {
      advice.push('You have opened lessons faster than they are sticking. Slow down: repeat before adding.')
      if (brake) advice.push(`${plural(stuck, 'lesson')} ${stuck === 1 ? 'is' : 'are'} failing the cold start. Sessions are review first until a few pass.`)
      for (const w of unmet.slice(0, 2)) advice.push(`Weeks ${w.from}–${w.to} checkpoint not met yet: ${w.checkpoint}.`)
    } else {
      advice.push('Ahead of the calendar, and the earlier checkpoints are met. Keep this pace, or put the spare time into jams and your songs.')
    }
  } else {
    advice.push(`On schedule: ${lessonsPassed(working!)} of ${working!.lessons.length} lessons of weeks ${working!.from}–${working!.to} passed.`)
    if (brake) advice.push(`${plural(stuck, 'lesson')} ${stuck === 1 ? "isn't" : "aren't"} sticking yet, so sessions are review first for now.`)
    else if (nextTitle) advice.push(`Next: ${nextTitle}.`)
    advice.push(`This fortnight's checkpoint: ${working!.checkpoint}.`)
    if (sessionsLeft > 0) advice.push(`${plural(sessionsLeft, 'more session')} this week ${sessionsLeft === 1 ? 'reaches' : 'reach'} your goal of ${ws.goal}.`)
  }

  const word = state === 'finished' ? 'plan lessons done' : state === 'on' ? 'on schedule' : `about ${plural(Math.abs(offset) * 2, 'week')} ${state}`
  return {
    week,
    state,
    offset,
    working,
    passed: working ? lessonsPassed(working) : 0,
    total: working ? working.lessons.length : 0,
    headline: `${label}: ${word}`,
    advice,
  }
}
