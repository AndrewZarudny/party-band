// Guessing a song's key from the chords heard in it (bar chords from Analyse: "Em" or "C|G").
import { parseChord, pc } from './theory'

// Krumhansl–Kessler key profiles: how well each scale degree fits a major or minor key.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
// The chords that belong to each key: [degree, minor?]. Minor keys also take the major V (harmonic minor).
const DIATONIC_MAJOR: [number, boolean][] = [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true]]
const DIATONIC_MINOR: [number, boolean][] = [[0, true], [3, false], [5, true], [7, true], [7, false], [8, false], [10, false]]

export interface KeyGuess {
  root: number // pitch class of the tonic
  minor: boolean
  confidence: number // 0–1: how clearly this key beats the next best
  runnerUp: { root: number; minor: boolean } | null
}

function correlation(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / 12
  const mb = b.reduce((s, x) => s + x, 0) / 12
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

/**
 * The key that best explains the chords: their notes against each key's profile, how much of the
 * time the chords belong to the key, and how much of it sits on the key's own tonic chord
 * (including the first and last chord), which is what separates a major key from its relative minor.
 */
export function keyFromChords(bars: string[], notes?: number[]): KeyGuess | null {
  // minor: null for chords without a third (power chords, sus), which fit a major or a minor key.
  const heard: { root: number; minor: boolean | null; tones: number[]; w: number }[] = []
  for (const bar of bars) {
    const parts = bar.split('|').filter((x) => x !== 'N')
    for (const sym of parts) {
      const c = parseChord(sym)
      if (c) heard.push({ root: c.root, minor: /^(5|sus)/.test(c.quality) ? null : /^m(?!aj)/.test(c.quality), tones: c.tones, w: 1 / parts.length })
    }
  }
  const total = heard.reduce((s, c) => s + c.w, 0)
  if (total < 2) return null
  // The notes played (from a tab: every part, melody included), else the chords' notes.
  const profile = notes ?? new Array(12).fill(0)
  if (!notes) for (const c of heard) c.tones.forEach((t, i) => (profile[t] += c.w * (i === 0 ? 1 : 0.8)))

  const first = heard[0]
  const last = heard[heard.length - 1]
  const scored: { root: number; minor: boolean; score: number }[] = []
  for (let root = 0; root < 12; root++)
    for (const minor of [false, true]) {
      const shape = (minor ? MINOR : MAJOR).map((_, i) => (minor ? MINOR : MAJOR)[pc(i - root)])
      const diatonic = minor ? DIATONIC_MINOR : DIATONIC_MAJOR
      const fits = (c: (typeof heard)[number]) => diatonic.some(([d, m]) => pc(root + d) === c.root && (c.minor === null || m === c.minor))
      const isTonic = (c: (typeof heard)[number]) => c.root === root && (c.minor === null || c.minor === minor)
      const inKey = heard.reduce((s, c) => s + (fits(c) ? c.w : 0), 0) / total
      const onTonic = heard.reduce((s, c) => s + (isTonic(c) ? c.w : 0), 0) / total
      const score = correlation(profile, shape) + 0.8 * inKey + 0.8 * onTonic + (isTonic(first) ? 0.15 : 0) + (isTonic(last) ? 0.2 : 0)
      scored.push({ root, minor, score })
    }
  scored.sort((a, b) => b.score - a.score)
  const [best, second] = scored
  return {
    root: best.root,
    minor: best.minor,
    confidence: Math.max(0, Math.min(1, (best.score - second.score) / 0.4)),
    runnerUp: second ? { root: second.root, minor: second.minor } : null,
  }
}
