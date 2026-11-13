import { describe, expect, it } from 'vitest'
import { songPath } from '../songPath'
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
    expect(p.steps.map((s) => s.key)).toEqual(['parts', 'sections', 'whole', 'tempo'])
    expect(p.steps[0]).toMatchObject({ done: false, detail: '1 of 3 parts' })
    expect(p.next).toEqual({ kind: 'part', id: 'song:s:1' })
    expect(p.done).toBe(0)
  })

  it('parts learned: on to Learn a song, part by part, then the whole song, then full tempo', () => {
    expect(songPath(parts(true, true), levels(1, 3)).next).toEqual({ kind: 'song' })
    expect(songPath(parts(true, true), levels(1, 3)).nextLabel).toBe('Play each part with the song')
    expect(songPath(parts(true, true), levels(3, 3)).nextLabel).toBe('Play the whole song')
    expect(songPath(parts(true, true), levels(3, 3, { pct: 75, speed: 80 })).nextLabel).toBe('The whole song at full tempo')
    const done = songPath(parts(true, true), levels(3, 3, { pct: 82, speed: 100 }))
    expect(done.next).toBeNull()
    expect(done.done).toBe(4)
  })

  it('a song with no part lessons (an unusual tuning) starts at Learn a song', () => {
    const p = songPath([], null)
    expect(p.steps.map((s) => s.key)).toEqual(['sections', 'whole', 'tempo'])
    expect(p.next).toEqual({ kind: 'song' })
  })
})
