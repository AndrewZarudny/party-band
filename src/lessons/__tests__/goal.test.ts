import { beforeEach, describe, expect, it } from 'vitest'
import { goalPace, loadGoal, pathShare, saveGoal } from '../goal'
import type { SongGoal } from '../goal'

const goal: SongGoal = { songId: 'numb', title: 'Numb', by: '2026-12-31', setAt: new Date('2026-11-01T12:00:00').getTime() }
const levels = (done: number, total: number, extra: object = {}) => ({ track: 'Guitar', total, passed: Object.fromEntries(Array.from({ length: done }, (_, i) => [String(i), { pct: 80, speed: 80 }])), ...extra })

describe('a song goal', () => {
  beforeEach(() => localStorage.clear())

  it('is kept, and can be taken off', () => {
    saveGoal(goal)
    expect(loadGoal()).toEqual(goal)
    saveGoal(null)
    expect(loadGoal()).toBeNull()
  })

  it('progress along the path: parts 40%, with the song 25%, whole song 20%, band-ready 15%', () => {
    const parts = [{ passed: true }, { passed: false }]
    expect(pathShare(parts, null)).toBeCloseTo(0.2)
    expect(pathShare([{ passed: true }, { passed: true }], levels(2, 4))).toBeCloseTo(0.4 + 0.125)
    expect(pathShare([{ passed: true }], { ...levels(1, 1), full: { pct: 80, speed: 100 }, ready: { pct: 90, speed: 100 } })).toBeCloseTo(1)
  })

  it('on track, ahead or behind: progress against the time passed', () => {
    const mid = new Date('2026-12-01T12:00:00') // about half the time gone
    expect(goalPace(goal, 0.5, mid).status).toBe('on track')
    expect(goalPace(goal, 0.75, mid).status).toBe('ahead')
    expect(goalPace(goal, 0.2, mid).status).toBe('behind')
    expect(goalPace(goal, 1, mid).status).toBe('done')
    expect(goalPace(goal, 0.9, new Date('2027-01-02T12:00:00')).status).toBe('past')
    expect(goalPace(goal, 0.5, mid).daysLeft).toBe(31)
  })
})
