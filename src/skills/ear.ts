// Ear training: short phrases on the open strings, then in the A minor pentatonic box at the 5th fret.
import type { FretPos } from '../music/theory'
import { STANDARD_TUNING, pc } from '../music/theory'

export const OPEN: FretPos[] = STANDARD_TUNING.map((m, s) => ({ string: s, fret: 0, midi: m }))

// A minor pentatonic, box 1 (frets 5–8), low to high.
export const BOX1: FretPos[] = [
  [0, 5], [0, 8], [1, 5], [1, 7], [2, 5], [2, 7], [3, 5], [3, 7], [4, 5], [4, 8], [5, 5], [5, 8],
].map(([s, f]) => ({ string: s, fret: f, midi: STANDARD_TUNING[s] + f }))

export const MIN_LEN = 2
export const MAX_LEN = 6

/** Two-note phrases use the open strings; longer ones the pentatonic box. */
export const poolFor = (len: number) => (len <= 2 ? OPEN : BOX1)

/** A phrase that moves by small steps through the pool, so it sounds like a lick rather than random notes. */
export function makePhrase(len: number, rand = Math.random): FretPos[] {
  const pool = poolFor(len)
  const out: FretPos[] = []
  let i = Math.floor(rand() * Math.max(1, pool.length - 3))
  for (let n = 0; n < len; n++) {
    out.push(pool[i])
    let step = 0
    while (step === 0) step = Math.floor(rand() * 5) - 2 // -2..2, never the same note twice
    i = Math.max(0, Math.min(pool.length - 1, i + step))
    if (pool[i] === out[out.length - 1]) i = i > 0 ? i - 1 : i + 1
  }
  return out
}

export type Mark = 'ok' | 'octave' | 'miss'

export interface Grade {
  marks: Mark[] // per note of the phrase
  pass: boolean
  orderOnly: boolean // the right notes, in the wrong order
}

export function gradePhrase(target: number[], played: number[]): Grade {
  const marks: Mark[] = target.map((m, i) => (played[i] === m ? 'ok' : played[i] !== undefined && pc(played[i]) === pc(m) ? 'octave' : 'miss'))
  const pass = marks.every((m) => m === 'ok') && played.length >= target.length
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b).join(',')
  const orderOnly = !pass && played.length === target.length && sorted(played) === sorted(target)
  return { marks, pass, orderOnly }
}

/** Phrase length after a result: two passes in a row → one longer, two misses in a row → one shorter. */
export function nextLength(len: number, streak: number): { len: number; streak: number } {
  if (streak >= 2) return { len: Math.min(MAX_LEN, len + 1), streak: 0 }
  if (streak <= -2) return { len: Math.max(MIN_LEN, len - 1), streak: 0 }
  return { len, streak }
}
