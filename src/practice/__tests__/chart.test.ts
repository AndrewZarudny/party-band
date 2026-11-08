import { describe, expect, it } from 'vitest'
import { chartCaption, chartScale } from '../chart'
import { GOAL_CHOICES } from '../goal'
import type { PracticeSnapshot } from '../log'
import { summarize } from '../stats'

const TODAY = new Date(2026, 10, 4, 12)
const snap = (days: Record<string, number>): PracticeSnapshot => ({
  days: new Map(Object.entries(days).map(([k, s]) => [k, [s, 0, 0, 0]])),
  early: new Map(),
  before: [0, 0, 0, 0],
  today: TODAY,
})

describe('chartScale', () => {
  it('keeps room above the goal line for its label, in a quiet month too', () => {
    for (const goal of GOAL_CHOICES)
      for (const max of [0, 600, goal * 60, goal * 60 + 30]) {
        const { top } = chartScale(max, goal * 60)
        expect(goal * 60 / top, `goal ${goal}, busiest day ${max}`).toBeLessThanOrEqual(1 / 1.15)
        expect(top).toBeGreaterThanOrEqual(max)
      }
  })
})

describe('chartCaption', () => {
  it("tells the days that reached the goal, and never counts a month that didn't", () => {
    const quiet = chartCaption(summarize(snap({ '2026-11-02': 600, '2026-11-03': 600 })), 30)
    expect(quiet).not.toMatch(/goal/i)
    expect(quiet).not.toMatch(/\b0 days\b/)
    expect(chartCaption(summarize(snap({ '2026-11-02': 1800, '2026-11-03': 600 })), 30)).toMatch(/The goal was reached on 1 day\.$/)
    expect(chartCaption(summarize(snap({})), 30)).toBe('No practice in the last 30 days yet.')
  })
})
