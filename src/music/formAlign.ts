// Fitting a song's form (Intro, Verse, Chorus… from the setup) onto the bars of the user's recording.
import type { SongSetup } from './songForm'
import { sectionBars } from './songForm'
import { parseChord } from './theory'

/** Root + major/minor of a chord symbol ("D/F#" → D major, "F#m7" → F# minor); null if unknown. */
function quality(sym: string): { root: number; minor: boolean | null } | null {
  const c = parseChord(sym.split('/')[0])
  if (!c) return null
  const q = c.quality
  // Power chords and sus chords have no third: they fit either.
  const minor = /^(5|sus.*|7sus4)$/.test(q) ? null : /^(m(?!aj)|min|-|dim|°|ø|m7b5)/.test(q)
  return { root: c.root, minor }
}

function chordsMatch(a: string, b: string): number {
  if (a === 'N' || b === 'N') return 0.5
  const x = quality(a)
  const y = quality(b)
  if (!x || !y) return 0.5
  if (x.root !== y.root) return 0
  return x.minor === null || y.minor === null || x.minor === y.minor ? 1 : 0.4
}

/** How well a bar of the record ("C" or "C|G") matches a bar of the pattern. */
function barMatch(pattern: string, recorded: string): number {
  const p = pattern.split('|')
  const r = recorded.split('|')
  if (p.length === 1 && r.length === 1) return chordsMatch(p[0], r[0])
  const ph = p.length === 1 ? [p[0], p[0]] : p
  const rh = r.length === 1 ? [r[0], r[0]] : r
  return (chordsMatch(ph[0], rh[0]) + chordsMatch(ph[1], rh[1])) / 2
}

/** A section's chord pattern as bars ("C", or "C|G" when two chords share a bar). */
export function patternBars(chords: { chord: string; beats: number }[]): string[] {
  const bars: string[] = []
  let cur: string[] = []
  let filled = 0
  for (const c of chords) {
    let left = c.beats
    while (left > 0) {
      const take = Math.min(left, 4 - filled)
      if (!cur.length || cur[cur.length - 1] !== c.chord) cur.push(c.chord)
      filled += take
      left -= take
      if (filled === 4) {
        bars.push(cur.slice(0, 2).join('|'))
        cur = []
        filled = 0
      }
    }
  }
  if (filled) bars.push(cur.slice(0, 2).join('|'))
  return bars.length ? bars : ['N']
}

export interface FormFit {
  bars: number[] // length in bars of each form entry
  agreement: number // 0–1: how well the setup's chords match the record, bar by bar
}

/**
 * Splits the record's bars into the song's form in order, scoring each section by how well its
 * chords match, whether it starts where the music changes, and how sensible its length is.
 */
export function fitForm(song: SongSetup, recorded: string[], novelty: number[]): FormFit | null {
  const entries = song.form
    .map((name) => song.sections.find((s) => s.name === name))
    .filter((s): s is NonNullable<typeof s> => !!s)
  const F = entries.length
  const B = recorded.length
  if (!F || B < F) return null
  const pats = entries.map((s) => patternBars(s.chords))
  const expect = entries.map((s) => Math.max(1, sectionBars(s)))
  const MAXLEN = Math.min(64, B)

  // Mismatched bars for entry f starting at bar b, for every length up to MAXLEN (prefix sums).
  const miss = (f: number, b: number) => {
    const out = new Float32Array(MAXLEN + 1)
    for (let L = 1; L <= MAXLEN && b + L <= B; L++) out[L] = out[L - 1] + (1 - barMatch(pats[f][(L - 1) % pats[f].length], recorded[b + L - 1]))
    return out
  }
  const INF = 1e9
  const dp = Array.from({ length: F + 1 }, () => new Float64Array(B + 1).fill(INF))
  const from = Array.from({ length: F + 1 }, () => new Int16Array(B + 1).fill(-1))
  dp[0][0] = 0
  for (let f = 0; f < F; f++) {
    const p = pats[f].length
    for (let b = 0; b < B; b++) {
      if (dp[f][b] >= INF) continue
      const m = miss(f, b)
      // Sections start where the music changes: reward a clear change, and charge for starting a
      // new section where nothing audibly changes.
      const boundary = b === 0 ? 0 : 4 * (0.4 - (novelty[b] ?? 0))
      for (let L = 1; L <= MAXLEN && b + L <= B; L++) {
        // The set-up's lengths are only a rough guide (that's why we measure), so they weigh little.
        const lengthCost = 0.5 * Math.abs(Math.log2(L / expect[f])) + (L % p === 0 ? 0 : 1.5) + (L % 2 === 0 ? 0 : 0.5)
        const c = dp[f][b] + m[L] + lengthCost + boundary
        if (c < dp[f + 1][b + L]) {
          dp[f + 1][b + L] = c
          from[f + 1][b + L] = b
        }
      }
    }
  }
  // The form may end a few bars before the record does (a fade-out or a last held chord),
  // but leaving bars that still have chords in them unplayed costs as much as a wrong bar.
  const leftover = (e: number) => recorded.slice(e).filter((c) => c !== 'N').length * 1.5
  let end = B
  for (let e = Math.max(F, B - 8); e <= B; e++) if (dp[F][e] + leftover(e) < dp[F][end] + leftover(end)) end = e
  if (dp[F][end] >= INF) return null
  const bars = new Array<number>(F)
  for (let f = F, e = end; f > 0; f--) {
    const s = from[f][e]
    bars[f - 1] = e - s
    e = s
  }
  // Agreement: the setup's chords against the record's, over the fitted form.
  let ok = 0
  let n = 0
  let b = 0
  bars.forEach((L, f) => {
    for (let j = 0; j < L; j++) {
      ok += barMatch(pats[f][j % pats[f].length], recorded[b + j] ?? 'N')
      n++
    }
    b += L
  })
  return { bars, agreement: n ? ok / n : 0 }
}
