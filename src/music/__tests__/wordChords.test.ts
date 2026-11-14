import { describe, expect, it } from 'vitest'
import { chordsInWords, inlineChords, isChordLine, isHeadingLine, parseLine, wordLines } from '../wordChords'
import { sungLines } from '../lyrics'

// Made-up words in the layout chord sites use: a line of chords spaced over the line it's sung on.
const SITE = ['E          Am    F  Dm', 'Shadows on the river glow', '     F   Dm', 'Down we go', '', 'F  Dm  E', '[Припев]:', 'Hm     E', 'Silver road'].join('\n')

describe('chords written over the words', () => {
  it('knows a chord line, a heading and a line of words apart', () => {
    expect(isChordLine('E          Am    F  Dm')).toBe(true)
    expect(isChordLine('  Hm7  (E)  x2')).toBe(true)
    expect(isChordLine('Am I the one')).toBe(false)
    expect(isHeadingLine('[Припев]:')).toBe(true)
    expect(isHeadingLine('[Am]')).toBe(false)
  })

  it('puts each chord at the letter it stood over, and keeps a line of chords on its own', () => {
    const lines = inlineChords(SITE).split('\n')
    expect(lines[0]).toBe('[E]Shadows on [Am]the ri[F]ver[Dm] glow')
    expect(lines[1]).toBe('Down [F]we g[Dm]o')
    expect(lines[3]).toBe('[F] [Dm] [E]')
    expect(lines[5]).toBe('[Bm]Silver [E]road') // H is B on Russian chord sites
    expect(inlineChords(inlineChords(SITE))).toBe(inlineChords(SITE)) // pasting it again changes nothing
  })

  it('reads the words and the chords back, spaces tidied', () => {
    expect(parseLine('Down [F]we  go   [Dm]')).toEqual({ text: 'Down we go', chords: [{ at: 5, chord: 'F' }, { at: 11, chord: 'Dm' }] })
    expect(sungLines(inlineChords(SITE))).toEqual(['Shadows on the river glow', 'Down we go', '[Припев]:', 'Silver road'])
    expect(wordLines('[F] [Dm] [E]')).toEqual([{ text: '', chords: [{ at: 0, chord: 'F' }, { at: 0, chord: 'Dm' }, { at: 0, chord: 'E' }] }])
    expect(chordsInWords([inlineChords(SITE)])).toEqual(['E', 'Am', 'F', 'Dm', 'F', 'Dm', 'F', 'Dm', 'E', 'Bm', 'E'])
  })
})

describe('chord names from chord sites', () => {
  it('reads unusual chords as their plain major or minor, and words as words', async () => {
    const { normChord } = await import('../wordChords')
    expect(normChord('Fmaj7')).toBe('Fmaj7')
    expect(normChord('C/E')).toBe('C/E')
    expect(normChord('C7b9')).toBe('C')
    expect(normChord('Am7(b5)')).toBe('Am')
    expect(normChord('Hello')).toBeNull()
    expect(normChord('Ah')).toBeNull()
  })
})
