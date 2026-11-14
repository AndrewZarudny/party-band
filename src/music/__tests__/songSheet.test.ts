import { describe, expect, it } from 'vitest'
import { songSheet, songSteps } from '../songForm'
import type { SongSetup, Step } from '../songForm'
import { parseChord } from '../theory'

const st = (chord: string, beats: number, formIdx: number, section: string, pass = 0, passes = 1): Step => ({
  chord: parseChord(chord)!,
  beats,
  section,
  solo: false,
  first: false,
  formIdx,
  pass,
  passes,
})

describe('the whole song on one sheet', () => {
  it('a section without words: its chords bar by bar, the repeats as ×N', () => {
    const steps = [st('Am', 4, 0, 'Intro', 0, 2), st('F', 2, 0, 'Intro', 0, 2), st('G', 2, 0, 'Intro', 0, 2), st('Am', 4, 0, 'Intro', 1, 2), st('C', 8, 1, 'Chorus')]
    expect(songSheet(steps, ['', ''])).toEqual([
      { formIdx: 0, name: 'Intro', solo: false, bars: [['Am'], ['F', 'G']], passes: 2, rows: [] },
      { formIdx: 1, name: 'Chorus', solo: false, bars: [['C'], ['C']], passes: 1, rows: [] },
    ])
  })

  it('words get the chords over them, each over the word sung when it comes in', () => {
    const steps = [st('Am', 4, 0, 'Verse'), st('F', 4, 0, 'Verse'), st('C', 4, 0, 'Verse'), st('G', 4, 0, 'Verse')]
    // Two lines, untimed: each takes half the verse, so F comes in halfway through the first.
    const [sec] = songSheet(steps, ['one two three four\nfive six seven eight'])
    expect(sec.rows).toEqual([
      [
        { chord: 'Am', text: 'one two ' },
        { chord: 'F', text: 'three four' },
      ],
      [
        { chord: 'C', text: 'five six ' },
        { chord: 'G', text: 'seven eight' },
      ],
    ])
  })

  it('chords pasted over the words stay where they were written, in the key everyone plays in', () => {
    const steps = [st('Am', 8, 0, 'Verse')]
    const [sec] = songSheet(steps, ['[Am]Down the [F]road\n[Dm] [E]'], { wordChords: true, mapChord: (c) => (c === 'Am' ? 'Bm' : c) })
    expect(sec.rows).toEqual([
      [
        { chord: 'Bm', text: 'Down the ' },
        { chord: 'F', text: 'road' },
      ],
      [
        { chord: 'Dm', text: '' },
        { chord: 'E', text: '' },
      ],
    ])
  })
})

describe('the band plays the chords written over the words', () => {
  const song: SongSetup = {
    title: 'T',
    artist: 'A',
    key: 'C',
    minor: false,
    bpm: 100,
    feel: 'pop',
    capo: 0,
    sections: [
      { name: 'Intro', solo: false, chords: [{ chord: 'C', beats: 4 }] },
      { name: 'Verse', solo: false, chords: [{ chord: 'C', beats: 4 }], repeat: 4 },
    ],
    form: ['Intro', 'Verse'],
    notes: '',
    // Two timed lines: the first sung over 8 beats, the second over 4, then 4 beats with no words.
    lyrics: ['', '[Am]one two [F]three four\nfive six [E]seven eight [Dm] [E]'],
    lyricBeats: [null, [0, 8]],
    lyricWords: [null, [[0, 2, 4, 6], [8, 9, 10, 11]]],
    wordChords: true,
  }
  const chords = (steps: Step[]) => steps.map((s) => `${s.chord.symbol}:${s.beats}`)

  it('each chord comes in on the word it stands over; chords after the words fill the rest', () => {
    const steps = songSteps(song)
    expect(chords(steps.filter((s) => s.formIdx === 1))).toEqual(['Am:4', 'F:4', 'F:2', 'E:2', 'Dm:2', 'E:2']) // split where each pass of the verse starts
    expect(chords(steps.filter((s) => s.formIdx === 0))).toEqual(['C:4']) // no words: as set up
    expect(steps.reduce((a, s) => a + s.beats, 0)).toBe(20) // same length as before
  })

  it('unticked, the band plays the chords it had', () => {
    expect(chords(songSteps({ ...song, wordChords: false }).filter((s) => s.formIdx === 1))).toEqual(['C:4', 'C:4', 'C:4', 'C:4'])
  })
})
