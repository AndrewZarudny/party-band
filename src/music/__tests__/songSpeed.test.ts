import { describe, expect, it } from 'vitest'
import { nextSongSpeed } from '../songLevels'

describe('auto speed in Learn a song levels', () => {
  it('a pass under full speed: 5% faster, up to 100', () => {
    expect(nextSongSpeed(70, 80, true)).toBe(75)
    expect(nextSongSpeed(100, 90, true)).toBe(100)
    expect(nextSongSpeed(98, 90, true)).toBe(100)
  })
  it('under half the notes: 10% slower, not under 50; in between: the same', () => {
    expect(nextSongSpeed(80, 40, false)).toBe(70)
    expect(nextSongSpeed(55, 40, false)).toBe(50)
    expect(nextSongSpeed(80, 65, false)).toBe(80)
  })
})
