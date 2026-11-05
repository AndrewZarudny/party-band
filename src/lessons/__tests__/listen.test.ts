import { describe, expect, it } from 'vitest'
import type { LessonRecord, ReviewState } from '../types'
import { QUIET_BAND, isJam, tabLevelFor } from '../listen'
import { lessonById } from '../data'

const rec = (review?: Partial<ReviewState>): LessonRecord => ({
  best: 80, stars: 2, plays: 3, fails: 0, passedAt: 1, bestChain: 10, clean: false, playsDay: '2026-01-01', playsToday: 0, lastPlayed: 1,
  review: review ? { step: 0, due: 2, coldPasses: 0, lastColdS: 0, learned: false, ...review } : undefined,
})

describe('tabLevelFor', () => {
  it('shows the full tab before any review', () => {
    expect(tabLevelFor(undefined)).toBe('full')
    expect(tabLevelFor(rec())).toBe('full')
    expect(tabLevelFor(rec({ coldPasses: 0 }))).toBe('full')
  })

  it('fades after one cold pass and hides after two', () => {
    expect(tabLevelFor(rec({ coldPasses: 1 }))).toBe('faded')
    expect(tabLevelFor(rec({ coldPasses: 2 }))).toBe('hidden')
  })

  it('hides for learned items', () => {
    expect(tabLevelFor(rec({ coldPasses: 0, learned: true }))).toBe('hidden')
  })
})

describe('listen mode', () => {
  it('plays the band louder', () => {
    expect(QUIET_BAND).toBeGreaterThan(1)
  })

  it('treats improv lessons as jams', () => {
    expect(isJam(lessonById('w8-06')!)).toBe(true)
    expect(isJam(lessonById('w3-07')!)).toBe(false)
  })
})
