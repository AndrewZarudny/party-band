import { beforeEach, describe, expect, it } from 'vitest'
import { loadRuns, partTrend, saveRun, weakestPart } from '../songRuns'

const run = (part: number | 'full', pct: number, at = 1) => ({ at, part, pct, speed: 80, passed: pct >= 70 })

describe('runs in Learn a song', () => {
  beforeEach(() => localStorage.clear())

  it('kept per song, the last 300', () => {
    for (let i = 0; i < 305; i++) saveRun('s', run(0, 50, i))
    expect(loadRuns('s').length).toBe(300)
    expect(loadRuns('s')[0].at).toBe(5)
    expect(loadRuns('other')).toEqual([])
  })

  it("a part's trend: its last five runs, oldest first", () => {
    const runs = [run(0, 40), run(1, 90), run(0, 50), run(0, 58), run(0, 61), run(0, 66), run(0, 72)]
    expect(partTrend(runs, 0)).toEqual([50, 58, 61, 66, 72])
  })

  it('the weakest part: lowest recent average among parts not good yet; never played counts as 0', () => {
    const runs = [run(0, 80), run(1, 55), run(1, 60), run(2, 90)]
    const passedPct = (i: number) => (i === 2 ? 90 : null)
    expect(weakestPart(runs, 3, passedPct)).toBe(1)
    expect(weakestPart(runs, 4, passedPct)).toBe(3) // part 3 never played
    expect(weakestPart(runs, 3, () => 95)).toBeNull()
  })
})

describe('song work across songs', () => {
  beforeEach(() => localStorage.clear())
  it('per song in the window: runs, passes, and where each part moved', async () => {
    const { songWork } = await import('../songRuns')
    const r = (at: number, partName: string, pct: number, title = 'ZOMBIE') => ({ at, part: 0, partName, pct, speed: 80, passed: pct >= 70, title })
    saveRun('z', r(5, 'Solo', 50))
    saveRun('z', r(15, 'Solo', 60))
    saveRun('z', r(16, 'Solo', 78))
    saveRun('z', r(17, 'Intro', 90))
    saveRun('n', r(1, 'Verse', 40, 'Numb')) // before the window
    expect(songWork(10, 20)).toEqual([{ song: 'ZOMBIE', runs: 3, passes: 2, parts: [{ part: 'Solo', runs: 2, firstPct: 60, lastPct: 78 }, { part: 'Intro', runs: 1, firstPct: 90, lastPct: 90 }] }])
  })
})

describe("a song's recent move", () => {
  beforeEach(() => localStorage.clear())
  it('its busiest part this week, first and last score', async () => {
    const { recentMove } = await import('../songRuns')
    const day = 86_400_000
    const now = 30 * day
    const r = (at: number, partName: string, pct: number) => ({ at, part: 0, partName, pct, speed: 80, passed: false })
    saveRun('z', r(now - 10 * day, 'Solo', 20)) // over a week ago
    saveRun('z', r(now - 2 * day, 'Solo', 60))
    saveRun('z', r(now - day, 'Intro', 90))
    saveRun('z', r(now - day, 'Solo', 78))
    expect(recentMove('z', now)).toBe('Solo: 60% → 78% this week')
    expect(recentMove('none', now)).toBeNull()
  })
})
