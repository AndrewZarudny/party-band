// One-minute chord changes: the chords on offer and the clean-change check after each strum.
import { checkChord, readChroma } from '../lessons/chroma'
import type { SkillStats } from './data'
import { RETIRE_AT, bestKey } from './data'

export { RETIRE_AT }

/** The shapes the lessons teach. */
export const CHANGE_CHORDS = ['E', 'A', 'D', 'G', 'C', 'Am', 'Em', 'A7', 'D7', 'E7', 'E5', 'A5', 'D5', 'G5']

export const pairKey = (a: string, b: string) => [a, b].sort().join('-')

/** The blues pairs: A, D and E, in pairKey order. */
export const CORE_PAIRS = ['A-D', 'A-E', 'D-E']

/**
 * The pair to practise next: the lowest best among pairs of known chords that aren't retired yet
 * (a pair never played counts as 0). Ties go to CORE_PAIRS, then CHANGE_CHORDS order. Null under 2 known chords.
 */
export function weakestPair(s: SkillStats, known: string[]): string | null {
  const chords = [...new Set(known)]
  if (chords.length < 2) return null
  const rank = (c: string) => {
    const i = CHANGE_CHORDS.indexOf(c)
    return i < 0 ? CHANGE_CHORDS.length : i
  }
  chords.sort((a, b) => rank(a) - rank(b))
  let pick: string | null = null
  let pickBest = Infinity
  let pickCore = Infinity
  for (let i = 0; i < chords.length; i++)
    for (let j = i + 1; j < chords.length; j++) {
      const k = pairKey(chords[i], chords[j])
      const best = s.best[bestKey('changes', k)] ?? 0
      if (best >= RETIRE_AT) continue
      const ci = CORE_PAIRS.indexOf(k)
      const core = ci < 0 ? CORE_PAIRS.length : ci
      if (best < pickBest || (best === pickBest && core < pickCore)) {
        pick = k
        pickBest = best
        pickCore = core
      }
    }
  return pick
}

const READ_AT_MS = [140, 240] // the strum has settled, the next one hasn't started

/**
 * Listens to the ringing strum a moment after its attack and says which of the two chords it was,
 * or null when it matched neither (muddy, a wrong string, a dead note).
 */
export function judgeStrum(a: string, b: string, done: (chord: string | null) => void): () => void {
  const sum = new Float32Array(12)
  const one = new Float32Array(12)
  let reads = 0
  const timers = READ_AT_MS.map((ms, i) =>
    window.setTimeout(() => {
      if (readChroma(one)) {
        reads++
        for (let k = 0; k < 12; k++) sum[k] += one[k]
      }
      if (i < READ_AT_MS.length - 1) return
      if (!reads) return done(null)
      const ca = checkChord(sum, a)
      const cb = checkChord(sum, b)
      if (ca.ok && (!cb.ok || ca.match >= cb.match)) done(a)
      else if (cb.ok) done(b)
      else done(null)
    }, ms),
  )
  return () => timers.forEach((t) => window.clearTimeout(t))
}

export interface ChangeCount {
  on: string | null // the chord the player is holding now
  changes: number // clean switches to the other chord
  strums: number // clean strums of either chord
  muddy: number
}

export const emptyCount = (): ChangeCount => ({ on: null, changes: 0, strums: 0, muddy: 0 })

/** Adds one judged strum. */
export function countStrum(c: ChangeCount, chord: string | null): ChangeCount {
  if (chord === null) return { ...c, muddy: c.muddy + 1 }
  const changed = c.on !== null && c.on !== chord
  return { on: chord, changes: c.changes + (changed ? 1 : 0), strums: c.strums + 1, muddy: c.muddy }
}
