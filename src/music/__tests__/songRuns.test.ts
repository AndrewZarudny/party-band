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
