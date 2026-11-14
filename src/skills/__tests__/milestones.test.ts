import { describe, expect, it } from 'vitest'
import { milestoneDue, monthKey, thenAndNow } from '../milestones'

const take = (month: string, at: number, pieceId = 'w1-02') => ({ month, at, pieceId })

describe('then and now', () => {
  it('a month key per calendar month', () => {
    expect(monthKey(new Date('2026-11-14T10:00:00'))).toBe('2026-11')
    expect(monthKey(new Date('2027-01-02T10:00:00'))).toBe('2027-01')
  })

  it("this month's take is due until it's recorded; nothing is due before a piece is chosen", () => {
    const now = new Date('2026-11-14T10:00:00')
    expect(milestoneDue([], 'w1-02', now)).toBe(true)
    expect(milestoneDue([take('2026-10', 1)], 'w1-02', now)).toBe(true)
    expect(milestoneDue([take('2026-11', 2)], 'w1-02', now)).toBe(false)
    expect(milestoneDue([take('2026-11', 2, 'other')], 'w1-02', now)).toBe(true) // another piece's take
    expect(milestoneDue([], null, now)).toBe(false)
  })

  it('then and now: the first and the latest take of the piece, from different months', () => {
    expect(thenAndNow([take('2026-11', 1)], 'w1-02')).toBeNull()
    const r = thenAndNow([take('2026-12', 5), take('2026-10', 1), take('2026-11', 3)], 'w1-02')
    expect(r?.then.month).toBe('2026-10')
    expect(r?.now.month).toBe('2026-12')
    expect(thenAndNow([take('2026-10', 1), take('2026-10', 2)], 'w1-02')).toBeNull()
  })
})
