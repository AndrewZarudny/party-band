// Note names, scales, chords and fretboard helpers.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Standard tuning, low E → high E, as MIDI numbers. String index 0 = low E. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64]

export const pc = (n: number) => ((n % 12) + 12) % 12
export const noteName = (p: number, flats = false) => (flats ? FLAT_NAMES : SHARP_NAMES)[pc(p)]
export const midiName = (m: number) => noteName(m) + (Math.floor(m / 12) - 1)
export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
export const freqToMidiFloat = (f: number) => 69 + 12 * Math.log2(f / 440)

export interface ScaleDef {
  label: string
  intervals: number[]
  minor: boolean
}

export const SCALES: Record<string, ScaleDef> = {
  minorPent: { label: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10], minor: true },
  blues: { label: 'Blues', intervals: [0, 3, 5, 6, 7, 10], minor: true },
  majorPent: { label: 'Major pentatonic', intervals: [0, 2, 4, 7, 9], minor: false },
  minor: { label: 'Natural minor (Aeolian)', intervals: [0, 2, 3, 5, 7, 8, 10], minor: true },
  major: { label: 'Major (Ionian)', intervals: [0, 2, 4, 5, 7, 9, 11], minor: false },
  dorian: { label: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10], minor: true },
  mixolydian: { label: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], minor: false },
  harmonicMinor: { label: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11], minor: true },
}

export interface Chord {
  symbol: string
  root: number // pitch class
  tones: number[] // pitch classes, root first
  quality: string // suffix as written, e.g. "m7"
}

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '-': [0, 3, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  '9': [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  m9: [0, 3, 7, 10, 2],
  add9: [0, 4, 7, 2],
  madd9: [0, 3, 7, 2],
  '11': [0, 4, 7, 10, 5],
  '13': [0, 4, 7, 10, 9],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6],
  '°': [0, 3, 6],
  dim7: [0, 3, 6, 9],
  '°7': [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  'ø': [0, 3, 6, 10],
  'ø7': [0, 3, 6, 10],
  aug: [0, 4, 8],
  '+': [0, 4, 8],
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** A chord symbol moved by n semitones ("F#m7/C#" +2 → "G#m7/D#"), spelled with flats or sharps. */
export function transposeChord(symbol: string, n: number, flats: boolean): string {
  const m = /^\s*([A-Ga-g][#b♯♭]?)([^/]*)(?:\/([A-Ga-g][#b♯♭]?))?\s*$/.exec(symbol)
  if (!m || !pc(n)) return symbol
  const move = (note: string) => {
    const r = parseChord(note)?.root
    return r === undefined ? note : noteName(r + n, flats)
  }
  return move(m[1]) + m[2] + (m[3] ? `/${move(m[3])}` : '')
}

/** Parses chord symbols like "Am", "F#7", "Bbmaj7", "C/G". */
export function parseChord(symbol: string): Chord | null {
  const s = symbol.trim()
  const m = /^([A-Ga-g])([#b♯♭]?)([^/]*)(?:\/.*)?$/.exec(s)
  if (!m) return null
  let root = LETTER_PC[m[1].toUpperCase()]
  if (m[2] === '#' || m[2] === '♯') root++
  if (m[2] === 'b' || m[2] === '♭') root--
  const intervals = QUALITIES[m[3]]
  if (!intervals) return null
  root = pc(root)
  return { symbol: s, root, tones: intervals.map((i) => pc(root + i)), quality: m[3] }
}

const DEGREES: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 }

/** Converts a roman numeral ("ii7", "bVII", "V7", "vii°") to a chord in the given key. */
export function romanToChord(roman: string, keyRoot: number, flats: boolean): Chord | null {
  const m = /^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/.exec(roman.trim())
  if (!m) return null
  let root = keyRoot + DEGREES[m[2].toUpperCase()]
  if (m[1] === 'b') root--
  if (m[1] === '#') root++
  const lower = m[2] === m[2].toLowerCase()
  let suffix = m[3]
  if (lower && !/^(°|dim|ø|m7b5)/.test(suffix)) suffix = 'm' + suffix
  return parseChord(noteName(root, flats) + suffix)
}

/** Keys that are conventionally written with flats. */
export function prefersFlats(keyRoot: number, minor: boolean): boolean {
  const flatMajor = [5, 10, 3, 8, 1, 6] // F Bb Eb Ab Db Gb
  const major = minor ? pc(keyRoot + 3) : keyRoot
  return flatMajor.includes(pc(major))
}

export interface Progression {
  label: string
  romans: string[]
}

export const PROGRESSIONS: Progression[] = [
  { label: 'Pop  I–V–vi–IV', romans: ['I', 'V', 'vi', 'IV'] },
  { label: '50s  I–vi–IV–V', romans: ['I', 'vi', 'IV', 'V'] },
  { label: '12-bar blues', romans: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'] },
  { label: 'Jazz  ii–V–I', romans: ['ii7', 'V7', 'Imaj7', 'Imaj7'] },
  { label: 'Rock  I–bVII–IV–I', romans: ['I', 'bVII', 'IV', 'I'] },
  { label: 'Minor rock  i–bVII–bVI–bVII', romans: ['i', 'bVII', 'bVI', 'bVII'] },
  { label: 'Andalusian  i–bVII–bVI–V', romans: ['i', 'bVII', 'bVI', 'V'] },
  { label: 'Minor  i–iv–v–i', romans: ['i', 'iv', 'v', 'i'] },
  { label: 'Minor blues  i–iv–i–V', romans: ['i7', 'iv7', 'i7', 'V7'] },
  { label: 'Sad  vi–IV–I–V', romans: ['vi', 'IV', 'I', 'V'] },
  { label: 'Funk vamp  i7–IV7', romans: ['i7', 'IV7'] },
]

export interface FretPos {
  string: number // 0 = low E
  fret: number
  midi: number
}

/** All fretboard positions whose pitch class is in `pcs`, within [minFret, maxFret]. */
export function positionsFor(pcs: number[], minFret: number, maxFret: number, tuning = STANDARD_TUNING): FretPos[] {
  const out: FretPos[] = []
  tuning.forEach((open, s) => {
    for (let f = Math.max(0, minFret); f <= maxFret; f++) {
      if (pcs.includes(pc(open + f))) out.push({ string: s, fret: f, midi: open + f })
    }
  })
  return out
}

/** Picks the fretboard position for a MIDI note closest to a reference fret. */
export function nearestPosition(midi: number, refFret: number, tuning = STANDARD_TUNING, maxFret = 22): FretPos | null {
  let best: FretPos | null = null
  let bestDist = Infinity
  tuning.forEach((open, s) => {
    const f = midi - open
    if (f < 0 || f > maxFret) return
    // Prefer staying near the reference area; tiny bias towards middle strings.
    const d = Math.abs(f - refFret) + (s === 0 || s === 5 ? 0.3 : 0)
    if (d < bestDist) {
      bestDist = d
      best = { string: s, fret: f, midi }
    }
  })
  return best
}
