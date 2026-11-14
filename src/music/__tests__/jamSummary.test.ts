import { describe, expect, it } from 'vitest'
import { jamSummary } from '../jamSummary'

describe('a jam in numbers', () => {
  it('shares of chord tones, scale notes and notes outside, adding up to 100', () => {
    const s = jamSummary({ chord: 41, scale: 48, out: 11, phrases: 6, sec: 252 })!
    expect(s).toMatchObject({ notes: 100, chordPct: 41, scalePct: 48, outPct: 11, phrases: 6, sec: 252 })
    expect(s.pointer).toMatch(/Good balance/)
  })

  it('one pointer: wandering outside the scale first, then too few chord tones', () => {
    expect(jamSummary({ chord: 30, scale: 40, out: 30, phrases: 0, sec: 60 })!.pointer).toMatch(/outside the scale/)
    expect(jamSummary({ chord: 10, scale: 85, out: 5, phrases: 0, sec: 60 })!.pointer).toMatch(/chord tones/)
  })

  it('too little played: nothing to say', () => {
    expect(jamSummary({ chord: 3, scale: 5, out: 1, phrases: 0, sec: 20 })).toBeNull()
  })
})
