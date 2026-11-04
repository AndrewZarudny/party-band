// Lessons' chord check: compares a pitch-class profile with the target chord and every major/minor triad.
import { engine } from '../audio/engine'
import { noteName, parseChord, pc } from '../music/theory'

const CHORD_MATCH = 0.72 // minimum cosine similarity to the target
const CHORD_MARGIN = 0.04 // the target may trail the best triad by this much
const MISSING_SHARE = 0.35 // a chord tone below this share of the loudest bin counts as missing

function normalise(v: number[]): number[] {
  const s = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / s)
}

/** Root 1, 3rd 0.85, 5th 0.9, other tones 0.6 (power: root 1, fifth 0.9); L2-normalised. */
export function chordTemplate(pcs: number[], power: boolean): number[] {
  const t = new Array<number>(12).fill(0)
  if (!pcs.length) return t
  const root = pc(pcs[0])
  if (power) {
    t[root] = 1
    t[pc(root + 7)] = 0.9
    return normalise(t)
  }
  for (const p of pcs) {
    const i = pc(p - root)
    const w = i === 0 ? 1 : i === 3 || i === 4 ? 0.85 : i === 6 || i === 7 || i === 8 ? 0.9 : 0.6
    t[pc(p)] = Math.max(t[pc(p)], w)
  }
  return normalise(t)
}

export interface ChordCheck {
  match: number
  rank: number
  best: string
  missing: number[]
  ok: boolean
}

const TRIADS = Array.from({ length: 24 }, (_, i) => {
  const root = i % 12
  const minor = i >= 12
  const pcs = [root, pc(root + (minor ? 3 : 4)), pc(root + 7)]
  return { name: noteName(root) + (minor ? 'm' : ''), key: [...pcs].sort((a, b) => a - b).join(','), tpl: chordTemplate(pcs, false) }
})

const dot = (a: ArrayLike<number>, b: number[]) => {
  let s = 0
  for (let i = 0; i < 12; i++) s += a[i] * b[i]
  return s
}

export function checkChord(avg: Float32Array, symbol: string): ChordCheck {
  const chord = parseChord(symbol)
  if (!chord || !chord.tones.length) return { match: 0, rank: 99, best: '', missing: [], ok: false }
  const v = normalise(Array.from(avg.subarray(0, 12)))
  const power = chord.quality === '5'
  const match = dot(v, chordTemplate(chord.tones, power))
  const key = [...new Set(chord.tones.map(pc))].sort((a, b) => a - b).join(',')
  let rank = 1
  let best = chord.symbol
  let bestScore = match
  for (const tr of TRIADS) {
    if (tr.key === key) continue // the target itself
    const s = dot(v, tr.tpl)
    if (s > match) rank++
    if (s > bestScore) {
      bestScore = s
      best = tr.name
    }
  }
  const max = Math.max(...v)
  const missing = [...new Set(chord.tones.map(pc))].filter((p) => v[p] < MISSING_SHARE * max)
  const ok = match >= CHORD_MATCH && (rank <= 2 || match >= bestScore - CHORD_MARGIN)
  return { match, rank, best, missing, ok }
}

/** engine.chroma behind a guard: false when unavailable (old HMR instance, no input, too quiet). */
export function readChroma(out: Float32Array): boolean {
  return typeof engine.chroma === 'function' && engine.chroma(out)
}
