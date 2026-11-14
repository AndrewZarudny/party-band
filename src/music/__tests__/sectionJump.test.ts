import { describe, expect, it } from 'vitest'
import { sectionJump, segmentAt, type Segment } from '../songForm'

const segs: Segment[] = [
  { start: 0, beats: 16, section: 'Intro', solo: false, formIdx: 0 },
  { start: 16, beats: 32, section: 'Verse', solo: false, formIdx: 1 },
  { start: 48, beats: 32, section: 'Chorus', solo: false, formIdx: 2 },
]

describe('jumping a section', () => {
  it('▶ goes to the next section, none after the last', () => {
    expect(sectionJump(segs, 3, 1)).toBe(16)
    expect(sectionJump(segs, 20, 1)).toBe(48)
    expect(sectionJump(segs, 60, 1)).toBeNull()
  })
  it('◀ restarts this section, or goes back one right after a section began', () => {
    expect(sectionJump(segs, 30, -1)).toBe(16)
    expect(sectionJump(segs, 17, -1)).toBe(0)
    expect(sectionJump(segs, 1, -1)).toBe(0)
    expect(sectionJump([], 0, 1)).toBeNull()
  })
  it('the section at a beat', () => {
    expect(segmentAt(segs, 47.9)).toBe(1)
    expect(segmentAt(segs, 80)).toBe(-1)
  })
})
