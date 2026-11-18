import { describe, expect, it } from 'vitest'
import { filledSecs, remapSecs, sectionsFromSecs } from '../wordTiming'
import { sheetParts, songFromSheet } from '../sheetForm'
import { inlineChords } from '../wordChords'
import type { SongSetup } from '../songForm'

describe('word times stay with their words', () => {
  it('a new line split and chords over the words keep every matched word’s time', () => {
    const old = ['', 'one two three\nfour five']
    const secs = [null, [[1, 2, 3], [4, 5]]]
    const next = ['', '[Am]one two\nthree four [F]five six']
    expect(remapSecs(old, secs, next)).toEqual([null, [[1, 2], [3, 4, 5, null]]])
  })

  it('times follow the words into a different form (a part moved to another entry)', () => {
    expect(remapSecs(['a b', 'c d'], [[[1, 2]], [[3, 4]]], ['', 'a b', '', 'c d'])).toEqual([null, [[1, 2]], null, [[3, 4]]])
  })

  it('fills words the aligner wasn’t sure of between the sure ones; too few sure words is no sync', () => {
    expect(filledSecs([[1, null, 3], [null, 5]])).toEqual([[1, 2, 3], [4, 5]])
    expect(filledSecs([[1, null, null], [null, null]])).toBeNull()
  })
})

describe('section lengths from where the singing is', () => {
  // 120 BPM: a bar is 2 s; the song's beat 0 at 1 s.
  const grid = { beat0: 1, spb: 0.5 }
  it('each sung part starts on the bar of its first word; the bars between are shared by usual lengths', () => {
    const form = ['Intro', 'Verse', 'Chorus', 'Solo', 'Verse', 'Outro']
    const at = (t: number) => [[t, t + 1]]
    // Verse sung from bar 2 (5 s), chorus from bar 6 (a pickup at 12.9 s counts), verse 2 from bar 14 (29 s).
    const secs = [null, at(5), at(12.9), null, at(29), null]
    // Chorus and solo usually 4 bars each: they split the 8 bars before verse 2. The record ends at bar 20.
    expect(sectionsFromSecs(form, secs, grid, 41, [2, 4, 4, 4, 4, 2])).toEqual([2, 4, 4, 4, 4, 2])
  })

  it('a sung part lasts at least to its last word', () => {
    const secs = [[[1, 9]], null]
    // Words to 9 s (bar 4): the first part takes 5 bars even though the solo is usually longer.
    expect(sectionsFromSecs(['Verse', 'Solo'], secs, grid, 21, [1, 20])).toEqual([5, 5])
  })
})

describe('a chord sheet’s own song parts', () => {
  const song: SongSetup = {
    title: 'T', artist: 'A', key: 'Am', minor: true, bpm: 90, feel: 'pop', capo: 0, notes: '',
    sections: [
      { name: 'Intro', solo: false, chords: [{ chord: 'Am', beats: 4 }] },
      { name: 'Verse', solo: false, chords: [{ chord: 'Am', beats: 4 }] },
      { name: 'Chorus', solo: false, chords: [{ chord: 'F', beats: 4 }] },
      { name: 'Solo', solo: true, chords: [{ chord: 'Am', beats: 4 }] },
      { name: 'Outro', solo: false, chords: [{ chord: 'Am', beats: 4 }] },
    ],
    form: ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Solo', 'Chorus', 'Outro'],
    formBars: [4, 16, 8, 24, 8, 12, 20, 2],
  }
  it('the form follows the sheet (a third verse after the solo), intro and outro kept at the ends', () => {
    const text = '[Verse]\nv1\n[Chorus]\nc1\n[Verse]\nv2\n[Chorus]\nc2\n[Instrumental]\n\n[Verse]\nv3\n[Chorus]\nc3\n[Bridge]\nDm  G\nb1'
    const s = songFromSheet(song, sheetParts(text), inlineChords)!
    expect(s.form).toEqual(['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Solo', 'Verse', 'Chorus', 'Bridge', 'Outro'])
    expect(s.lyrics).toEqual(['', 'v1', 'c1', 'v2', 'c2', '', 'v3', 'c3', '[Dm]b1  [G]', ''])
    expect(s.sections.find((x) => x.name === 'Bridge')?.chords).toEqual([{ chord: 'Dm', beats: 4 }, { chord: 'G', beats: 4 }])
    expect(s.formBars).toBeUndefined() // lengths come from the singing next
    expect(s.fitToWords).toBe(true)
  })
})
