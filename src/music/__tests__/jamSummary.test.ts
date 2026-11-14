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

describe('jams over time', () => {
  const rec = (chordPct: number, outPct: number) => ({ at: 1, notes: 100, chordPct, outPct, sec: 60 })
  it('this jam against the last five: fewer notes outside is better', async () => {
    const { againstUsual } = await import('../jamSummary')
    const now = jamSummary({ chord: 40, scale: 49, out: 11, phrases: 0, sec: 60 })!
    const u = againstUsual(now, [rec(10, 50), rec(30, 20), rec(30, 18), rec(32, 16), rec(28, 20), rec(30, 16)])
    expect(u).toEqual({ chordPct: 30, outPct: 18, jams: 5, better: true }) // the oldest one is left out
    expect(againstUsual(now, [])).toBeNull()
  })
  it('kept, the last 60', async () => {
    const { loadJamHistory, saveJam } = await import('../jamSummary')
    localStorage.clear()
    const s = jamSummary({ chord: 40, scale: 49, out: 11, phrases: 0, sec: 60 })!
    for (let i = 0; i < 62; i++) saveJam(s, i)
    expect(loadJamHistory().length).toBe(60)
    expect(loadJamHistory()[0].at).toBe(2)
  })
})
