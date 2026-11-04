// What the account menu and the practice panel show, worked out from the log.
import { useMemo, useSyncExternalStore } from 'react'
import type { PracticeKind, Secs } from './data'
import { KINDS, dayKey, daysBefore, sum, zero } from './data'
import type { PracticeSnapshot } from './log'
import { getPracticeSnapshot, subscribePractice } from './log'

/** A day counts towards the streak with this much practice. */
export const STREAK_SEC = 300
/** Days with less than this aren't "practice days" for the average (a stray strum). */
const PRACTICE_DAY_SEC = 60

export interface DayBar {
  key: string
  date: Date
  secs: Secs
  total: number
}

export interface PracticeSummary {
  today: number
  week: number
  total: number
  week7: DayBar[] // this week, Monday to Sunday
  last30: DayBar[] // oldest first, ending today
  byKind30: Secs
  total30: number
  streak: number
  best: DayBar | null
  average: number
  practiceDays: number
}

export const KIND_LABEL: Record<PracticeKind, string> = {
  lessons: 'Lessons',
  songs: 'Learning songs',
  jam: 'Jamming',
  guitar: 'Just playing',
}

function bar(snap: PracticeSnapshot, date: Date): DayBar {
  const key = dayKey(date)
  const secs = snap.days.get(key) ?? zero()
  return { key, date, secs, total: sum(secs) }
}

export function summarize(snap: PracticeSnapshot): PracticeSummary {
  const now = snap.today
  const todayKey = dayKey(now)
  const monday = (now.getDay() + 6) % 7 // days since Monday
  const week7 = Array.from({ length: 7 }, (_, i) => bar(snap, daysBefore(now, monday - i)))
  const last30 = Array.from({ length: 30 }, (_, i) => bar(snap, daysBefore(now, 29 - i)))

  let total = sum(snap.before)
  let best: DayBar | null = null
  let practiced = 0
  let practiceDays = 0
  for (const [key, secs] of snap.days) {
    const t = sum(secs)
    total += t
    if (!best || t > best.total) best = { key, date: new Date(`${key}T12:00:00`), secs, total: t }
    if (t >= PRACTICE_DAY_SEC) {
      practiced += t
      practiceDays++
    }
  }
  if (best && best.total === 0) best = null

  // Today still counts as "in progress": a streak isn't broken until a whole day is missed.
  let streak = 0
  const todayTotal = sum(snap.days.get(todayKey) ?? zero())
  for (let i = todayTotal >= STREAK_SEC ? 0 : 1; i <= snap.days.size; i++) {
    if (sum(snap.days.get(dayKey(daysBefore(now, i))) ?? zero()) < STREAK_SEC) break
    streak++
  }

  const byKind30 = KINDS.map((_, k) => last30.reduce((n, d) => n + d.secs[k], 0))
  return {
    today: todayTotal,
    week: week7.reduce((n, d) => n + d.total, 0),
    total,
    week7,
    last30,
    byKind30,
    total30: sum(byKind30),
    streak,
    best,
    average: practiceDays ? Math.round(practiced / practiceDays) : 0,
    practiceDays,
  }
}

/** Live: updates every counted second. */
export function usePractice(): PracticeSummary {
  const snap = useSyncExternalStore(subscribePractice, getPracticeSnapshot)
  return useMemo(() => summarize(snap), [snap])
}

/** "0 min", "under 1 min", "25 min", "1 h 5 min", "41 h". */
export function fmtDuration(sec: number): string {
  if (sec <= 0) return '0 min'
  if (sec < 60) return 'under 1 min'
  const m = Math.floor(sec / 60)
  const h = Math.floor(m / 60)
  if (!h) return `${m} min`
  if (h >= 100 || m % 60 === 0) return `${h} h`
  return `${h} h ${m % 60} min`
}

export const fmtDay = (d: Date, long = false): string =>
  d.toLocaleDateString(undefined, long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' })
