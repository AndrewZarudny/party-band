// Fretboard note games: which spots to find, which spot to name, and when to widen the frets.
import type { FretPos } from '../music/theory'
import { STANDARD_TUNING, pc, positionsFor } from '../music/theory'
import { FRET_STEPS } from './data'

export const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high E']
const NATURALS = [9, 4, 2, 7, 0, 11, 5] // A first, then E D G C B F

/** The notes a Find round asks for: A first, then the other natural notes in a shuffled order. */
export function findOrder(rand = Math.random): number[] {
  const rest = NATURALS.slice(1)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [NATURALS[0], ...rest]
}

/** Every spot of a note within the frets, low string first. */
export function spotsOf(notePc: number, maxFret: number): FretPos[] {
  return positionsFor([pc(notePc)], 0, maxFret).sort((a, b) => a.string - b.string || a.fret - b.fret)
}

/** A random spot to name; natural notes only while the range is the first five frets. */
export function randomSpot(maxFret: number, prev: FretPos | null, rand = Math.random): FretPos {
  for (;;) {
    const string = Math.floor(rand() * 6)
    const fret = Math.floor(rand() * (maxFret + 1))
    const midi = STANDARD_TUNING[string] + fret
    if (prev && prev.string === string && prev.fret === fret) continue
    if (maxFret <= 5 && !NATURALS.includes(pc(midi))) continue
    return { string, fret, midi }
  }
}

/** The fret range after a Name round: one step wider at 85% right over 10 or more spots. */
export function widenAfter(fretMax: number, right: number, tries: number): number {
  if (tries < 10 || right / tries < 0.85) return fretMax
  const i = FRET_STEPS.indexOf(fretMax)
  return FRET_STEPS[Math.min(FRET_STEPS.length - 1, i + 1)] ?? fretMax
}
