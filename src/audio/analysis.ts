// Analysing the user's own recording: chords per beat, where bars start, and where sections change.
// Everything runs locally in the browser.
import type { BeatGrid } from './recording'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** In-place radix-2 FFT (length must be a power of two). */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

export interface BeatFeatures {
  times: number[] // beat start times (s)
  chroma: Float32Array[] // 12 bins per beat, L2-normalised
  energy: number[] // log energy per beat
  brightness: number[] // spectral centroid per beat (Hz)
}

/** Note content (chroma), loudness and brightness for every beat of the recording. */
export function beatFeatures(buf: AudioBuffer, grid: BeatGrid): BeatFeatures {
  const sr = buf.sampleRate
  const N = 8192
  const spb = 60 / grid.bpm
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
  const mono = new Float32Array(buf.length)
  for (const ch of chans) for (let i = 0; i < buf.length; i++) mono[i] += ch[i] / chans.length
  const hann = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)))
  // Which pitch class each FFT bin belongs to (60 Hz – 2.1 kHz: where chords live).
  const binPc = new Int8Array(N / 2).fill(-1)
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N
    if (f < 60 || f > 2100) continue
    binPc[k] = (((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12) as number
  }
  let first = grid.firstBeat % spb
  if (first < 0) first += spb
  const times: number[] = []
  for (let t = first; t + spb <= buf.length / sr; t += spb) times.push(t)

  const re = new Float32Array(N)
  const im = new Float32Array(N)
  const chroma: Float32Array[] = []
  const energy: number[] = []
  const brightness: number[] = []
  for (const t of times) {
    const c = new Float32Array(12)
    let e = 0
    let num = 0
    let den = 0
    // Average up to 3 windows inside the beat.
    for (const frac of [0.15, 0.5, 0.85]) {
      const start = Math.floor((t + frac * spb) * sr - N / 2)
      for (let i = 0; i < N; i++) {
        re[i] = (mono[start + i] ?? 0) * hann[i]
        im[i] = 0
      }
      fft(re, im)
      for (let k = 1; k < N / 2; k++) {
        const m = Math.hypot(re[k], im[k])
        e += m * m
        num += m * k
        den += m
        if (binPc[k] >= 0) c[binPc[k]] += Math.log1p(m)
      }
    }
    const norm = Math.hypot(...c) || 1
    for (let i = 0; i < 12; i++) c[i] /= norm
    chroma.push(c)
    energy.push(Math.log10(e + 1e-9))
    brightness.push(den ? ((num / den) * sr) / N : 0)
  }
  return { times, chroma, energy, brightness }
}

/** Chord per beat: best-matching major/minor triad (or no chord), smoothed with a Viterbi pass. */
export function detectChords(f: BeatFeatures): string[] {
  const labels: string[] = []
  const templates: { name: string; v: number[] }[] = []
  for (let r = 0; r < 12; r++) {
    for (const [suffix, third] of [
      ['', 4],
      ['m', 3],
    ] as const) {
      const v = new Array(12).fill(0)
      v[r] = 1
      v[(r + third) % 12] = 0.85
      v[(r + 7) % 12] = 0.9
      const n = Math.hypot(...v)
      templates.push({ name: NAMES[r] + suffix, v: v.map((x) => x / n) })
    }
  }
  const S = templates.length + 1 // + "N" (no chord)
  const T = f.chroma.length
  if (!T) return labels
  const sortedE = [...f.energy].sort((a, b) => a - b)
  const quiet = sortedE[Math.floor(sortedE.length * 0.5)] - 1.5 // well below the typical level
  const emit = (t: number, s: number) => {
    if (s === S - 1) return f.energy[t] < quiet ? 0 : -6
    let d = 0
    for (let i = 0; i < 12; i++) d += f.chroma[t][i] * templates[s].v[i]
    return f.energy[t] < quiet ? -6 : 14 * d
  }
  const stay = Math.log(0.9)
  const move = Math.log(0.1 / (S - 1))
  let score = new Float64Array(S).map((_, s) => emit(0, s))
  const back: Int16Array[] = []
  for (let t = 1; t < T; t++) {
    let best = 0
    for (let s = 1; s < S; s++) if (score[s] > score[best]) best = s
    const next = new Float64Array(S)
    const bp = new Int16Array(S)
    for (let s = 0; s < S; s++) {
      const fromSelf = score[s] + stay
      const fromBest = score[best] + move
      if (fromSelf >= fromBest) {
        next[s] = fromSelf
        bp[s] = s
      } else {
        next[s] = fromBest
        bp[s] = best
      }
      next[s] += emit(t, s)
    }
    back.push(bp)
    score = next
  }
  let s = 0
  for (let i = 1; i < S; i++) if (score[i] > score[s]) s = i
  const path = new Array<number>(T)
  path[T - 1] = s
  for (let t = T - 1; t > 0; t--) path[t - 1] = back[t - 1][path[t]]
  for (const p of path) labels.push(p === S - 1 ? 'N' : templates[p].name)
  return labels
}

/** Which beat (0–3) starts the bar: the one where chords change most often. */
export function downbeatPhase(labels: string[]): number {
  const hits = [0, 0, 0, 0]
  for (let t = 1; t < labels.length; t++) if (labels[t] !== labels[t - 1] && labels[t] !== 'N') hits[t % 4]++
  return hits.indexOf(Math.max(...hits))
}

export interface Bars {
  startBeat: number // beat index of the song's first bar (in BeatFeatures.times)
  chords: string[] // per bar: "Em" or "C|G" (two chords, two beats each)
  novelty: number[] // 0–1: how much the music changes at the start of each bar
}

/** Bar chords from the song's first bar, and where the music changes character (section boundaries). */
export function barsFrom(f: BeatFeatures, labels: string[], phase: number): Bars {
  // The song starts at the first bar that has chords in it.
  let firstBeat = labels.findIndex((l) => l !== 'N')
  if (firstBeat < 0) firstBeat = 0
  let start = firstBeat - ((((firstBeat - phase) % 4) + 4) % 4)
  if (start < 0) start += 4
  let end = labels.length
  while (end > start && labels[end - 1] === 'N') end--
  const chords: string[] = []
  const feats: number[][] = []
  for (let b = start; b + 4 <= end + 3 && b < labels.length; b += 4) {
    const beats = labels.slice(b, b + 4)
    const pick = (xs: string[]) => {
      const counts = new Map<string, number>()
      for (const x of xs) if (x !== 'N') counts.set(x, (counts.get(x) ?? 0) + 1)
      return [...counts.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? 'N'
    }
    const a = pick(beats.slice(0, 2))
    const c = pick(beats.slice(2, 4))
    const whole = pick(beats)
    chords.push(a !== c && a !== 'N' && c !== 'N' ? `${a}|${c}` : whole)
    // Bar features for section boundaries: note content + loudness + brightness.
    const v = new Array(14).fill(0)
    for (let t = b; t < b + 4 && t < f.chroma.length; t++) {
      for (let i = 0; i < 12; i++) v[i] += f.chroma[t][i] / 4
      v[12] += f.energy[t] / 4
      v[13] += f.brightness[t] / 4
    }
    feats.push(v)
  }
  // Standardise loudness/brightness so they weigh like the note content.
  for (const k of [12, 13]) {
    const xs = feats.map((v) => v[k])
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1
    for (const v of feats) v[k] = ((v[k] - mean) / sd) * 0.6
  }
  // Novelty: how different the 4 bars after each point are from the 4 bars before it.
  const W = 4
  const sim = (i: number, j: number) => {
    let d = 0
    let na = 0
    let nb = 0
    for (let k = 0; k < 14; k++) {
      d += feats[i][k] * feats[j][k]
      na += feats[i][k] ** 2
      nb += feats[j][k] ** 2
    }
    return d / (Math.sqrt(na * nb) || 1)
  }
  const novelty = feats.map((_, b) => {
    let within = 0
    let across = 0
    let n = 0
    for (let i = Math.max(0, b - W); i < b; i++)
      for (let j = b; j < Math.min(feats.length, b + W); j++) {
        across += sim(i, j)
        n++
      }
    let m = 0
    for (let i = Math.max(0, b - W); i < b; i++)
      for (let j = Math.max(0, b - W); j < b; j++) {
        within += sim(i, j)
        m++
      }
    for (let i = b; i < Math.min(feats.length, b + W); i++)
      for (let j = b; j < Math.min(feats.length, b + W); j++) {
        within += sim(i, j)
        m++
      }
    return n && m ? Math.max(0, within / m - across / n) : 0
  })
  const top = Math.max(...novelty, 1e-9)
  return { startBeat: start, chords, novelty: novelty.map((x) => x / top) }
}
