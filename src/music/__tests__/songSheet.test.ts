import { describe, expect, it } from 'vitest'
import { songSheet } from '../songForm'
import type { Step } from '../songForm'
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
  it('each section once, its chords bar by bar, the repeats as ×N, and its words', () => {
    const steps = [st('Am', 4, 0, 'Verse', 0, 2), st('F', 2, 0, 'Verse', 0, 2), st('G', 2, 0, 'Verse', 0, 2), st('Am', 4, 0, 'Verse', 1, 2), st('C', 8, 1, 'Chorus')]
    const sheet = songSheet(steps, ['line one\nline two', ''])
    expect(sheet).toEqual([
      { formIdx: 0, name: 'Verse', solo: false, bars: [['Am'], ['F', 'G']], passes: 2, lines: ['line one', 'line two'] },
      { formIdx: 1, name: 'Chorus', solo: false, bars: [['C'], ['C']], passes: 1, lines: [] },
    ])
  })
})
