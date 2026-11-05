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
    // No streak or daily goal is worked out from practice time.
    expect('weekStreak' in s).toBe(false)
  })
})
