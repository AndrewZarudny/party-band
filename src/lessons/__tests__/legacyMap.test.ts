import { describe, expect, it } from 'vitest'
import { newProgress } from '../progress'
import { LESSONS } from '../data'
import { LEGACY_BOSSES, LEGACY_FREE, LEGACY_PLAN_PATH, LEGACY_WORLDS, legacyOpen, legacyStage } from '../legacyMap'
import { rec } from './fixtures'

const passed = (stars = 1) => rec({ passedAt: 1, stars: stars as 0 | 1 | 2 | 3, plays: 1 })

describe('the old world map, frozen for the migration', () => {
  it('lists every lesson once, the boss last in each world', () => {
    const all = LEGACY_WORLDS.flat()
    expect(all).toHaveLength(LESSONS.length)
    expect(new Set(all).size).toBe(all.length)
    LEGACY_WORLDS.forEach((w, i) => expect(w[w.length - 1]).toBe(LEGACY_BOSSES[i]))
    expect(LEGACY_PLAN_PATH.some((id) => LEGACY_FREE.includes(id))).toBe(false)
  })

  it('Tap In first; a tried Tap In opens the next lesson; the plan path opens ahead of its world', () => {
    const p = newProgress()
    expect(legacyOpen(p)).toEqual(['w1-01', 'w1-05', 'w1-04'])
    p.lessons['w1-01'] = rec({ plays: 1 })
    expect(legacyOpen(p)).toContain('w1-02')
    p.lessons['w1-05'] = passed()
    // Downstroke Lock sits in World 3 but is next on the old plan path.
    expect(legacyOpen(p)).toContain('w3-06')
  })

  it('a boss opens the next world', () => {
    const p = newProgress()
    expect(legacyOpen(p)).not.toContain('w2-01')
    p.lessons['w1-04'] = passed()
    expect(legacyOpen(p)).toEqual(expect.arrayContaining(['w2-01', 'w2-04']))
    expect(legacyOpen(p)).not.toContain('w2-02')
  })

  it('70% of a world\'s stars open the next world too', () => {
    const p = newProgress()
    p.lessons['w1-01'] = rec({ plays: 1 })
    for (const id of ['w1-02', 'w1-03', 'w1-05']) p.lessons[id] = passed(3)
    expect(legacyOpen(p)).not.toContain('w2-01') // 9 of 15
    p.lessons['w1-04'] = rec({ stars: 2, plays: 2 })
    expect(legacyOpen(p)).toContain('w2-01') // 11 of 15
  })

  it('free jams open with world 8; the stage is the bosses passed', () => {
    const p = newProgress()
    expect(legacyStage(p)).toBe(0)
    p.lessons['w7-04'] = passed()
    for (const id of LEGACY_FREE) expect(legacyOpen(p)).toContain(id)
    p.lessons['w1-04'] = passed()
    expect(legacyStage(p)).toBe(2)
  })
})
