import { describe, expect, it } from 'vitest'
import { levelCount, levelPassed, nextLevel, parseLevels, songSections, withPass } from '../songLevels'

describe('song levels', () => {
  it('sections follow the tab markers; bars before the first are Start; repeats get a number', () => {
    const names = [null, null, 'Intro', null, 'Verse', null, null, 'Chorus', 'Verse', 'Chorus']
    expect(songSections(names)).toEqual([
      { name: 'Start', from: 0, to: 1 },
      { name: 'Intro', from: 2, to: 3 },
      { name: 'Verse', from: 4, to: 6 },
      { name: 'Chorus', from: 7, to: 7 },
      { name: 'Verse 2', from: 8, to: 8 },
      { name: 'Chorus 2', from: 9, to: 9 },
    ])
  })

  it('a tab with no markers is cut into 8-bar levels', () => {
    expect(songSections(Array(20).fill(null)).map((s) => [s.name, s.from, s.to])).toEqual([
      ['Bars 1–8', 0, 7],
      ['Bars 9–16', 8, 15],
      ['Bars 17–20', 16, 19],
    ])
    expect(songSections([])).toEqual([])
  })

  it('a pass needs 70% of at least 4 notes at 70% speed or faster', () => {
    expect(levelPassed(7, 3, 70)).toBe(true)
    expect(levelPassed(6, 4, 100)).toBe(false)
    expect(levelPassed(10, 0, 65)).toBe(false)
    expect(levelPassed(3, 0, 100)).toBe(false)
  })

  it('passes add up, keep the best, and start again on another track', () => {
    let l = withPass(null, 'Lead', 3, 0, { pct: 72, speed: 70 })
    l = withPass(l, 'Lead', 3, 0, { pct: 90, speed: 80 })
    expect(l.passed['0']).toEqual({ pct: 90, speed: 80 })
    expect(nextLevel(l, 3)).toBe(1)
    l = withPass(withPass(l, 'Lead', 3, 1, { pct: 80, speed: 100 }), 'Lead', 3, 2, { pct: 75, speed: 70 })
    expect(nextLevel(l, 3)).toBeNull()
    expect(levelCount(l)).toEqual({ done: 3, total: 3, full: false })
    expect(levelCount(withPass(l, 'Lead', 3, 'full', { pct: 80, speed: 100 })).full).toBe(true)
    expect(levelCount(withPass(l, 'Rhythm', 3, 0, { pct: 80, speed: 100 }))).toEqual({ done: 1, total: 3, full: false })
    expect(parseLevels(JSON.stringify(l))).toEqual(l)
    expect(parseLevels('nope')).toBeNull()
    expect(levelCount(null)).toEqual({ done: 0, total: 0, full: false })
  })
})
