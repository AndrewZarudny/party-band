// The 12-week plan (research section 5): what each fortnight is for, and whether its checkpoint is met. Pure.
import type { Progress, WorldId } from './types'
import type { SkillStats } from '../skills/data'
import { bestKey, median } from '../skills/data'
import { CORE_PAIRS } from '../skills/chords'
import { PLAN_LESSONS } from './data'
import { dayKey, daysBetween } from './progress'

export type CheckState = 'met' | 'partial' | 'open'

export interface PlanWeek {
  from: number
  to: number
  focus: string
  worlds: WorldId[]
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
    worlds: [1, 3, 4],
    lessons: PLAN_LESSONS[0],
    checkpoint: 'One full 12-bar shuffle rhythm in A at 60 BPM without stopping',
    check: (p) => (cleanCold(p, 'w3-07', 60) ? 'met' : passed(p, 'w3-07') || cleanInSession(p, 'w3-07', 60) ? 'partial' : 'open'),
  },
  {
    from: 3,
    to: 4,
    focus: 'Open A, D, E, then A7, D7, E7; 8th strumming; notes on the low E string',
    worlds: [3, 2],
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
    worlds: [5, 7],
    lessons: PLAN_LESSONS[2],
    checkpoint: 'Box 1 in 8ths at 70 BPM up and down; licks over the 12-bar',
    check: (p) => halves(cleanCold(p, 'w5-11', 70), passed(p, 'w5-07')),
  },
  {
    from: 7,
    to: 8,
    focus: 'Bends, slides, vibrato; G, C, Em; notes on the A string',
    worlds: [6, 3, 2],
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
    worlds: [5, 8],
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
    worlds: [8],
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
