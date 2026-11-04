// Improv lessons: what kind of note was played, technique spotting and the free-play metrics.
// Pure: no engine or DOM.
import type { Chart, ImprovMetric, ImprovReport, ImprovSpec, InputFrame, InputOnset, PlayedNote, TechHit } from './types'
import { SCALES, noteName, parseChord, pc } from '../music/theory'

// Vibrato check (shared with judge.ts).
export const VIB_HYST = 0.08 // semitones past the last extreme before a reversal counts
const VIB_MEAN_SEC = 0.15
const VIB_MIN_PP = 0.2
const VIB_MIN_HZ = 3
const VIB_MAX_HZ = 9

// TechSpotter.
const VOICED_RMS = 0.002
const BEND_RISE = 0.8 // semitones
const BEND_SEC = 0.3
const BEND_JUMP = 0.6 // a bigger step between two frames is a new note, not a bend
const GESTURE_SEC = 0.6 // a rise that comes back down within this is a bend
const SLIDE_MERGE_SEC = 0.3
const SLIDE_MAX = 3 // semitones
const VIB_HOLD_SEC = 0.5
const VIB_SKIP_SEC = 0.15
const KEEP_SEC = 2

export function scalePcsOf(spec: ImprovSpec): number[] {
  if (spec.scale) return SCALES[spec.scale].intervals.map((i) => pc(i + spec.key))
  return spec.allowedPcs ?? []
}

export function chordPcs(symbol: string): number[] {
  return parseChord(symbol)?.tones ?? []
}

export function noteKind(midi: number, chordSymbol: string | null, scalePcs: number[]): 'chord' | 'scale' | 'out' {
  const p = pc(midi)
  if (chordSymbol && chordPcs(chordSymbol).includes(p)) return 'chord'
  return scalePcs.includes(p) ? 'scale' : 'out'
}

/** Vibrato over pitch points of one held note (already trimmed and near the target). */
export function vibratoCheck(pts: { t: number; v: number }[]): { ok: boolean; pp: number; rate: number } {
  if (pts.length < 4) return { ok: false, pp: 0, rate: 0 }
  // Detrend with a centred 150 ms moving mean.
  const half = VIB_MEAN_SEC / 2
  const ds: number[] = []
  let lo = 0
  let hi = 0
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    while (hi < pts.length && pts[hi].t <= pts[i].t + half) sum += pts[hi++].v
    while (pts[lo].t < pts[i].t - half) sum -= pts[lo++].v
    ds.push(pts[i].v - sum / (hi - lo))
  }
  const sorted = [...ds].sort((a, b) => a - b)
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))]
  const pp = q(0.9) - q(0.1)
  let dir = 0
  let ext = ds[0]
  let rev = 0
  for (const d of ds) {
    if (dir === 1) {
      if (d > ext) ext = d
      else if (ext - d >= VIB_HYST) {
        dir = -1
        ext = d
        rev++
      }
    } else if (dir === -1) {
      if (d < ext) ext = d
      else if (d - ext >= VIB_HYST) {
        dir = 1
        ext = d
        rev++
      }
    } else if (d - ext >= VIB_HYST) {
      dir = 1
      ext = d
    } else if (ext - d >= VIB_HYST) {
      dir = -1
      ext = d
    }
  }
  const sec = pts[pts.length - 1].t - pts[0].t
  const rate = sec > 0 ? rev / 2 / sec : 0
  return { ok: pp >= VIB_MIN_PP && rate >= VIB_MIN_HZ && rate <= VIB_MAX_HZ, pp, rate }
}

interface SpotFrame {
  t: number
  v: number | null
  rms: number
}

/** Spots bends, slides, legato and vibrato in free play, counting each gesture once. */
export class TechSpotter {
  hits: TechHit[] = []
  private frames: SpotFrame[] = []
  private noteT = -Infinity // last onset that wasn't a glide
  private lastMidi: number | null = null
  private bendDone = false
  private vibDone = false
  private vibCheckT = -Infinity
  private slideT = -Infinity
  private rise: { start: number; t: number; beat: number; from: number; peak: number; glide: boolean } | null = null

  frame(f: InputFrame, beat: number) {
    this.frames.push({ t: f.t, v: f.midiF, rms: f.rms })
    while (this.frames.length && this.frames[0].t < f.t - KEEP_SEC) this.frames.shift()
    const voiced = f.midiF !== null && f.rms > VOICED_RMS
    if (this.rise) {
      const r = this.rise
      if (voiced) r.peak = Math.max(r.peak, f.midiF!)
      if (voiced && (Math.abs(f.midiF! - r.from) <= 0.5 || r.peak - f.midiF! >= BEND_RISE)) this.commitRise('bend', f.t)
      else if (f.t - r.t > GESTURE_SEC) this.commitRise(r.glide ? 'slide' : 'bend', f.t)
    } else if (voiced && !this.bendDone) {
      // A smooth rise of 0.8 semitone within 300 ms of continuous sound, with no new note in between.
      let lo = f.midiF!
      let loT = f.t
      let smooth = true
      for (let i = this.frames.length - 2; i >= 0; i--) {
        const p = this.frames[i]
        if (p.t < f.t - BEND_SEC || p.t < this.noteT) break
        if (p.v === null || p.rms <= VOICED_RMS) break
        if (Math.abs(this.frames[i + 1].v! - p.v) > BEND_JUMP) smooth = false
        if (p.v < lo) {
          lo = p.v
          loT = p.t
        }
      }
      if (smooth && f.midiF! - lo >= BEND_RISE) this.rise = { start: loT, t: f.t, beat, from: lo, peak: f.midiF!, glide: false }
    }
    if (!this.vibDone && !this.bendDone && !this.rise && this.lastMidi !== null && f.t - this.noteT >= VIB_HOLD_SEC && f.t - this.vibCheckT >= 0.1) {
      this.vibCheckT = f.t
      const target = this.lastMidi
      const pts: { t: number; v: number }[] = []
      for (const p of this.frames) {
        if (p.t >= this.noteT + VIB_SKIP_SEC && p.v !== null && Math.abs(p.v - target) <= 1) pts.push({ t: p.t, v: p.v })
      }
      if (vibratoCheck(pts).ok) {
        this.hits.push({ kind: 'vibrato', beat })
        this.vibDone = true
      }
    }
  }

  onset(o: InputOnset, beat: number) {
    if (o.source === 'glide') {
      if (this.rise) {
        this.rise.glide = true
        return
      }
      if (this.bendDone) return // the release of a bend
      if (o.t - this.slideT < SLIDE_MERGE_SEC) {
        this.slideT = o.t
        return
      }
      if (o.midi !== null && this.lastMidi !== null && Math.abs(o.midi - this.lastMidi) <= SLIDE_MAX) {
        this.hits.push({ kind: 'slide', beat })
        this.slideT = o.t
      }
      if (o.midi !== null) this.lastMidi = o.midi
      return
    }
    // A new note. A rise that started right at it was this note's pitch arriving, not a bend.
    if (this.rise) {
      if (this.rise.start >= o.t - 0.1) this.rise = null
      else this.commitRise(this.rise.glide ? 'slide' : 'bend', o.t)
    }
    if (o.source === 'pitch') this.hits.push({ kind: 'legato', beat })
    this.noteT = o.t
    if (o.midi !== null) this.lastMidi = o.midi
    this.bendDone = false
    this.vibDone = false
    this.frames = this.frames.filter((p) => p.t >= o.t)
  }

  private commitRise(kind: 'bend' | 'slide', t: number) {
    const r = this.rise!
    this.rise = null
    if (kind === 'bend') {
      this.hits.push({ kind: 'bend', beat: r.beat })
      this.bendDone = true
    } else if (r.peak - r.from <= SLIDE_MAX + 0.5) {
      this.hits.push({ kind: 'slide', beat: r.beat })
      this.slideT = t
    }
  }
}

const TIPS: Record<ImprovMetric, string> = {
  inScale: 'Stay on the highlighted box notes.',
  phrases: 'Play short bursts of 3 to 12 notes, then take a breath.',
  space: 'Leave more space between ideas.',
  endings: 'End phrases on {end} and they sound finished.',
  targets: 'When the chord changes, land on one of its notes.',
  motif: 'Try repeating a short idea, then change it.',
  answers: 'Rest while the call plays, then answer in the gap and end on {end}.',
  echo: 'Listen to the call, then play the same notes back.',
}
const FILL_TIP = 'Fill a little more: a few more notes per bar.'

const DOMINANT = ['7', '9', '11', '13']
const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : 0)
const clamp100 = (v: number) => Math.max(0, Math.min(100, v))

/**
 * Scores free play. `swing` is whether the backing feel swings (echo calls are heard swung).
 * Notes are PlayedNotes with their voted midi.
 */
export function analyseImprov(spec: ImprovSpec, chart: Chart, notes: PlayedNote[], techs: TechHit[], swing = false): ImprovReport {
  const total = chart.totalBeats
  const listen = new Set(chart.listenBars)
  const barOf = (beat: number) => Math.floor(beat / 4)
  // A note in a call bar's last quarter beat belongs to the answer that follows.
  const inCall = (beat: number) => listen.has(barOf(beat)) && beat < barOf(beat) * 4 + 3.75
  const play = notes.filter((n) => n.beat >= -0.25 && n.beat < total && !inCall(n.beat)).sort((a, b) => a.beat - b.beat)
  const playBars: number[] = []
  for (let b = 0; b < chart.bars; b++) if (!listen.has(b)) playBars.push(b)
  const scalePcs = scalePcsOf(spec)
  const endPcs = spec.endPcs ?? [spec.key]
  const endNames = endPcs.map((p) => noteName(p)).join(' or ')
  const chordAt = (beat: number) => chart.chordTimeline[Math.max(0, Math.min(chart.chordTimeline.length - 1, barOf(beat)))]?.symbol ?? ''
  const techKinds = new Set(techs.map((h) => h.kind)).size
  const techniqueBonus = spec.technique ? Math.min(20, 5 * techKinds) : 0

  if (play.length < spec.minNotes) {
    return { notes: play.length, metrics: {}, techniqueBonus, tooFew: true, tips: [`Play at least ${spec.minNotes} notes. Silence can't win this one.`] }
  }

  // Phrases: split at gaps of a beat or more.
  const phrases: PlayedNote[][] = []
  for (const n of play) {
    const cur = phrases.length ? phrases[phrases.length - 1] : null
    if (cur && n.beat - cur[cur.length - 1].beat < 1) cur.push(n)
    else phrases.push([n])
  }
  const half = Math.max(1, playBars.length / 2)

  const metric: Record<ImprovMetric, () => number> = {
    inScale: () => {
      let ok = 0
      for (const n of play) {
        const p = pc(n.midi)
        if (scalePcs.includes(p)) ok++
        else if (spec.scale === 'blues') {
          const c = parseChord(chordAt(n.beat))
          if (c && DOMINANT.includes(c.quality) && p === pc(c.root + 4)) ok++
        }
      }
      return pct(ok, play.length)
    },
    phrases: () => 100 * Math.min(1, phrases.filter((p) => p.length >= 3 && p.length <= 12).length / half),
    space: () => {
      const used = new Set(play.map((n) => Math.floor(n.beat * 4)))
      const slots = playBars.length * 16
      if (!slots) return 0
      let filled = 0
      for (const b of playBars) for (let q = 0; q < 16; q++) if (used.has(b * 16 + q)) filled++
      const s = 1 - filled / slots
      if (s < 0.25) return (100 * s) / 0.25
      if (s > 0.6) return 100 * Math.max(0, 1 - (s - 0.6) / 0.4)
      return 100
    },
    endings: () => {
      const ps = phrases.filter((p) => p.length >= 2)
      return pct(ps.filter((p) => endPcs.includes(pc(p[p.length - 1].midi))).length, ps.length)
    },
    targets: () => {
      let attempts = 0
      let hits = 0
      for (const b of playBars) {
        const tones = chordPcs(chart.chordTimeline[b]?.symbol ?? '')
        if (!tones.length) continue
        const first = play.find((n) => n.beat >= b * 4 - 0.25 && n.beat <= b * 4 + 0.5)
        if (!first) continue
        attempts++
        if (tones.includes(pc(first.midi))) hits++
      }
      const d = Math.max(attempts, playBars.length / 2)
      return d > 0 ? (100 * hits) / d : 0
    },
    motif: () => {
      let pairs = 0
      let similar = 0
      for (let i = 0; i + 1 < phrases.length; i++) {
        const a = phrases[i]
        const b = phrases[i + 1]
        if (a.length < 3 || b.length < 3) continue
        pairs++
        const k = Math.min(a.length, b.length) - 1
        let ioi = 0
        let sign = 0
        for (let j = 0; j < k; j++) {
          if (Math.round((a[j + 1].beat - a[j].beat) * 2) === Math.round((b[j + 1].beat - b[j].beat) * 2)) ioi++
          if (Math.sign(a[j + 1].midi - a[j].midi) === Math.sign(b[j + 1].midi - b[j].midi)) sign++
        }
        if (ioi >= 0.7 * k || sign >= 0.7 * k) similar++
      }
      return 100 * Math.min(1, similar / Math.max(1, Math.round(pairs * 0.4)))
    },
    answers: () => {
      const bars = (chart.improvBars ?? []).filter((x) => x.role === 'answer' && !listen.has(x.bar)).map((x) => x.bar)
      let sum = 0
      for (const b of bars) {
        const ns = play.filter((n) => barOf(n.beat + 0.25) === b)
        let v = ns.length >= 2 ? 0.5 : 0
        if (ns.length && endPcs.includes(pc(ns[ns.length - 1].midi))) v += 0.5
        sum += v
      }
      const mean = bars.length ? sum / bars.length : 0
      const intrusions = notes.filter((n) => n.beat >= 0 && n.beat < total && inCall(n.beat)).length
      return clamp100(100 * mean - 5 * intrusions)
    },
    echo: () => {
      const bars = (chart.improvBars ?? []).filter((x) => x.role === 'echo' && !listen.has(x.bar)).map((x) => x.bar)
      let matched = 0
      let count = 0
      for (const b of bars) {
        const callStart = (b - 1) * 4
        const calls = chart.calls.filter((c) => c.beat >= callStart && c.beat < callStart + 4)
        const ns = play.filter((n) => barOf(n.beat + 0.25) === b)
        for (const c of calls) {
          count++
          const offbeat = Math.round(c.beat * 2) % 2 === 1
          const heard = c.beat + (swing && offbeat ? 0.33 * 0.5 : 0) + 4
          if (ns.some((n) => Math.abs(n.beat - heard) <= 0.5 && pc(n.midi) === pc(c.midi))) matched++
        }
      }
      return pct(matched, count)
    },
  }

  const metrics: Partial<Record<ImprovMetric, number>> = {}
  const tips: string[] = []
  for (const k of Object.keys(spec.weights) as ImprovMetric[]) {
    const v = Math.round(clamp100(metric[k]()))
    metrics[k] = v
    if (v < 60) {
      let tip = TIPS[k].replace('{end}', endNames)
      if (k === 'space') {
        const used = new Set(play.map((n) => Math.floor(n.beat * 4))).size
        if (playBars.length && 1 - used / (playBars.length * 16) > 0.6) tip = FILL_TIP
      }
      tips.push(tip)
    }
  }
  return { notes: play.length, metrics, techniqueBonus, tooFew: false, tips }
}

export function improvScore(spec: ImprovSpec, r: ImprovReport): number {
  if (r.tooFew) return 0
  let ws = 0
  let sum = 0
  for (const k of Object.keys(spec.weights) as ImprovMetric[]) {
    const w = spec.weights[k] ?? 0
    ws += w
    sum += w * (r.metrics[k] ?? 0)
  }
  const base = ws > 0 ? sum / ws : 0
  return Math.max(0, Math.min(100, Math.round(base + r.techniqueBonus)))
}
