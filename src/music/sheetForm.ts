// A chord sheet's own song structure: its parts ([Verse], [Chorus], [Instrumental]…) in the order it gives
// them, so the song's form follows the sheet instead of a guess (a third verse after the solo gets its place).
import type { SongSection, SongSetup } from './songForm'
import { headingKind, sectionKey, trimBlock } from './lyrics'
import { wordLines } from './wordChords'

export interface SheetPart {
  key: string // verse, chorus, solo… ('' before the first heading)
  name: string // as the sheet writes it: "Verse 2", "Instrumental"
  text: string // its lines (chords and words), headings left out
}

/** The parts of a sheet with headings, in order (a part with only guitar tab left out stays, empty). */
export function sheetParts(text: string): SheetPart[] {
  const out: SheetPart[] = []
  let cur: { key: string; name: string; lines: string[] } | null = null
  const flush = () => {
    if (cur && (cur.key || cur.lines.join('').trim())) out.push({ key: cur.key, name: cur.name, text: trimBlock(cur.lines.join('\n')) })
  }
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const h = headingKind(line)
    if (h !== null) {
      flush()
      const name = (/^\s*\[([^\]\n]+)\]/.exec(line)?.[1] ?? line).replace(/[:\d]+\s*$/, '').trim()
      cur = { key: sectionKey(h), name: name.charAt(0).toUpperCase() + name.slice(1), lines: [] }
    } else {
      cur ??= { key: '', name: '', lines: [] }
      cur.lines.push(line)
    }
  }
  flush()
  return out
}

/**
 * The song with its form taken from the sheet's parts: each part becomes a form entry of the song's section of
 * that kind (a new section when the song has none, with the part's chords a bar each), and its words go with it.
 * The song's intro and outro stay at the ends when the sheet doesn't write them. Null when the sheet has no
 * structure to follow (fewer than two parts, or words before the first heading).
 */
export function songFromSheet(song: SongSetup, parts: SheetPart[], toWords: (text: string) => string): SongSetup | null {
  if (parts.length < 2 || parts.some((p) => !p.key)) return null
  const sections: SongSection[] = [...song.sections]
  const nameFor = (p: SheetPart): string => {
    const have = sections.find((s) => sectionKey(s.name) === p.key)
    if (have) return have.name
    const chords: { chord: string; beats: number }[] = []
    for (const r of wordLines(toWords(p.text))) for (const c of r.chords) if (chords[chords.length - 1]?.chord !== c.chord) chords.push({ chord: c.chord, beats: 4 })
    const base = song.sections[0]
    sections.push({ name: p.name || p.key, solo: p.key === 'solo', chords: chords.length ? chords : (base?.chords ?? [{ chord: song.key, beats: 4 }]), repeat: 1, strum: base?.strum, technique: base?.technique })
    return p.name || p.key
  }
  const form: string[] = []
  const lyrics: string[] = []
  const end = (key: string) => song.form.find((n) => sectionKey(n) === key)
  const intro = end('intro')
  const outro = end('outro')
  if (intro && parts[0].key !== 'intro') {
    form.push(intro)
    lyrics.push('')
  }
  for (const p of parts) {
    form.push(nameFor(p))
    lyrics.push(toWords(p.text))
  }
  if (outro && parts[parts.length - 1].key !== 'outro') {
    form.push(outro)
    lyrics.push('')
  }
  return { ...song, sections, form, lyrics, formBars: undefined, lyricBeats: undefined, lyricWords: undefined, vocalPhrases: undefined, fitToWords: true }
}
