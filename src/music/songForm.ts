// A jam as a sequence of chord steps: a free-jam progression (every chord the same length,
// looping) or a real song's form (sections with their own chords and lengths, solo sections).
import type { Member } from './band'
import { soloistFor } from './band'
import type { Chord } from './theory'
import { parseChord } from './theory'

export interface SongSection {
  name: string // "Verse", "Chorus", "Solo"…
  chords: { chord: string; beats: number }[] // one pass of the section's pattern
  repeat?: number // how many times the pattern is played in the section (default 1)
  solo: boolean // an instrumental section where someone takes a solo
  strum?: string // rhythm guitar for one bar: 8 slots of D U x _ - ('' = use the feel's pattern)
  technique?: string // e.g. "palm-muted power chords"
}

/** A song as the AI sets it up for a jam. */
export interface SongSetup {
  title: string
  artist: string
  key: string // e.g. "G", "F#"
  minor: boolean
  bpm: number
  feel: string // a FEELS id
  capo: number // capo fret on the original recording (0 = none)
  sections: SongSection[]
  form: string[] // section names in playing order
  notes: string
  lyrics?: string[] // the singer's words, one block per form entry (pasted by the user)
  // When each line of the words starts, tapped along with the song: per form entry, the beat of each
  // non-empty line counted from the section's start (negative for a pickup before its first bar).
  lyricBeats?: (number[] | null)[]
  // From a tab: when each word starts (per form entry, per line, from the section's start), and,
  // for a vocal melody without words, where its sung phrases start (pasted lines land on them).
  lyricWords?: (number[][] | null)[]
  vocalPhrases?: (number[] | null)[]
  // Auto-sync: when each word is sung, in seconds of the song's recording (per form entry, per line).
  lyricSecs?: (number[][] | null)[]
  // Measured from the user's recording (Analyse): each form entry's length in bars, the record's
  // chord per bar ("C" or "C|G"), and whether to play those instead of the setup's chords.
  // Played in another key for everyone: semitones up (+) or down (−) from the song's own key.
  transpose?: number
  formBars?: number[]
  barChords?: string[]
  useRecordedChords?: boolean
}

export interface Step {
  chord: Chord
  beats: number
  section: string // '' in a free jam
  solo: boolean
  first: boolean // first chord of a section
  formIdx: number // which entry of the song form (-1 in a free jam)
  pass?: number // which repeat of the section's pattern (0-based)
  passes?: number
}

/** Free jam: each chord the same length. */
export function progressionSteps(chords: Chord[], beatsPerChord: number): Step[] {
  return chords.map((chord, i) => ({ chord, beats: beatsPerChord, section: '', solo: false, first: i === 0, formIdx: -1 }))
}

/** A song's form, section by section, as chord steps (unknown chord symbols are skipped). */
export function songSteps(song: SongSetup): Step[] {
  const steps: Step[] = []
  let bar = 0 // bar position in the recording, when lengths were measured
  song.form.forEach((name, formIdx) => {
    const sec = song.sections.find((s) => s.name === name)
    if (!sec) return
    const pattern = sec.chords.map((c) => ({ chord: parseChord(c.chord), beats: Math.max(1, Math.round(c.beats)) })).filter((c) => !!c.chord)
    const patBeats = pattern.reduce((a, c) => a + c.beats, 0)
    if (!patBeats) return
    const measured = song.formBars?.[formIdx]
    const total = measured ? measured * 4 : patBeats * Math.max(1, Math.round(sec.repeat ?? 1))
    const passes = Math.ceil(total / patBeats)
    const base = { section: sec.name, solo: sec.solo, formIdx, passes }
    let first = true

    if (measured && song.useRecordedChords && song.barChords) {
      // The record's own chords, bar by bar (two chords in a bar get two beats each).
      for (let j = 0; j < measured; j++) {
        const halves = (song.barChords[bar + j] ?? 'N').split('|')
        const parts = halves.length === 2 ? halves.map((h) => [h, 2] as const) : [[halves[0], 4] as const]
        for (const [sym, beats] of parts) {
          const chord = parseChord(sym) ?? pattern[0].chord!
          const prev = steps[steps.length - 1]
          // Merge repeats of the same chord within the section, so the strip stays readable.
          if (!first && prev && prev.chord.symbol === chord.symbol && prev.beats < 8) prev.beats += beats
          else steps.push({ ...base, chord, beats, first, pass: Math.floor((j * 4) / patBeats) })
          first = false
        }
      }
    } else {
      // The setup's pattern, repeated to fill the section (the last pass may be cut short).
      let left = total
      for (let pass = 0; left > 0; pass++)
        for (const c of pattern) {
          if (left <= 0) break
          const beats = Math.min(c.beats, left)
          steps.push({ ...base, chord: c.chord!, beats, first, pass })
          first = false
          left -= beats
        }
    }
    bar += measured ?? total / 4
  })
  return steps
}

export interface Position {
  idx: number // step index
  beatInChord: number
  chordCount: number // chords passed since the start, across loops
  pass: number // how many times the whole form has been played
}

/** Where beat `beat` (from 0) falls in the looping sequence of steps. */
export function locate(steps: Step[], beat: number): Position {
  const total = steps.reduce((s, x) => s + x.beats, 0) || 1
  const pass = Math.floor(beat / total)
  let b = beat - pass * total
  let idx = 0
  while (idx < steps.length - 1 && b >= steps[idx].beats) {
    b -= steps[idx].beats
    idx++
  }
  return { idx, beatInChord: b, chordCount: pass * steps.length + idx, pass }
}

export interface SoloInfo {
  soloist: Member | null
  nextSoloist: Member | null
  chordsUntilSwap: number // chords until the solo changes hands (0 = unknown / never)
  soloLeft: number // chords left in the current solo (0 when nobody solos)
}

/**
 * Who solos at chord number `chordCount`. Free jam: the rotation every N rounds. Song: nobody
 * solos outside solo sections; each solo section goes to the next player in the rotation.
 */
export function soloAt(band: Member[], rotation: number, steps: Step[], chordCount: number): SoloInfo {
  const len = Math.max(1, steps.length)
  const isSong = steps.some((s) => s.section)
  if (!isSong) {
    const round = Math.floor(chordCount / len)
    const forced = band.some((m) => m.role === 'lead')
    return {
      soloist: soloistFor(band, round, rotation),
      nextSoloist: rotation && !forced ? soloistFor(band, round + rotation - (round % rotation), rotation) : null,
      chordsUntilSwap: rotation && !forced ? rotation * len - (chordCount % (rotation * len)) : 0,
      soloLeft: rotation && !forced ? rotation * len - (chordCount % (rotation * len)) : 0,
    }
  }
  // Solo sections in order, counted across loops of the form.
  const soloStarts = steps.map((s, i) => (s.solo && s.first ? i : -1)).filter((i) => i >= 0)
  const perPass = soloStarts.length
  if (!perPass) return { soloist: null, nextSoloist: null, chordsUntilSwap: 0, soloLeft: 0 }
  const pass = Math.floor(chordCount / len)
  const idx = chordCount % len
  const occurrence = (p: number, i: number) => p * perPass + soloStarts.filter((s) => s <= i).length - 1
  const who = (occ: number) => soloistFor(band, occ, rotation ? 1 : 0)
  const inSolo = steps[idx].solo
  const current = inSolo ? who(occurrence(pass, idx)) : null
  // The next solo section's start, maybe in the next pass of the form.
  const nextStart = soloStarts.find((s) => s > idx)
  const until = nextStart !== undefined ? nextStart - idx : len - idx + soloStarts[0]
  const nextOcc = nextStart !== undefined ? occurrence(pass, nextStart) : occurrence(pass + 1, soloStarts[0])
  let soloLeft = 0
  if (inSolo) for (let j = idx; j < len && steps[j].solo && (j === idx || !steps[j].first); j++) soloLeft++
  return { soloist: current, nextSoloist: who(nextOcc), chordsUntilSwap: until, soloLeft }
}

/** Beats from `beatInChord` of step `idx` until the next section starts. */
export function beatsToNextSection(steps: Step[], idx: number, beatInChord: number): number {
  if (!steps.length) return 0
  let beats = steps[idx].beats - beatInChord
  for (let k = 1; k < steps.length; k++) {
    const st = steps[(idx + k) % steps.length]
    if (st.first) break
    beats += st.beats
  }
  return beats
}

/** Length of a section in bars (pattern × repeats, 4/4). */
export const sectionBars = (s: SongSection) => (s.chords.reduce((a, c) => a + c.beats, 0) * Math.max(1, s.repeat ?? 1)) / 4

/** How far into the current section run (form entry) we are: 0 at its first beat, 1 at its end. */
export function sectionProgress(steps: Step[], idx: number, beatsIntoChord: number): number {
  if (!steps.length || steps[idx].formIdx < 0) return 0
  let start = idx
  while (start > 0 && !steps[start].first) start--
  let end = idx
  while (end + 1 < steps.length && !steps[end + 1].first) end++
  let total = 0
  let elapsed = 0
  for (let k = start; k <= end; k++) {
    if (k < idx) elapsed += steps[k].beats
    total += steps[k].beats
  }
  return total ? Math.min(1, (elapsed + beatsIntoChord) / total) : 0
}

export const totalBeats = (steps: Step[]) => steps.reduce((a, s) => a + s.beats, 0)

export interface Segment {
  start: number // beat
  beats: number
  section: string
  solo: boolean
  formIdx: number
}

/** The song's sections as stretches of beats, for the progress bar. */
export function songSegments(steps: Step[]): Segment[] {
  const out: Segment[] = []
  let beat = 0
  for (const s of steps) {
    if (s.first || !out.length) out.push({ start: beat, beats: 0, section: s.section, solo: s.solo, formIdx: s.formIdx })
    out[out.length - 1].beats += s.beats
    beat += s.beats
  }
  return out
}
