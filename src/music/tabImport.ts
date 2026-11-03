// Setting a song up from a Guitar Pro tab the user downloaded: the tab's own sections, bars, tempo,
// chords, rhythm guitar pattern and, when it has a vocal part, the words in time (or where the singing is).
import type { model } from '@coderline/alphatab'
import { keyFromChords } from './keyGuess'
import type { SongSection, SongSetup } from './songForm'
import { noteName, parseChord, pc, prefersFlats } from './theory'

type Score = model.Score
type Track = model.Track
type Beat = model.Beat

const TICKS = 960 // MIDI ticks per quarter note in alphaTab
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface TabInfo {
  bars: number
  meter: string // "4/4"
  tempoChanges: boolean
  chordsFrom: 'tab' | 'notes' // the tab's chord names, or worked out from its notes
  chordTrack: string
  rhythmTrack: string // the guitar part the strum patterns come from ('' if none)
  vocalTrack: string
  words: number // words with their timing from the tab (0 if none)
  phrases: number // sung phrases found in a vocal melody without words
}

interface PlayedBar {
  mb: number // master bar index
  start: number // song beat where this bar starts
  beats: number // length in quarter beats
}

/** The master bars in playing order, with repeats (and 1st/2nd endings) played out. */
function playOrder(score: Score): number[] {
  const bars = score.masterBars
  const order: number[] = []
  let repeatStart = 0
  let pass = 1
  let jumped = false
  for (let i = 0; i < bars.length && order.length < 2000; ) {
    const mb = bars[i]
    if (mb.isRepeatStart && !jumped) {
      repeatStart = i
      pass = 1
    }
    jumped = false
    if (mb.alternateEndings && !(mb.alternateEndings & (1 << (pass - 1)))) {
      i++
      continue
    }
    order.push(i)
    if (mb.repeatCount > 1 && pass < mb.repeatCount) {
      pass++
      jumped = true
      i = repeatStart
      continue
    }
    i++
  }
  return order
}

const isDrums = (t: Track) => t.isPercussion || t.staves.every((s) => s.isPercussion)
const program = (t: Track) => t.playbackInfo.program
const isVocal = (t: Track) => /vocal|voice|vox|lyric|sing|chant/i.test(t.name) || (program(t) >= 52 && program(t) <= 54)
const isBass = (t: Track) => /bass/i.test(t.name) || (program(t) >= 32 && program(t) <= 39)
const isGuitar = (t: Track) => !isBass(t) && !isVocal(t) && (/guit|gtr/i.test(t.name) || (program(t) >= 24 && program(t) <= 31))

/** Every beat of a track in one master bar (all staves and voices). */
function beatsIn(t: Track, mb: number): Beat[] {
  return t.staves.flatMap((s) => (s.bars[mb]?.voices ?? []).flatMap((v) => v.beats))
}

/** A chord name from the tab as a symbol the app plays: "C7M" → "Cmaj7", "Em11/F#" → "Em", "Dsus4add9/F#" → "Dsus4/F#". */
export function tidyChord(name: string): string | null {
  const m = /^\s*([A-Ga-g][#b]?)([^/\s]*)(?:\/([A-Ga-g][#b]?))?/.exec(name)
  if (!m) return null
  const root = m[1][0].toUpperCase() + m[1].slice(1)
  const bass = m[3] ? `/${m[3][0].toUpperCase()}${m[3].slice(1)}` : ''
  let q = m[2].replace(/^7M/, 'maj7').replace(/^M7/, 'maj7').replace(/^Maj/, 'maj')
  if (!parseChord(root + q)) {
    if (/^m(?!aj)|^min|^-/.test(q)) q = /^m7/.test(q) ? 'm7' : 'm'
    else if (/^5/.test(q)) q = '5'
    else if (/^sus2/.test(q)) q = 'sus2'
    else if (/^sus/.test(q)) q = 'sus4'
    else if (/^dim/.test(q)) q = 'dim'
    else if (/^aug|^\+/.test(q)) q = 'aug'
    else if (/^7/.test(q)) q = '7'
    else if (/^maj7/.test(q)) q = 'maj7'
    else q = ''
  }
  return parseChord(root + q) ? root + q + bass : null
}

/** The chord in each half of each played bar, from the tab's chord names (carried forward until the next one). */
function chordsFromNames(t: Track, played: PlayedBar[]): string[][] {
  let last = 'N'
  return played.map((p) => {
    const marks = beatsIn(t, p.mb)
      .filter((b) => b.chordId)
      .map((b) => ({ at: b.playbackStart / TICKS, name: tidyChord(b.chord?.name ?? '') }))
      .filter((x): x is { at: number; name: string } => !!x.name)
      .sort((a, b) => a.at - b.at)
    const half = p.beats / 2
    const at = (x: number) => {
      let c = last
      for (const m of marks) if (m.at <= x + 0.01) c = m.name
      return c
    }
    const first = at(0)
    const second = at(half)
    if (marks.length) last = marks[marks.length - 1].name
    return [first, second]
  })
}

/** The chord in each half of each played bar, worked out from the notes of the band's tracks. */
function chordsFromNotes(score: Score, played: PlayedBar[]): string[][] {
  const tracks = score.tracks.filter((t) => !isDrums(t) && !isVocal(t))
  let last = 'N'
  return played.map((p) => {
    const half = p.beats / 2
    const out: string[] = []
    for (const [from, to] of [
      [0, half],
      [half, p.beats],
    ]) {
      const w = new Array(12).fill(0)
      const bassW = new Array(12).fill(0)
      for (const t of tracks)
        for (const b of beatsIn(t, p.mb)) {
          const s = b.playbackStart / TICKS
          const e = s + b.playbackDuration / TICKS
          const overlap = Math.min(e, to) - Math.max(s, from)
          if (overlap <= 0 || !b.notes.length) continue
          const sounding = b.notes.filter((n) => !n.isDead)
          if (!sounding.length) continue
          const low = Math.min(...sounding.map((n) => n.realValue))
          for (const n of sounding) w[pc(n.realValue)] += overlap
          // The lowest note (the bass, or a guitar's bottom string) usually names the chord.
          bassW[pc(low)] += overlap * (isBass(t) ? 2 : 0.7)
        }
      const total = w.reduce((a, b) => a + b, 0)
      if (!total) {
        out.push(last)
        continue
      }
      let best = { name: last, score: -Infinity }
      for (let r = 0; r < 12; r++)
        for (const [suffix, iv] of [
          ['', [0, 4, 7]],
          ['m', [0, 3, 7]],
        ] as const) {
          let sc = bassW[r] * 1.2
          for (let k = 0; k < 12; k++) sc += w[k] * ((iv as readonly number[]).includes(pc(k - r)) ? 1 : -0.6)
          if (sc > best.score) {
            // No third at all: a power chord.
            const thirds = w[pc(r + 3)] + w[pc(r + 4)]
            best = { name: NAMES[r] + (thirds < 0.08 * w[r] ? '5' : suffix), score: sc }
          }
        }
      last = best.name
      out.push(best.name)
    }
    return out
  })
}

/** One bar of the rhythm guitar as 8 slots (D U x _ -), or null if it isn't a 4/4 bar or it's silent. */
function strumOf(t: Track, p: PlayedBar): { slots: string; single: number; chords: number; muted: number; palm: number } | null {
  if (p.beats !== 4) return null
  const slots = new Array(8).fill('_')
  let single = 0
  let chords = 0
  let muted = 0
  let palm = 0
  const beats = t.staves[0]?.bars[p.mb]?.voices[0]?.beats ?? []
  for (const b of beats) {
    const slot = Math.round(b.playbackStart / (TICKS / 2))
    if (slot < 0 || slot > 7 || b.isRest || !b.notes.length) continue
    if (b.notes.every((n) => n.isTieDestination)) {
      slots[slot] = '-'
      continue
    }
    if (b.notes.every((n) => n.isDead)) {
      slots[slot] = 'x'
      muted++
      continue
    }
    if (b.notes.length > 1) chords++
    else single++
    if (b.notes.some((n) => n.isPalmMute)) palm++
    const up = b.brushType === 1 || b.brushType === 3 || b.pickStroke === 1
    const down = b.brushType === 2 || b.brushType === 4 || b.pickStroke === 2
    slots[slot] = up ? 'U' : down ? 'D' : slot % 2 ? 'U' : 'D'
  }
  if (!chords && !single && !muted) return null
  return { slots: slots.join(''), single, chords, muted, palm }
}

/** The track the words or the vocal melody come from. */
function vocalTrack(score: Score): { track: Track; withWords: boolean } | null {
  let best: Track | null = null
  let most = 0
  for (const t of score.tracks) {
    if (isDrums(t)) continue
    let n = 0
    for (const s of t.staves) for (const b of s.bars) for (const v of b.voices) for (const bt of v.beats) if (bt.lyrics?.[0]?.trim()) n++
    if (n > most) {
      most = n
      best = t
    }
  }
  if (best && most >= 8) return { track: best, withWords: true }
  // A melody without words: a track named for the voice (a voice sound alone is often a sampler).
  const named = score.tracks.find((t) => /vocal|voice|vox|lyric|sing/i.test(t.name) && !isDrums(t))
  return named ? { track: named, withWords: false } : null
}

interface Sung {
  start: number
  end: number
  text: string // the syllable ("An-", "oth-", "er"), '' for a note without words
}

/** The vocal part's notes (with their syllables) on the song's beat clock. */
function sungNotes(t: Track, played: PlayedBar[]): Sung[] {
  const out: Sung[] = []
  for (const p of played)
    for (const b of t.staves[0]?.bars[p.mb]?.voices[0]?.beats ?? []) {
      if (b.isRest || !b.notes.length || b.notes.every((n) => n.isTieDestination)) continue
      const start = p.start + b.playbackStart / TICKS
      out.push({ start, end: start + b.playbackDuration / TICKS, text: (b.lyrics?.[0] ?? '').trim() })
    }
  return out
}

/** Sung phrases: notes grouped until a rest of at least a beat. */
function phrasesOf(notes: Sung[]): { start: number; end: number; notes: Sung[] }[] {
  const out: { start: number; end: number; notes: Sung[] }[] = []
  for (const n of notes) {
    const cur = out[out.length - 1]
    if (cur && n.start - cur.end < 1) {
      cur.notes.push(n)
      cur.end = Math.max(cur.end, n.end)
    } else out.push({ start: n.start, end: n.end, notes: [n] })
  }
  return out
}

/** Lines of words: syllables joined into words ("An-" + "oth-" + "er"), a new line at each sung phrase. */
function wordLines(notes: Sung[]): { start: number; words: { text: string; start: number }[] }[] {
  const lines: { start: number; words: { text: string; start: number }[] }[] = []
  for (const ph of phrasesOf(notes.filter((n) => n.text))) {
    let line: (typeof lines)[number] | null = null
    let joining = false
    for (const n of ph.notes) {
      // Very long phrases break after punctuation, so a line fits on a phone.
      const prev = line?.words[line.words.length - 1]?.text ?? ''
      const count = line?.words.length ?? 0
      if (!line || (!joining && ((count >= 5 && /[.!?]$/.test(prev)) || (count >= 9 && /[,;]$/.test(prev)) || count >= 14))) {
        line = { start: n.start, words: [] }
        lines.push(line)
      }
      const syl = n.text.replace(/-$/, '')
      if (joining && line.words.length) line.words[line.words.length - 1].text += syl
      else line.words.push({ text: syl, start: n.start })
      joining = n.text.endsWith('-')
    }
  }
  return lines
}

const cleanName = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

/** "Linkin Park - Numb (ver 2).gp4" → title and artist, when the tab itself doesn't say. */
function namesFromFile(file: string) {
  const base = file.replace(/\.[a-z0-9]+$/i, '').replace(/\s*\((ver|version)[^)]*\)\s*/i, ' ').trim()
  const m = /^(.+?)\s+-\s+(.+)$/.exec(base)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base }
}

/** Sets a song up from a tab. */
export function songFromTab(score: Score, fileName: string): { song: SongSetup; info: TabInfo } {
  const order = playOrder(score)
  const played: PlayedBar[] = []
  let beat = 0
  for (const mb of order) {
    const m = score.masterBars[mb]
    const beats = (m.timeSignatureNumerator * 4) / m.timeSignatureDenominator
    played.push({ mb, start: beat, beats })
    beat += beats
  }

  // Chords: the tab's chord names when it has enough of them, else worked out from the notes.
  const named = score.tracks
    .map((t) => ({ t, n: t.staves.reduce((a, s) => a + s.bars.reduce((b, bar) => b + bar.voices.reduce((c, v) => c + v.beats.filter((x) => x.chordId).length, 0), 0), 0) }))
    .sort((a, b) => b.n - a.n)[0]
  const useNames = !!named && named.n >= 8
  const fromNotes = chordsFromNotes(score, played)
  // Where the part with the chord names is silent (it sits out a verse), the notes of the others decide.
  const halves = useNames
    ? chordsFromNames(named.t, played).map((h, i) => (beatsIn(named.t, played[i].mb).some((b) => b.notes.some((n) => !n.isDead)) ? h : fromNotes[i]))
    : fromNotes
  const barChords = halves.map(([a, b]) => (a !== b && a !== 'N' && b !== 'N' ? `${a}|${b}` : a === 'N' ? b : a))

  // Sections from the tab's markers; bars before the first marker join an intro.
  const occ: { name: string; bars: number[] }[] = []
  played.forEach((p, i) => {
    const marker = score.masterBars[p.mb].section
    const name = marker ? cleanName(marker.text || marker.marker) : ''
    if (name || !occ.length) {
      if (i > 0 && occ.length && !occ[occ.length - 1].name && /^intro/i.test(name)) occ[occ.length - 1].name = name
      else occ.push({ name, bars: [] })
    }
    occ[occ.length - 1].bars.push(i)
  })
  if (!occ[0].name) occ[0].name = 'Intro'

  // The rhythm guitar: in each section, the guitar part strumming the most chords (else the busiest).
  const guitars = score.tracks.filter((t) => isGuitar(t) && !isDrums(t))
  const rhythmFor = (bars: number[]) =>
    guitars
      .map((t) => {
        const st = bars.map((i) => strumOf(t, played[i]))
        return { t, n: st.reduce((a, x) => a + (x ? x.chords * 3 + x.single + x.muted : 0), 0) }
      })
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)[0]?.t
  const rhythmNames = new Set<string>()

  const sections: SongSection[] = []
  const form: string[] = []
  for (const o of occ) {
    const chords: { chord: string; beats: number }[] = []
    for (const i of o.bars) {
      const [a, b] = halves[i]
      const half = played[i].beats / 2
      for (const c of [a, b]) {
        const sym = c === 'N' ? (chords[chords.length - 1]?.chord ?? 'N') : c
        if (chords.length && chords[chords.length - 1].chord === sym) chords[chords.length - 1].beats += half
        else chords.push({ chord: sym, beats: half })
      }
    }
    // A section that starts before any chord is heard takes its first chord from what follows.
    const firstReal = chords.find((c) => c.chord !== 'N')?.chord ?? barChords.find((c) => c !== 'N')?.split('|')[0] ?? 'C'
    for (const c of chords) if (c.chord === 'N') c.chord = firstReal
    const merged = chords.reduce<{ chord: string; beats: number }[]>((acc, c) => {
      if (acc.length && acc[acc.length - 1].chord === c.chord) acc[acc.length - 1].beats += c.beats
      else acc.push({ ...c })
      return acc
    }, [])

    // Strum: the bar pattern the rhythm guitar plays most in this section.
    let strum: string | undefined
    let technique: string | undefined
    const rhythm = rhythmFor(o.bars)
    if (rhythm) {
      rhythmNames.add(rhythm.name)
      const bars = o.bars.map((i) => strumOf(rhythm, played[i])).filter((x): x is NonNullable<typeof x> => !!x)
      const counts = new Map<string, number>()
      for (const b of bars) counts.set(b.slots, (counts.get(b.slots) ?? 0) + 1)
      strum = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      const sum = (k: 'single' | 'chords' | 'muted' | 'palm') => bars.reduce((a, b) => a + b[k], 0)
      const hits = sum('single') + sum('chords')
      const bits: string[] = []
      if (hits && sum('palm') > hits * 0.4) bits.push('palm-muted')
      if (hits && sum('single') > sum('chords') * 2) bits.push('riff / picked single notes (see the tab)')
      else if (hits) bits.push('chords')
      if (sum('muted') > hits * 0.2) bits.push('with muted chops')
      technique = bits.join(' ') || undefined
    }

    // The same section played again (same name and chords) is reused; a different one gets a number.
    const same = sections.find((s) => s.name.replace(/ \(\d+\)$/, '') === o.name && JSON.stringify(s.chords) === JSON.stringify(merged))
    if (same) {
      form.push(same.name)
      continue
    }
    const taken = sections.filter((s) => s.name === o.name || s.name.startsWith(`${o.name} (`)).length
    const name = taken ? `${o.name} (${taken + 1})` : o.name
    sections.push({ name, chords: merged, solo: /solo|instrumental|interlude/i.test(o.name), strum, technique })
    form.push(name)
  }

  // Where each form entry starts on the song's beat clock.
  const entryStart = occ.map((o) => played[o.bars[0]].start)
  const entryOf = (b: number) => {
    let f = 0
    while (f + 1 < entryStart.length && entryStart[f + 1] <= b) f++
    return f
  }

  // Words (with their timing), or the sung phrases of a melody without words.
  const vocal = vocalTrack(score)
  const sung = vocal ? sungNotes(vocal.track, played) : []
  let lyrics: string[] | undefined
  let lyricBeats: (number[] | null)[] | undefined
  let lyricWords: (number[][] | null)[] | undefined
  let vocalPhrases: (number[] | null)[] | undefined
  let words = 0
  if (vocal?.withWords) {
    const blocks = form.map(() => [] as { start: number; words: { text: string; start: number }[] }[])
    // A line belongs to the section it's mostly in: a pickup just before a section goes with it.
    for (const l of wordLines(sung)) blocks[entryOf(l.start + 1.5)].push(l)
    lyrics = blocks.map((ls) => ls.map((l) => l.words.map((w) => w.text).join(' ')).join('\n'))
    lyricBeats = blocks.map((ls, f) => (ls.length ? ls.map((l) => l.start - entryStart[f]) : null))
    lyricWords = blocks.map((ls, f) => (ls.length ? ls.map((l) => l.words.map((w) => w.start - entryStart[f])) : null))
    words = blocks.reduce((a, ls) => a + ls.reduce((b, l) => b + l.words.length, 0), 0)
  } else if (sung.length) {
    const per = form.map(() => [] as number[])
    for (const ph of phrasesOf(sung)) per[entryOf(ph.start + 1)].push(ph.start - entryStart[entryOf(ph.start + 1)])
    vocalPhrases = per.map((x) => (x.length ? x : null))
  }

  // The key: every note the tab plays (melody included) and how the chords sit in it.
  const profile = new Array(12).fill(0)
  for (const t of score.tracks)
    if (!isDrums(t)) for (const p of played) for (const b of beatsIn(t, p.mb)) for (const n of b.notes) if (!n.isDead && !n.isTieDestination) profile[pc(n.realValue)] += b.playbackDuration / TICKS
  const key = keyFromChords(barChords, profile.some(Boolean) ? profile : undefined)
  const sig = score.masterBars[0]?.keySignature ?? 0
  const keyRoot = key ? key.root : pc(sig * 7)
  const minor = key ? key.minor : false
  const tempos = new Set(score.masterBars.flatMap((m) => m.tempoAutomations.map((a) => Math.round(a.value))))
  const { title, artist } = namesFromFile(fileName)
  const bpm = Math.round(score.tempo) || 100
  const m0 = score.masterBars[0]

  const song: SongSetup = {
    title: cleanName(score.title) && score.title.toUpperCase() !== score.title ? score.title.trim() : title || cleanName(score.title.toLowerCase()),
    artist: score.artist.trim() || artist,
    key: noteName(keyRoot, prefersFlats(keyRoot, minor)),
    minor,
    bpm,
    feel: bpm < 76 ? 'ballad' : 'pop',
    capo: 0,
    sections,
    form,
    notes: `Set up from the tab "${fileName}"${tempos.size > 1 ? ` (the tab changes tempo: ${[...tempos].join(', ')} BPM; this plays at ${bpm})` : ''}.`,
    lyrics,
    lyricBeats,
    lyricWords,
    vocalPhrases,
  }
  return {
    song,
    info: {
      bars: played.length,
      meter: `${m0?.timeSignatureNumerator ?? 4}/${m0?.timeSignatureDenominator ?? 4}`,
      tempoChanges: tempos.size > 1,
      chordsFrom: useNames ? 'tab' : 'notes',
      chordTrack: useNames ? named.t.name : '',
      rhythmTrack: [...rhythmNames].join(', '),
      vocalTrack: vocal?.track.name ?? '',
      words,
      phrases: vocalPhrases?.reduce((a, x) => a + (x?.length ?? 0), 0) ?? 0,
    },
  }
}

