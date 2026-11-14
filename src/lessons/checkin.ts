// The check-in after a session: how it felt (too easy, about right, too hard) and a line for the coach. The next
// session's plan follows the feel (session.ts PlanCtx.lastFeel); the coach reads the line.
import { dayKey } from './progress'

export type Feel = 'easy' | 'right' | 'hard'
export interface CheckIn {
  day: string // dayKey of the session
  feel: Feel
  note: string
}

const KEY = 'session-checkin'

export function loadCheckIns(): CheckIn[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CheckIn[]
    return Array.isArray(a) ? a.filter((c) => c && typeof c.day === 'string' && ['easy', 'right', 'hard'].includes(c.feel)) : []
  } catch {
    return []
  }
}

/** Saves today's check-in (a second one today replaces it); the last 30 are kept. */
export function saveCheckIn(c: CheckIn) {
  const all = [...loadCheckIns().filter((x) => x.day !== c.day), c].sort((a, b) => a.day.localeCompare(b.day)).slice(-30)
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable */
  }
}

export const todayCheckIn = (now: Date) => loadCheckIns().find((c) => c.day === dayKey(now)) ?? null

/** The check-in of the last session before today: what today's plan follows. */
export function lastCheckIn(now: Date): CheckIn | null {
  const before = loadCheckIns().filter((c) => c.day < dayKey(now))
  return before.length ? before[before.length - 1] : null
}
