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

describe('timing against the band', () => {
  it('each attack against the nearest 8th note of the band, in ms', async () => {
    const { gridOffsetMs } = await import('../jamSummary')
    // Beat 0 at 10 s, 0.5 s a beat: 8th notes every 0.25 s.
    expect(gridOffsetMs(10.27, 10, 0.5)).toBe(20) // 20 ms after the 8th at 10.25
    expect(gridOffsetMs(10.48, 10, 0.5)).toBe(-20) // 20 ms before the beat at 10.5
    // Swung: off-beats land late on purpose, so only the beats are the grid.
    expect(gridOffsetMs(10.48, 10, 0.5, true)).toBe(-20)
    expect(gridOffsetMs(10.33, 10, 0.5, true)).toBeNull() // a swung off-beat: left out
    expect(gridOffsetMs(10.125, 10, 0.5)).toBeNull() // a 16th between 8ths: left out
  })
  it('the average lean, said only when it is 20 ms or more, from 8 attacks or more', async () => {
    const { bandTiming } = await import('../jamSummary')
    expect(bandTiming(Array(8).fill(-45))?.text).toBe('you were about 45 ms ahead of the band (rushing)')
    expect(bandTiming(Array(8).fill(30))?.text).toMatch(/behind the band/)
    expect(bandTiming(Array(8).fill(5))?.text).toBeNull()
    expect(bandTiming(Array(7).fill(-45))).toBeNull()
  })
})
