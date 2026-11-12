// Backing tracks for jams: the player can swap the band's groove and chords for another, three genres of three.
// A track only changes what the band plays. The lesson stays the same lesson: same notes, tempo, length, scoring and XP.
import type { FeelId, Lesson } from './types'

export type GenreId = 'rock' | 'blues' | 'groove'

export interface JamTrack {
  id: string
  genre: GenreId
  name: string
  about: string
  feel: FeelId
  /** One chord a bar, written in A; moved to the jam's own key when used. */
  chords: string[]
  /** Fits a jam on a major scale too (no minor chord on the home note). */
  major: boolean
}

export const GENRES: { id: GenreId; label: string }[] = [
  { id: 'rock', label: 'Rock' },
  { id: 'blues', label: 'Blues' },
  { id: 'groove', label: 'Groove' },
]

const TWELVE = ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7']

export const JAM_TRACKS: JamTrack[] = [
  { id: 'rock-anthem', genre: 'rock', name: 'Anthem', about: 'Four big chords, straight 8ths.', feel: 'pop', chords: ['Am', 'F', 'C', 'G'], major: false },
  { id: 'rock-riff', genre: 'rock', name: 'Riff rock', about: 'Power chords, two bars each.', feel: 'pop', chords: ['A5', 'A5', 'D5', 'D5', 'E5', 'E5', 'A5', 'A5'], major: true },
  { id: 'rock-ballad', genre: 'rock', name: 'Power ballad', about: 'Slow-burning and open, room for long notes.', feel: 'ballad', chords: ['Am', 'G', 'F', 'G'], major: false },
  { id: 'blues-shuffle', genre: 'blues', name: 'Shuffle', about: 'The 12-bar blues, swung.', feel: 'blues', chords: TWELVE, major: true },
  { id: 'blues-slow', genre: 'blues', name: 'Slow blues', about: 'The 12-bar blues in a slow 12/8.', feel: 'slowblues', chords: TWELVE, major: true },
  { id: 'blues-minor', genre: 'blues', name: 'Minor blues', about: 'A darker 12 bars.', feel: 'minorblues', chords: ['Am7', 'Am7', 'Am7', 'Am7', 'Dm7', 'Dm7', 'Am7', 'Am7', 'F7', 'E7', 'Am7', 'E7'], major: false },
  { id: 'groove-funk', genre: 'groove', name: 'Funk vamp', about: 'Two chords and a tight 16th groove.', feel: 'funk', chords: ['Am7', 'Am7', 'D7', 'D7'], major: false },
  { id: 'groove-reggae', genre: 'groove', name: 'Reggae', about: 'Laid back, chords on the off-beat.', feel: 'reggae', chords: ['Am', 'Am', 'Dm', 'Em'], major: false },
  { id: 'groove-funkblues', genre: 'groove', name: 'Funky blues', about: 'Blues chords over a funk beat.', feel: 'funk', chords: ['A7', 'A7', 'D7', 'A7'], major: true },
]

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const PCS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** A chord symbol moved up by `semis` semitones ("Am7" by 7 is "Em7"). Anything it can't read comes back unchanged. */
export function transposeChord(symbol: string, semis: number): string {
  const m = /^([A-G])([#b]?)(.*)$/.exec(symbol)
  if (!m) return symbol
  const from = PCS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
  return NAMES[(((from + semis) % 12) + 12) % 12] + m[3]
}

const MAJOR_SCALES = new Set(['majorPent', 'major', 'mixolydian'])

/** The tracks this jam can use: none for a lesson that is not a jam with a band. */
export function tracksFor(lesson: Lesson): JamTrack[] {
  if (lesson.type !== 'improv' || !lesson.improv || !lesson.backing) return []
  const major = !!lesson.improv.scale && MAJOR_SCALES.has(lesson.improv.scale)
  return JAM_TRACKS.filter((t) => !major || t.major)
}

/** The lesson with the band playing the chosen track, in the jam's own key. No track (or one that doesn't fit): the lesson as it is. */
export function withTrack(lesson: Lesson, trackId: string | null | undefined): Lesson {
  if (!trackId) return lesson
  const track = tracksFor(lesson).find((t) => t.id === trackId)
  if (!track || !lesson.improv || !lesson.backing) return lesson
  const shift = lesson.improv.key - 9
  // the lesson's own band level and parts stay
  return { ...lesson, backing: { ...lesson.backing, feel: track.feel, chords: track.chords.map((c) => transposeChord(c, shift)) } }
}

/** The track's chords in the jam's key, repeats folded ("A7 ×4"), for showing. */
export function trackChords(lesson: Lesson, track: JamTrack): string {
  const shift = (lesson.improv?.key ?? 9) - 9
  const out: { c: string; n: number }[] = []
  for (const raw of track.chords) {
    const c = transposeChord(raw, shift)
    const last = out[out.length - 1]
    if (last && last.c === c) last.n++
    else out.push({ c, n: 1 })
  }
  return out.map((x) => (x.n > 1 ? `${x.c} ×${x.n}` : x.c)).join(' · ')
}
