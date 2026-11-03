// Guitar tunings, the tuning the open song needs, and re-fingering tabs into another tuning.
import { midiName, noteName } from './theory'

export interface TuningDef {
  id: string
  name: string
  notes: number[] // MIDI, low string → high string
}

export const TUNINGS: TuningDef[] = [
  { id: 'standard', name: 'Standard', notes: [40, 45, 50, 55, 59, 64] },
  { id: 'dropD', name: 'Drop D', notes: [38, 45, 50, 55, 59, 64] },
  { id: 'eb', name: 'E♭ standard (½ step down)', notes: [39, 44, 49, 54, 58, 63] },
  { id: 'dropDb', name: 'Drop D♭', notes: [37, 44, 49, 54, 58, 63] },
  { id: 'd', name: 'D standard (whole step down)', notes: [38, 43, 48, 53, 57, 62] },
  { id: 'dropC', name: 'Drop C', notes: [36, 43, 48, 53, 57, 62] },
  { id: 'c', name: 'C standard', notes: [36, 41, 46, 51, 55, 60] },
  { id: 'dropB', name: 'Drop B', notes: [35, 42, 47, 52, 56, 61] },
  { id: 'openG', name: 'Open G', notes: [38, 43, 50, 55, 59, 62] },
  { id: 'openD', name: 'Open D', notes: [38, 45, 50, 54, 57, 62] },
  { id: 'openE', name: 'Open E', notes: [40, 47, 52, 56, 59, 64] },
  { id: 'dadgad', name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62] },
]

export const tuningLabel = (notes: number[]) => notes.map((n) => noteName(n, true)).join(' ')
export const tuningFullLabel = (notes: number[]) => notes.map(midiName).join(' ')

/** Preset name for a tuning, or its notes if it isn't a known preset. */
export function describeTuning(notes: number[]): string {
  const t = TUNINGS.find((x) => x.notes.length === notes.length && x.notes.every((n, i) => n === notes[i]))
  return t ? t.name : tuningLabel(notes)
}

// ---- The tuning the open song needs (shared between Song mode and the tuner) ---

export interface SongTuning {
  song: string
  notes: number[]
}

let songTuning: SongTuning | null = null
const listeners = new Set<() => void>()

export function setSongTuning(t: SongTuning | null) {
  songTuning = t
  listeners.forEach((l) => l())
}
export const getSongTuning = () => songTuning
export function onSongTuning(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

// ---- Re-fingering ----------------------------------------------------------

/** Minimal views of alphaTab's model, so this stays testable without the library. */
export interface NoteLike {
  string: number // 1 = lowest string
  fret: number
  readonly realValue: number
  isTieDestination: boolean
  tieOrigin: NoteLike | null
  isDead: boolean
}
export interface BeatLike {
  notes: NoteLike[]
  removeNote(n: NoteLike): void
}

export interface ConvertResult {
  octaveShifted: number // notes moved up/down an octave to fit
  dropped: number // doubled notes removed so a chord fits on six strings
  notes: number
}

const MAX_FRET = 22

type Place = { string: number; fret: number }

/** Lowest-cost distinct-string placement for a chord, or null if it can't be fingered. */
function place(pitches: number[], to: number[], hand: number): Place[] | null {
  const options = pitches.map((p) => to.map((open, i) => ({ string: i + 1, fret: p - open })).filter((o) => o.fret >= 0 && o.fret <= MAX_FRET))
  let best: Place[] | null = null
  let bestCost = Infinity
  const pick: Place[] = []
  const used = new Set<number>()
  const search = (k: number) => {
    if (k === options.length) {
      const fretted = pick.filter((o) => o.fret > 0).map((o) => o.fret)
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0
      let cost = span > 4 ? 100 + span * 10 : span
      for (const o of pick) cost += o.fret === 0 ? 0.5 : Math.abs(o.fret - hand) * 0.8 + (o.fret > 15 ? 2 : 0)
      if (cost < bestCost) {
        bestCost = cost
        best = pick.slice()
      }
      return
    }
    for (const o of options[k]) {
      if (used.has(o.string)) continue
      used.add(o.string)
      pick.push(o)
      search(k + 1)
      pick.pop()
      used.delete(o.string)
    }
  }
  search(0)
  return best
}

/**
 * Re-fingers beats for `to` (low → high) so every note keeps its pitch.
 * `pitchOf` gives the sounding MIDI note before the tuning change. Notes out of range move
 * an octave; if that doubles a note already in the chord, the copy is removed. Chords get
 * distinct strings and the hand position drifts smoothly so passages stay in one area.
 */
export function refinger(beats: BeatLike[], pitchOf: (n: NoteLike) => number, to: number[]): ConvertResult {
  const lowest = to[0]
  const highest = to[to.length - 1] + MAX_FRET
  let hand = 5
  let shifted = 0
  let dropped = 0
  let count = 0
  const assigned = new Map<NoteLike, Place>()

  for (const beat of beats) {
    let fresh: { note: NoteLike; pitch: number; moved: boolean }[] = []
    for (const n of [...beat.notes]) {
      if (n.isTieDestination && n.tieOrigin && assigned.has(n.tieOrigin)) {
        const a = assigned.get(n.tieOrigin)!
        assigned.set(n, a)
        n.string = a.string
        n.fret = a.fret
        continue
      }
      let p = pitchOf(n)
      let moved = false
      while (p < lowest) {
        p += 12
        moved = true
      }
      while (p > highest) {
        p -= 12
        moved = true
      }
      // An octave-moved note that now doubles another chord note adds nothing: drop it.
      if (fresh.some((f) => f.pitch === p)) {
        beat.removeNote(n)
        dropped++
        continue
      }
      if (moved) shifted++
      fresh.push({ note: n, pitch: p, moved })
    }
    if (!fresh.length) continue

    let result = place(
      fresh.map((f) => f.pitch),
      to,
      hand,
    )
    // Still unplayable: drop moved notes first, then the lowest, until the chord fits.
    while (!result && fresh.length > 1) {
      const victim = fresh.find((f) => f.moved) ?? fresh.reduce((a, b) => (b.pitch < a.pitch ? b : a))
      beat.removeNote(victim.note)
      dropped++
      fresh = fresh.filter((f) => f !== victim)
      result = place(
        fresh.map((f) => f.pitch),
        to,
        hand,
      )
    }
    if (!result) continue
    count += fresh.length
    result.forEach((r, i) => {
      const n = fresh[i].note
      n.string = r.string
      n.fret = r.fret
      assigned.set(n, r)
    })
    const fretted = result.filter((r) => r.fret > 0)
    if (fretted.length) hand = hand * 0.5 + (fretted.reduce((s, r) => s + r.fret, 0) / fretted.length) * 0.5
  }
  return { octaveShifted: shifted, dropped, notes: count }
}

/** True when every string moves by the same amount (e.g. E♭ standard → standard). */
export function isUniformShift(from: number[], to: number[]) {
  return from.length === to.length && from.every((n, i) => to[i] - n === to[0] - from[0])
}
