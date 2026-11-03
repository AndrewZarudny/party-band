// Locking the jam to a recording the user owns: find its tempo and where the first beat falls.

export interface BeatGrid {
  bpm: number
  firstBeat: number // seconds from the start of the file to the first beat
}

/**
 * Onset-based tempo and phase estimate. `hintBpm` (from the song setup) steers the choice between
 * a tempo and its double/half, which the signal alone can't decide.
 */
export function analyzeBeats(buf: AudioBuffer, hintBpm?: number): BeatGrid {
  const sr = buf.sampleRate
  const hop = 512
  const fps = sr / hop
  const n = buf.length
  const frames = Math.floor(n / hop)
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))

  // Energy of the first difference per frame (emphasises attacks), log-compressed.
  const le = new Float32Array(frames)
  let prev = 0
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      let x = 0
      for (const ch of chans) x += ch[i]
      const d = x - prev
      prev = x
      e += d * d
    }
    le[f] = Math.log1p(1000 * e)
  }
  // Onset strength: rises in energy, minus a ~1 s moving average.
  const onset = new Float32Array(frames)
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, le[f] - le[f - 1])
  const win = Math.round(fps)
  let acc = 0
  const avg = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    acc += onset[f]
    if (f >= win) acc -= onset[f - win]
    avg[f] = acc / Math.min(f + 1, win)
  }
  for (let f = 0; f < frames; f++) onset[f] = Math.max(0, onset[f] - avg[f])

  // Tempo: autocorrelation of the onset curve over 50–200 BPM, weighted towards the hint.
  const lagMin = Math.floor((fps * 60) / 200)
  const lagMax = Math.ceil((fps * 60) / 50)
  const prior = hintBpm && hintBpm > 0 ? hintBpm : 110
  const width = hintBpm ? 0.2 : 0.6
  let best = lagMin
  let bestScore = -Infinity
  const ac = new Float32Array(lagMax + 2)
  for (let lag = lagMin; lag <= lagMax + 1; lag++) {
    let s = 0
    for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag]
    ac[lag] = s
  }
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = (60 * fps) / lag
    const w = Math.exp(-(Math.log2(bpm / prior) ** 2) / (2 * width * width))
    const score = ac[lag] * w
    if (score > bestScore) {
      bestScore = score
      best = lag
    }
  }
  // Sub-frame refinement of the period.
  const a = ac[best - 1] ?? 0
  const b = ac[best]
  const c = ac[best + 1] ?? 0
  const shift = a - 2 * b + c !== 0 ? (a - c) / (2 * (a - 2 * b + c)) : 0
  const period = best + Math.max(-0.5, Math.min(0.5, shift))

  // Phase: the offset whose beat grid lines up with the most onset energy.
  let bestPhase = 0
  let bestSum = -Infinity
  for (let p = 0; p < period; p += 0.25) {
    let s = 0
    for (let t = p; t < frames; t += period) s += onset[Math.round(t)] ?? 0
    if (s > bestSum) {
      bestSum = s
      bestPhase = p
    }
  }
  // Refine across the whole song: find the real hit near each predicted beat and fit a straight
  // line through them. A small tempo error adds up to beats of drift over a 4-minute song.
  let p0 = bestPhase
  let per = period
  const strong = onset.reduce((m, v) => Math.max(m, v), 0) * 0.1
  for (let pass = 0; pass < 2; pass++) {
    let n = 0
    let sk = 0
    let st = 0
    let skk = 0
    let skt = 0
    const reach = per * 0.15
    for (let k = 0; p0 + k * per < frames; k++) {
      const c = p0 + k * per
      let bestF = -1
      let bestV = strong
      for (let f = Math.max(0, Math.floor(c - reach)); f <= Math.min(frames - 1, Math.ceil(c + reach)); f++) {
        if (onset[f] > bestV) {
          bestV = onset[f]
          bestF = f
        }
      }
      if (bestF < 0) continue
      n++
      sk += k
      st += bestF
      skk += k * k
      skt += k * bestF
    }
    if (n < 8) break
    const slope = (n * skt - sk * st) / (n * skk - sk * sk)
    if (!Number.isFinite(slope) || Math.abs(slope / per - 1) > 0.05) break
    p0 = (st - slope * sk) / n
    per = slope
  }
  const finalPeriod = per
  let phase = p0 % finalPeriod
  if (phase < 0) phase += finalPeriod

  // First beat at or just before the music actually starts (skip silence at the top of the file).
  let startFrame = 0
  const peak = onset.reduce((m, v) => Math.max(m, v), 0)
  while (startFrame < frames && onset[startFrame] < peak * 0.15) startFrame++
  let first = phase
  while (first + finalPeriod <= startFrame + finalPeriod * 0.25) first += finalPeriod
  return { bpm: (60 * fps) / finalPeriod, firstBeat: first / fps }
}
