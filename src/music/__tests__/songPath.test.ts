import { describe, expect, it } from 'vitest'
import { songPath, weakSpots } from '../songPath'
import { parseLevels, withPass } from '../songLevels'
import type { SongLevels } from '../songLevels'

const parts = (...passed: boolean[]) => passed.map((p, i) => ({ id: `song:s:${i}`, passed: p }))
const levels = (done: number, total: number, full?: { pct: number; speed: number }): SongLevels => ({
  track: 'Guitar',
  total,
  passed: Object.fromEntries(Array.from({ length: done }, (_, i) => [String(i), { pct: 80, speed: 80 }])),
  ...(full ? { full } : {}),
})

describe('a song path', () => {
  it('starts with the parts: the next is the first part not passed', () => {
    const p = songPath(parts(true, false, false), null)
    expect(p.steps.map((s) => s.key)).toEqual(['parts', 'sections', 'whole', 'ready'])
    expect(p.steps[0]).toMatchObject({ done: false, detail: '1 of 3 parts' })
    expect(p.next).toEqual({ kind: 'part', id: 'song:s:1' })
    expect(p.done).toBe(0)
  })

  it('parts learned: on to Learn a song, part by part, then the whole song, then full tempo', () => {
    expect(songPath(parts(true, true), levels(1, 3)).next).toEqual({ kind: 'song' })
    expect(songPath(parts(true, true), levels(1, 3)).nextLabel).toBe('Play each part with the song')
    expect(songPath(parts(true, true), levels(3, 3)).nextLabel).toBe('Play the whole song')
    expect(songPath(parts(true, true), levels(3, 3, { pct: 75, speed: 80 })).nextLabel).toBe('Band-ready')
    const done = songPath(parts(true, true), { ...levels(3, 3, { pct: 90, speed: 100 }), ready: { pct: 90, speed: 100 } })
    expect(done.next).toBeNull()
    expect(done.done).toBe(4)
  })

  it('a song with no part lessons (an unusual tuning) starts at Learn a song', () => {
    const p = songPath([], null)
    expect(p.steps.map((s) => s.key)).toEqual(['sections', 'whole', 'ready'])
    expect(p.next).toEqual({ kind: 'song' })
  })
})

describe('band-ready', () => {
  it('needs one run of the whole song at full tempo with 85% or more: best score and best speed from different runs do not count', () => {
    let l = withPass(null, 'Guitar', 3, 'full', { pct: 90, speed: 80 })
    l = withPass(l, 'Guitar', 3, 'full', { pct: 70, speed: 100 })
    expect(l.full).toEqual({ pct: 90, speed: 100 })
    expect(l.ready).toBeUndefined()
    l = withPass(l, 'Guitar', 3, 'full', { pct: 86, speed: 100 })
    expect(l.ready).toEqual({ pct: 86, speed: 100 })
    expect(parseLevels(JSON.stringify(l))?.ready).toEqual({ pct: 86, speed: 100 })
  })

  it('where it still breaks: sections not passed, or passed under 85%, by name', () => {
    const l = { ...levels(2, 3), passed: { '0': { pct: 92, speed: 100 }, '1': { pct: 74, speed: 80 } } }
    expect(weakSpots(l, new Map([[0, 'Intro'], [1, 'Verse'], [2, 'Chorus']]))).toEqual(['Verse', 'Chorus'])
  })
})
