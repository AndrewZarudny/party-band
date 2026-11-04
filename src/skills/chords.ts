// One-minute chord changes: the chords on offer and the clean-change check after each strum.
import { checkChord, readChroma } from '../lessons/chroma'

/** The shapes the lessons teach. */
export const CHANGE_CHORDS = ['E', 'A', 'D', 'G', 'C', 'Am', 'Em', 'E5', 'A5', 'G5']

export const pairKey = (a: string, b: string) => [a, b].sort().join('-')

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
