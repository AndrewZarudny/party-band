import { describe, expect, it } from 'vitest'
import type { PracticeSnapshot } from '../log'
import { summarize } from '../stats'

const snap = (days: Record<string, number>, today: Date): PracticeSnapshot => ({
  days: new Map(Object.entries(days).map(([k, s]) => [k, [s, 0, 0, 0]])),
  early: new Map(),
  before: [0, 0, 0, 0],
  today,
})
const WED = new Date(2026, 10, 4, 12) // Wednesday 4 Nov 2026; the week starts Monday 2 Nov

describe('summarize', () => {
  it('shows time only: today, this week, total, best day and the average per practice day', () => {
    const days = { '2026-10-26': 300, '2026-11-02': 500, '2026-11-03': 30, '2026-11-04': 900 }
    const s = summarize(snap(days, WED))
    expect(s).toMatchObject({ today: 900, week: 1430, total: 1730, practiceDays: 3, average: Math.round((300 + 500 + 900) / 3) })
    expect(s.best?.key).toBe('2026-11-04')
    expect(s.week7.map((d) => d.total)).toEqual([500, 30, 900, 0, 0, 0, 0])
    // The daily goal is only aimed at, never judged: no streak, and no day is marked as missed.
    for (const k of ['weekStreak', 'streak', 'missed', 'missedDays']) expect(k in s).toBe(false)
    for (const d of [...s.week7, ...s.last30]) expect(Object.keys(d).sort()).toEqual(['date', 'key', 'secs', 'total'])
  })
})
