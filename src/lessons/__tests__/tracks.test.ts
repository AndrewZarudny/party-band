import { describe, expect, it } from 'vitest'
import { GENRES, JAM_TRACKS, tracksFor, transposeChord, withTrack } from '../tracks'
import { LESSONS } from '../data'
import { buildChart } from '../charts'
import { parseChord } from '../../music/theory'
import { FEELS } from '../../music/parts'

const by = (id: string) => LESSONS.find((l) => l.id === id)!

describe('jam backing tracks', () => {
  it('has three genres of three, each with a feel the band knows and chords it can read', () => {
    for (const g of GENRES) expect(JAM_TRACKS.filter((t) => t.genre === g.id)).toHaveLength(3)
    expect(new Set(JAM_TRACKS.map((t) => t.id)).size).toBe(9)
    for (const t of JAM_TRACKS) {
      expect(FEELS[t.feel]).toBeTruthy()
      for (const shift of [0, -5, 3]) for (const c of t.chords) expect(parseChord(transposeChord(c, shift))).toBeTruthy()
    }
  })

  it('moves chords to another key', () => {
    expect(['Am7', 'F', 'D7', 'E5'].map((c) => transposeChord(c, -5))).toEqual(['Em7', 'C', 'A7', 'B5'])
    expect(transposeChord('A7', 1)).toBe('Bb7')
  })

  it('changes only the band: same lesson, new feel and chords in the jam key', () => {
    const jam = by('w8-07') // Shuffle in E
    const out = withTrack(jam, 'rock-anthem')
    expect(out.id).toBe(jam.id)
    expect(out.bpm).toBe(jam.bpm)
    expect(out.improv).toBe(jam.improv)
    expect(out.backing).toMatchObject({ feel: 'pop', chords: ['Em', 'C', 'G', 'D'] })
    expect(buildChart(out).chordTimeline.slice(0, 5).map((c) => c.symbol)).toEqual(['Em', 'C', 'G', 'D', 'Em'])
  })

  it('leaves the lesson alone with no track, an unknown one, or a lesson that is not a jam', () => {
    const jam = by('w8-02')
    expect(withTrack(jam, null)).toBe(jam)
    expect(withTrack(jam, 'nope')).toBe(jam)
    const notes = LESSONS.find((l) => l.type === 'notes')!
    expect(tracksFor(notes)).toEqual([])
    expect(withTrack(notes, 'rock-anthem')).toBe(notes)
  })

  it('offers a major-scale jam only the tracks without a minor home chord', () => {
    const major = by('w8-10')
    expect(tracksFor(major).every((t) => t.major)).toBe(true)
    expect(tracksFor(major).length).toBeGreaterThanOrEqual(3)
    expect(withTrack(major, 'rock-anthem')).toBe(major)
  })

  it('builds a chart for every jam on every track it can use', () => {
    for (const l of LESSONS) for (const t of tracksFor(l)) expect(buildChart(withTrack(l, t.id)).chordTimeline.length).toBe(l.bars)
  })
})
