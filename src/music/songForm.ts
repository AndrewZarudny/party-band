// A jam as a sequence of chord steps: a free-jam progression (every chord the same length,
// looping) or a real song's form (sections with their own chords and lengths, solo sections).
import type { Member } from './band'
import { soloistFor } from './band'
import type { Chord } from './theory'
import { parseChord } from './theory'
import type { LyricLine } from './lyrics'
import { lyricTimeline } from './lyrics'
import type { WordLine } from './wordChords'
import { hasWordChords, wordAt, wordLines, wordStarts } from './wordChords'

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
  // The words were pasted with chords over them (from a chord site): the band plays those chords.
  wordChords?: boolean
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

    if (measured && song.useRecordedChords && song.barChords && !playsWordChords(song)) {
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
  return playsWordChords(song) ? chordsFromWords(steps, song) : steps
}

/** Pasted chords over the words win over the chords the app found on the record. */
const playsWordChords = (song: SongSetup) => !!song.wordChords && !!song.lyrics?.some(hasWordChords)

/**
 * When each chord written over a section's words comes in, on the song's beat clock: at the word it stands
 * over (sung then, by the words' timing), chords after the words spread out until the next line, and a
 * section written as chords only (an intro, a solo) gets a bar per chord, round and round.
 */
export function wordChordEvents(rows: WordLine[], lines: LyricLine[], seg: { start: number; beats: number }): { beat: number; chord: string }[] {
  const end = seg.start + seg.beats
  const sung = rows.filter((r) => r.text)
  const ev: { beat: number; chord: string }[] = []
  if (!sung.length || lines.length !== sung.length) {
    const all = rows.flatMap((r) => r.chords.map((c) => c.chord))
    if (all.length) for (let b = seg.start, i = 0; b < end; b += 4, i++) ev.push({ beat: b, chord: all[i % all.length] })
    return ev
  }
  let k = -1
  let pending: string[] = []
  const flush = (from: number, to: number) => {
    pending.forEach((c, j) => ev.push({ beat: from + (j * Math.max(0, to - from)) / pending.length, chord: c }))
    pending = []
  }
  for (const r of rows) {
    if (!r.text) {
      pending.push(...r.chords.map((c) => c.chord))
      continue
    }
    const L = lines[k + 1]
    const prev = lines[k]
    flush(prev ? Math.min(prev.end, L.start) : Math.min(seg.start, L.start), L.start)
    k++
    for (const c of r.chords) {
      if (c.at >= r.text.length) pending.push(c.chord)
      else if (L.words) ev.push({ beat: L.words[Math.min(wordAt(r.text, c.at), L.words.length - 1)], chord: c.chord })
      else ev.push({ beat: L.start + (c.at / r.text.length) * (L.end - L.start), chord: c.chord })
    }
  }
  flush(Math.min(lines[k].end, end), end)
  return ev.sort((a, b) => a.beat - b.beat)
}

/** The song's steps with every section that has chords over its words playing those chords (same lengths). */
export function chordsFromWords(steps: Step[], song: SongSetup): Step[] {
  const segs = songSegments(steps)
  const groups: Step[][] = []
  for (const s of steps) {
    if (s.first || !groups.length) groups.push([])
    groups[groups.length - 1].push(s)
  }
  const lines = lyricTimeline({ lyrics: song.lyrics, lyricBeats: song.lyricBeats, lyricWords: song.lyricWords, vocalPhrases: song.vocalPhrases }, segs)
  const out: Step[] = []
  let carry: string | null = null
  segs.forEach((seg, gi) => {
    const own = groups[gi]
    const rows = wordLines(song.lyrics?.[seg.formIdx])
    const ev = rows.some((r) => r.chords.length) ? wordChordEvents(rows, lines.filter((l) => l.formIdx === seg.formIdx), seg) : []
    if (!ev.length) {
      out.push(...own)
      carry = own[own.length - 1]?.chord.symbol ?? carry
      return
    }
    // Each change on the half bar (or the beat, when two land on the same half bar).
    const changes = new Map<number, string>()
    let lastQ = -1
    for (const e of ev) {
      let q = Math.max(0, Math.round((e.beat - seg.start) / 2) * 2)
      if (q <= lastQ && changes.size) q = lastQ + 1
      if (q >= seg.beats) {
        carry = e.chord
        continue
      }
      changes.set(q, e.chord)
      lastQ = q
    }
    // Where the section's passes start, so the chord strip still shows one pass at a time.
    const passStarts = new Map<number, number>()
    let acc = 0
    for (const s of own) {
      if (!passStarts.has(s.pass ?? 0)) passStarts.set(s.pass ?? 0, acc)
      acc += s.beats
    }
    const passAt = (b: number) => {
      let p = 0
      for (const [pass, at] of passStarts) if (at <= b) p = Math.max(p, pass)
      return p
    }
    const points = [...new Set([0, ...changes.keys(), ...passStarts.values()])].filter((b) => b < seg.beats).sort((a, b) => a - b)
    let cur = changes.get(0) ?? carry ?? ev[0].chord
    const mine: Step[] = []
    points.forEach((b, j) => {
      cur = changes.get(b) ?? cur
      const beats = (points[j + 1] ?? seg.beats) - b
      const chord = parseChord(cur)
      if (!chord) return
      const pass = passAt(b)
      const prev = mine[mine.length - 1]
      if (prev && prev.chord.symbol === chord.symbol && prev.pass === pass) prev.beats += beats
      else mine.push({ ...own[0], chord, beats, first: !mine.length, pass })
    })
    // A chord the app can't read leaves a gap: those beats go to the chord before.
    const got = mine.reduce((a, s) => a + s.beats, 0)
    if (mine.length && got < seg.beats) mine[mine.length - 1].beats += seg.beats - got
    out.push(...(mine.length ? mine : own))
    carry = cur
  })
  return out
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
/**
 * Where ◀ / ▶ take you from `beat`: ▶ the next section's start (null at the last one); ◀ back to the start of
 * this section, or to the one before when you're within its first 2 beats (pressed twice, it keeps going back).
 */
export function sectionJump(segments: Segment[], beat: number, dir: 1 | -1): number | null {
  if (!segments.length) return null
  let i = segments.findIndex((s) => beat >= s.start && beat < s.start + s.beats)
  if (i < 0) i = beat < segments[0].start ? 0 : segments.length - 1
  if (dir === 1) return i + 1 < segments.length ? segments[i + 1].start : null
  return beat - segments[i].start > 2 || i === 0 ? segments[i].start : segments[i - 1].start
}

/** The section playing at `beat`, as an index into the segments; -1 outside the song. */
export const segmentAt = (segments: Segment[], beat: number) => segments.findIndex((s) => beat >= s.start && beat < s.start + s.beats)

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

/** A piece of a sung line with the chord that comes in on its first letter (null: before the first chord). */
export interface SheetChunk {
  chord: string | null
  text: string
}

/** One entry of the song form on the song sheet: its chords bar by bar (one pass), and its words with the chords over them. */
export interface SheetSection {
  formIdx: number
  name: string
  solo: boolean
  bars: string[][] // chord symbols in each 4-beat bar of one pass of the pattern
  passes: number // how many times that pattern is played
  rows: SheetChunk[][] // the words line by line, chords over them (empty: no words)
}

function chunksOf(r: WordLine): SheetChunk[] {
  if (!r.chords.length) return [{ chord: null, text: r.text }]
  const cs = [...r.chords].sort((a, b) => a.at - b.at)
  const out: SheetChunk[] = []
  if (cs[0].at > 0) out.push({ chord: null, text: r.text.slice(0, cs[0].at) })
  cs.forEach((c, j) => out.push({ chord: c.chord, text: r.text.slice(Math.min(c.at, r.text.length), Math.min(cs[j + 1]?.at ?? r.text.length, r.text.length)) }))
  return out
}

/** Puts the chords the band plays over the words, each at the word sung when it comes in. */
function alignChords(texts: string[], times: { start: number; end: number; words?: number[] }[], events: { beat: number; chord: string }[]): WordLine[] {
  const rows: WordLine[] = texts.map((text) => ({ text, chords: [] }))
  const lead: string[] = []
  for (const e of events) {
    let k = -1
    times.forEach((t, j) => {
      if (t.start <= e.beat + 0.25) k = j
    })
    if (k < 0) {
      lead.push(e.chord)
      continue
    }
    const L = times[k]
    const text = rows[k].text
    const starts = wordStarts(text)
    let at: number
    if (L.end > L.start && e.beat > L.end + 0.25) at = text.length // after the words, before the next line
    else if (L.words) {
      let w = 0
      L.words.forEach((b, j) => {
        if (b <= e.beat + 0.25) w = j
      })
      at = starts[w] ?? 0
    } else {
      const pos = ((e.beat - L.start) / Math.max(0.01, L.end - L.start)) * text.length
      at = starts.reduce((best, x) => (Math.abs(x - pos) < Math.abs(best - pos) ? x : best), 0)
    }
    rows[k].chords.push({ at, chord: e.chord })
  }
  return lead.length ? [{ text: '', chords: lead.map((chord) => ({ at: 0, chord })) }, ...rows] : rows
}

/**
 * The whole song for the side sheet, in playing order: the chords as the band plays them (transposed, or the
 * record's chords when those are used) and the words per section with the chords over them, as chord sites
 * write them. Chords pasted over the words are shown where they were written; otherwise each chord sits over
 * the word sung when it comes in (from the words' timing in `lines`, else spread over the section).
 */
export function songSheet(
  steps: Step[],
  lyrics: string[] | undefined,
  opts: { lines?: LyricLine[]; wordChords?: boolean; mapChord?: (symbol: string) => string } = {},
): SheetSection[] {
  const out: SheetSection[] = []
  const events = new Map<number, { beat: number; chord: string }[]>()
  const segStart = new Map<number, { start: number; beats: number }>()
  let beat = 0
  let beatInBar = 0
  for (const s of steps) {
    if (s.formIdx >= 0) {
      const ev = events.get(s.formIdx) ?? []
      if (ev[ev.length - 1]?.chord !== s.chord.symbol) ev.push({ beat, chord: s.chord.symbol })
      events.set(s.formIdx, ev)
      const seg = segStart.get(s.formIdx) ?? { start: beat, beats: 0 }
      seg.beats += s.beats
      segStart.set(s.formIdx, seg)
    }
    beat += s.beats
    if (s.formIdx < 0) continue
    let sec = out[out.length - 1]
    if (!sec || sec.formIdx !== s.formIdx) {
      sec = { formIdx: s.formIdx, name: s.section, solo: s.solo, bars: [], passes: s.passes ?? 1, rows: [] }
      out.push(sec)
      beatInBar = 0
    }
    if ((s.pass ?? 0) > 0) continue // the pattern again: shown once, with ×passes
    let left = s.beats
    while (left > 0) {
      if (beatInBar === 0 || !sec.bars.length) sec.bars.push([])
      const bar = sec.bars[sec.bars.length - 1]
      if (bar[bar.length - 1] !== s.chord.symbol) bar.push(s.chord.symbol)
      const take = Math.min(left, 4 - beatInBar)
      left -= take
      beatInBar = (beatInBar + take) % 4
    }
  }
  const map = opts.mapChord ?? ((c: string) => c)
  for (const sec of out) {
    const written = wordLines(lyrics?.[sec.formIdx])
    if (!written.some((r) => r.text)) continue
    let rows: WordLine[]
    if (opts.wordChords && written.some((r) => r.chords.length)) rows = written.map((r) => ({ ...r, chords: r.chords.map((c) => ({ ...c, chord: map(c.chord) })) }))
    else {
      const texts = written.filter((r) => r.text).map((r) => r.text)
      const seg = segStart.get(sec.formIdx)!
      const timed = opts.lines?.filter((l) => l.formIdx === sec.formIdx) ?? []
      const times =
        timed.length === texts.length
          ? timed
          : texts.map((_, i) => ({ start: seg.start + (i * seg.beats) / texts.length, end: seg.start + ((i + 1) * seg.beats) / texts.length }))
      rows = alignChords(texts, times, events.get(sec.formIdx) ?? [])
    }
    sec.rows = rows.map(chunksOf)
  }
  return out
}
