// Generates short improvisation phrases inside a fretboard position box.
import type { FretPos } from './theory'
import { pc, positionsFor } from './theory'

/** One playable position per pitch inside the box, sorted low → high. */
export function boxNotes(scalePcs: number[], extraPcs: number[], from: number): FretPos[] {
  const lo = Math.max(0, from)
  const hi = lo + (lo === 0 ? 4 : 4)
  const all = positionsFor([...new Set([...scalePcs, ...extraPcs])], lo, hi)
  const byMidi = new Map<number, FretPos>()
  for (const p of all) {
    const prev = byMidi.get(p.midi)
    // Same pitch on two strings: keep the one on the higher string (smaller stretch).
    if (!prev || p.string > prev.string) byMidi.set(p.midi, p)
  }
  return [...byMidi.values()].sort((a, b) => a.midi - b.midi)
}

/**
 * Stepwise melodic line: starts on a chord tone, moves mostly by scale steps with
 * occasional skips, and lands on a chord tone of `target` (current or next chord).
 */
export function makePhrase(box: FretPos[], scalePcs: number[], chordPcs: number[], targetPcs: number[], length: number, rand = Math.random): FretPos[] {
  const inScale = box.filter((p) => scalePcs.includes(pc(p.midi)) || chordPcs.includes(pc(p.midi)))
  if (inScale.length < 3) return inScale
  const chordIdx = inScale.map((p, i) => (chordPcs.includes(pc(p.midi)) ? i : -1)).filter((i) => i >= 0)
  const mid = inScale.length / 2
  // Start on a chord tone in the middle of the box.
  let i = chordIdx.length ? chordIdx.reduce((a, b) => (Math.abs(b - mid) + rand() * 3 < Math.abs(a - mid) + rand() * 3 ? b : a)) : Math.floor(mid)
  const out: FretPos[] = [inScale[i]]
  let dir = rand() < 0.5 ? -1 : 1
  for (let n = 1; n < length - 1; n++) {
    if (rand() < 0.3) dir = -dir
    const step = rand() < 0.75 ? 1 : 2
    let j = i + dir * step
    if (j < 0 || j >= inScale.length) {
      dir = -dir
      j = i + dir * step
    }
    // Avoid lingering on the same pitch.
    if (j === i) j = Math.min(inScale.length - 1, i + 1)
    i = Math.max(0, Math.min(inScale.length - 1, j))
    out.push(inScale[i])
  }
  // Resolve to the nearest target chord tone.
  const targets = inScale.map((p, k) => ({ p, k })).filter(({ p }) => targetPcs.includes(pc(p.midi)))
  if (targets.length) {
    const best = targets.reduce((a, b) => (Math.abs(b.k - i) < Math.abs(a.k - i) || (Math.abs(b.k - i) === Math.abs(a.k - i) && b.k !== i) ? b : a))
    out.push(best.p)
  }
  return out
}
