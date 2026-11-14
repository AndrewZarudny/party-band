// Chords written over the words, as chord sites show them (AmDm, Ultimate Guitar):
//
//   E          Am    F  Dm
//   «Я не вернусь», - так говорил
//
// Pasted text like that is kept with each chord inline at its letter, ChordPro style: "[E]«Я не вернусь», - [Am]так…".
// Chords on a line of their own (between lines, or after the last word) stay as a line of chords: "[F] [Dm] [E]".
import { parseChord, transposeChord } from './theory'

/** A chord name as written on chord sites, or null when it isn't one. Russian sites write B as H (Hm = Bm). */
export function normChord(token: string): string | null {
  const s = token.trim().replace(/^H/, 'B')
  if (!s) return null
  if (parseChord(s)) return s
  // A chord the app has no shape for (C7b9, Gadd11, A7(#5)): its plain major or minor, so it still plays.
  const m = /^([A-G][#b]?)((?:maj|min|dim|aug|sus|add|[mM+°ø\d#b()/,-])*)$/.exec(s)
  if (!m) return null
  const plain = m[1] + (/^m(?!aj)|^min/.test(m[2]) ? 'm' : '')
  return parseChord(plain) ? plain : null
}

// Marks that can sit on a chord line without making it words: bar lines, repeats, dashes, brackets.
const DECOR = /^(\|+|x\d+|\d+x|[-–—.*]+|\(|\))$/i
const bare = (t: string) => t.replace(/^\(+|\)+$|,$/g, '')

/** A line of chord names only (spaced out to sit over the words below). */
export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean)
  let n = 0
  for (const t of tokens) {
    if (DECOR.test(t)) continue
    if (!normChord(bare(t))) return false
    n++
  }
  return n > 0
}

/** "[Verse 1]", "[Припев]:" — a section heading, not a chord in brackets. */
export function isHeadingLine(line: string): boolean {
  const m = /^\s*\[([^\]\n]+)\]\s*:?\s*$/.exec(line)
  return !!m && !normChord(m[1])
}

/** Each chord of a chord line with the column it starts at. */
function chordMarks(line: string): { col: number; chord: string }[] {
  const out: { col: number; chord: string }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (DECOR.test(m[0])) continue
    const c = normChord(bare(m[0]))
    if (c) out.push({ col: m.index + (m[0].startsWith('(') ? 1 : 0), chord: c })
  }
  return out
}

/** Puts every chord line onto the words under it, each chord at the letter it stood over. Text without chord lines comes back as it was. */
export function inlineChords(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!isChordLine(l)) {
      out.push(l)
      continue
    }
    const marks = chordMarks(l)
    const next = lines[i + 1]
    if (next !== undefined && next.trim() && !isChordLine(next) && !isHeadingLine(next)) {
      let t = next
      // Right to left, so the columns to the left stay where they were.
      for (const m of [...marks].reverse()) {
        if (t.length < m.col) t = t.padEnd(m.col)
        t = `${t.slice(0, m.col)}[${m.chord}]${t.slice(m.col)}`
      }
      out.push(t)
      i++
    } else out.push(marks.map((m) => `[${m.chord}]`).join(' '))
  }
  return out.join('\n')
}

export interface WordLine {
  text: string // the words, spaces tidied
  chords: { at: number; chord: string }[] // at: the letter it's over (text.length or more: after the words)
}

/** One line with inline chords: its words and where each chord sits. */
export function parseLine(line: string): WordLine {
  let text = ''
  const chords: WordLine['chords'] = []
  const add = (s: string) => {
    for (const ch of s) {
      if (/\s/.test(ch)) {
        if (text && !text.endsWith(' ')) text += ' '
      } else text += ch
    }
  }
  const re = /\[([^\]\n]+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const c = normChord(m[1])
    if (!c) continue
    add(line.slice(last, m.index))
    chords.push({ at: text.length, chord: c })
    last = re.lastIndex
  }
  add(line.slice(last))
  return { text: text.trimEnd(), chords }
}

/** The words of a line without its chords. */
export const stripChords = (line: string) => parseLine(line).text

/** A section's words line by line with their chords; lines of chords only have no text. Blank lines are left out. */
export function wordLines(words: string | undefined): WordLine[] {
  return (words ?? '')
    .split('\n')
    .map(parseLine)
    .filter((l) => l.text || l.chords.length)
}

export const hasWordChords = (words: string | undefined) => wordLines(words).some((l) => l.chords.length > 0)

/** Every chord written in the words, in order (for guessing the key). */
export const chordsInWords = (lyrics: string[] | undefined) => (lyrics ?? []).flatMap((w) => wordLines(w).flatMap((l) => l.chords.map((c) => c.chord)))

/** Where each word of a line starts. */
export function wordStarts(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) if (text[i] !== ' ' && (i === 0 || text[i - 1] === ' ')) out.push(i)
  return out
}

/** Which word a letter belongs to (a space counts toward the next word). */
export function wordAt(text: string, at: number): number {
  const starts = wordStarts(text)
  let w = 0
  for (let i = 0; i < starts.length; i++) if (starts[i] <= at) w = i
  if (text[at] === ' ' && w + 1 < starts.length) w++
  return w
}

/** Every chord in the words moved n semitones (a sheet written for a capo, played as it sounds). */
export function shiftWordChords(words: string, n: number): string {
  if (!n) return words
  return words.replace(/\[([^\]\n]+)\]/g, (all, c: string) => {
    const k = normChord(c)
    return k ? `[${transposeChord(k, n, /^[A-G]b/.test(k))}]` : all
  })
}
