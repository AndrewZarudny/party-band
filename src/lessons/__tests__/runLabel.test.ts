import { describe, expect, it } from 'vitest'
import { runLabel } from '../liveCoach'

describe('which run a coach reply is about', () => {
  it('the lesson, its score and tempo', () => {
    expect(runLabel({ run: { lesson: 'Numb: Intro', scorePercent: 100, bpm: 94 } })).toBe('Numb: Intro · 100% at 94 BPM')
    expect(runLabel({ run: { lesson: 'Box Jam' } })).toBe('Box Jam')
    expect(runLabel({ moment: 'a jam' })).toBeUndefined()
  })
})
