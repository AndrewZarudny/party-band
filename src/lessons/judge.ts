// Matches live onsets and frames against a lesson chart and grades each event.
// No engine or DOM: every time passed in is already corrected by the run's offset.
import type { Chart, ChartEvent, Grade, InputFrame, InputOnset, JudgeResult, JudgeSummary, NoteEv, Timing, Verdict, Windows } from './types'
import { pc } from '../music/theory'
import { checkChord } from './chroma'
import { vibratoCheck } from './improv'

export const WINDOWS: Record<Timing, Windows> = {
  easy: { perfect: 80, good: 140, ok: 220, lateExtra: 20 },
  normal: { perfect: 65, good: 115, ok: 180, lateExtra: 20 },
  tight: { perfect: 55, good: 100, ok: 150, lateExtra: 20 },
}
export const STRUM_SHIFT_MS = 15 // a strum is heard at its first string

const VOTE_SEC = 0.12 // pitch vote after each onset
const VOTE_RMS = 0.002
const SETTLE_SEC = 0.045 // one detector window: frames before this still hear the note before
const EVIDENCE = 0.3 // share of voiced frames showing the expected note that is enough to accept it
const HOLD_SEC = 0.12 // a wrong note waits this long for the right one
const EXTRA_GAP_SEC = 0.15
const LISTEN_TAIL_BEATS = 0.25
const MIN_PERFECT_MS = 40
const GAP_SHARE = 0.45
const WINDOW_SCALE = 1.5
const WINDOW_SCALE_MAX = 2
const GRADE_CREDIT: Record<Grade, number> = { perfect: 1, good: 0.85, ok: 0.6, miss: 0 }
const WRONG_CREDIT = 0.15
const CHROMA_FROM = 0.17
const CHROMA_TO = 0.45
const CHROMA_MIN_FRAMES = 3
const CHORD_FAIL = 0.7
const POWER_FAIL = 0.85
const MUTE_STABLE = 0.6
const MUTE_RANG = 0.7
const REST_SKIP = 0.12
const REST_AFTER = 0.05
const REST_GATE_MIN = 0.004
const REST_GATE_SHARE = 0.2
const REST_CLEAN = 0.6
export const LEGATO_MAX_STRENGTH = 2.5
const LEGATO_PEAK = 0.8
const BEND_REACH = 0.4
const BEND_HOLD = 0.4
const BEND_FAIL = 0.6
export { VIB_HYST } from './improv'
const VIB_SKIP = 0.15
const VIB_FAIL = 0.7
const PM_PEAK_SEC = 0.06
const PM_SEC = 0.15
const PM_DROP = 0.355 // -9 dB
const SUSTAIN_BEATS = 2
const SUSTAIN_EDGE = 0.08
const FRAME_KEEP_SEC = 12

export function windowsFor(timing: Timing, easyTiming: boolean, calibrated: boolean): Windows {
  const w = WINDOWS[timing]
  let k = 1
  if (easyTiming) k *= WINDOW_SCALE
  if (!calibrated) k *= WINDOW_SCALE
  k = Math.min(WINDOW_SCALE_MAX, k)
  return { perfect: w.perfect * k, good: w.good * k, ok: w.ok * k, lateExtra: w.lateExtra }
}

export interface JudgeOpts {
  start: number
  secPerBeat: number
  windows: Windows
  octaveOk: boolean
  restGate: () => number
  listenBars: number[]
}

/** The most common midi in the 100 ms after an onset (ties or no frames: the onset's own midi). */
export function voteMidi(frames: InputFrame[], o: InputOnset): { midi: number | null; stable: number } {
  if (o.source === 'key' || o.source === 'auto') return { midi: o.midi, stable: 1 }
  const counts = new Map<number, number>()
  let n = 0
  for (const f of frames) {
    if (f.t < o.t || f.t > o.t + VOTE_SEC || f.rms <= VOTE_RMS) continue
    n++
    if (f.midi !== null) counts.set(f.midi, (counts.get(f.midi) ?? 0) + 1)
  }
  let best: number | null = null
  let bestN = 0
  let tie = false
  for (const [m, c] of counts) {
    if (c > bestN) {
      best = m
      bestN = c
      tie = false
    } else if (c === bestN) tie = true
  }
  if (best === null || tie) return { midi: o.midi, stable: n && o.midi !== null ? (counts.get(o.midi) ?? 0) / n : 0 }
  return { midi: best, stable: bestN / n }
}

/** Share of voiced frames after an onset that show `midi` exactly, and an octave away. */
export function evidenceFor(frames: InputFrame[], o: InputOnset, midi: number): { exact: number; octave: number; n: number } {
  let n = 0
  let exact = 0
  let octave = 0
  for (const f of frames) {
    if (f.t < o.t + SETTLE_SEC || f.t > o.t + VOTE_SEC || f.rms <= VOTE_RMS || f.midi === null) continue
    n++
    if (f.midi === midi) exact++
    else if (Math.abs(f.midi - midi) === 12) octave++
  }
  return n ? { exact: exact / n, octave: octave / n, n } : { exact: 0, octave: 0, n: 0 }
}

interface Ev {
  e: ChartEvent
  te: number
  end: number
  next: number // start of the next playable event
  perfect: number
  good: number
  ok: number
  shift: number
}
interface Match {
  o: InputOnset
  err: number
  voted: number | null
  stable: number
}
interface Post {
  until: number
  run: () => void
}

export class Judge {
  readonly results = new Map<number, JudgeResult>()
  extras = 0
  listenViolations = 0
  private chart: Chart
  private o: JudgeOpts
  private evs: Ev[]
  private frames: InputFrame[] = []
  private queue: InputOnset[] = []
  private prov = new Map<number, Match>()
  private posts: Post[] = []
  private chroma = new Map<number, { from: number; to: number; frames: Float32Array[] }>()
  private openTech: { from: number; to: number }[] = []
  private openBend: { ev: NoteEv; to: number } | null = null
  private lastMatchT = -Infinity
  private lastMatchMidi: number | null = null
  private prevPeak = 0
  private listen: Set<number>
  private chartMidis: Set<number>

  constructor(chart: Chart, o: JudgeOpts) {
    this.chart = chart
    this.o = o
    this.listen = new Set(o.listenBars)
    this.chartMidis = new Set(chart.events.flatMap((e) => (e.kind === 'note' ? [e.midi] : [])))
    const W = o.windows
    const spb = o.secPerBeat
    this.evs = chart.events.map((e) => ({
      e,
      te: o.start + e.beat * spb,
      end: o.start + (e.beat + e.dur) * spb,
      next: Infinity,
      perfect: W.perfect,
      good: W.good,
      ok: W.ok,
      shift: e.kind === 'chord' || e.kind === 'mute' ? STRUM_SHIFT_MS : 0,
    }))
    // Shrink the windows for fast passages so neighbours never overlap.
    const play = this.evs.filter((v) => v.e.kind !== 'rest')
    play.forEach((v, i) => {
      const prev = i > 0 ? v.te - play[i - 1].te : Infinity
      const next = i + 1 < play.length ? play[i + 1].te - v.te : Infinity
      v.next = i + 1 < play.length ? play[i + 1].te : Infinity
      const gapMs = Math.min(prev, next) * 1000
      const okI = Math.min(W.ok, GAP_SHARE * gapMs)
      v.perfect = Math.max(MIN_PERFECT_MS, (okI * W.perfect) / W.ok)
      v.good = Math.max(v.perfect, (okI * W.good) / W.ok)
      v.ok = Math.max(v.good, okI)
    })
  }

  onset(o: InputOnset) {
    let i = this.queue.length
    while (i > 0 && this.queue[i - 1].t > o.t) i--
    this.queue.splice(i, 0, o)
  }

  frame(f: InputFrame) {
    this.frames.push(f)
  }

  chromaWindows(t: number): number[] {
    const ids: number[] = []
    this.chroma.forEach((w, id) => {
      if (t >= w.from && t <= w.to) ids.push(id)
    })
    return ids
  }

  addChroma(eventIds: number[], v: Float32Array) {
    for (const id of eventIds) this.chroma.get(id)?.frames.push(Float32Array.from(v))
  }

  tick(t: number): JudgeResult[] {
    const out: JudgeResult[] = []
    while (this.queue.length) {
      const o = this.queue[0]
      const instant = o.source === 'key' || o.source === 'auto'
      if (!instant && o.t + VOTE_SEC > t) break
      this.queue.shift()
      this.process(o, out)
    }
    this.prov.forEach((m, id) => {
      if (t >= m.o.t + HOLD_SEC + VOTE_SEC) {
        this.prov.delete(id)
        out.push(this.results.get(id)!)
      }
    })
    for (const v of this.evs) {
      if (this.results.has(v.e.id)) continue
      if (v.e.kind === 'rest') {
        if (t >= v.end + REST_AFTER) out.push(this.judgeRest(v))
      } else if (t > this.lateBound(v) + VOTE_SEC) {
        out.push(this.miss(v))
      }
    }
    this.runPosts(t)
    if (this.frames.length > 256 && this.frames[0].t < t - FRAME_KEEP_SEC) {
      this.frames = this.frames.filter((f) => f.t >= t - FRAME_KEEP_SEC)
    }
    return out.sort((a, b) => a.eventId - b.eventId)
  }

  pending(t: number): ChartEvent | null {
    for (const v of this.evs) {
      // a provisional wrong note can still be corrected inside its hold
      if (v.e.kind === 'rest' || (this.results.has(v.e.id) && !this.prov.has(v.e.id))) continue
      if (t <= this.lateBound(v)) return v.e
    }
    return null
  }

  bendProgress(t: number): number | null {
    const b = this.openBend
    if (!b || t > b.to || b.ev.bendTo === undefined) return null
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i]
      if (f.midiF !== null) return Math.max(0, (f.midiF - b.ev.midi) / (b.ev.bendTo - b.ev.midi))
    }
    return 0
  }

  finish(): JudgeSummary {
    // Onsets still waiting for their vote are processed with the frames we have.
    const q = this.queue
    this.queue = []
    for (const o of q) this.process(o, [])
    this.prov.clear()
    for (const v of this.evs) {
      if (this.results.has(v.e.id)) continue
      if (v.e.kind === 'rest') this.judgeRest(v)
      else this.miss(v)
    }
    this.runPosts(Infinity)
    return { results: this.evs.map((v) => this.results.get(v.e.id)!), extras: this.extras, listenViolations: this.listenViolations }
  }

  // ---- matching ----

  private err(v: Ev, o: InputOnset) {
    return (o.t - v.te) * 1000 + v.shift
  }

  private lateBound(v: Ev) {
    return v.te + (v.ok + this.o.windows.lateExtra - v.shift) / 1000
  }

  private grade(v: Ev, err: number): Grade {
    const a = Math.abs(err) - (err > 0 ? this.o.windows.lateExtra : 0)
    if (a <= v.perfect) return 'perfect'
    if (a <= v.good) return 'good'
    if (a <= v.ok) return 'ok'
    return 'miss'
  }

  private verdict(g: Grade, err: number): Verdict {
    if (g === 'perfect' || g === 'good') return g
    if (g === 'ok') return err < 0 ? 'early' : 'late'
    return 'miss'
  }

  private pitchMatch(e: NoteEv, voted: number | null, o: InputOnset): { slip: boolean } | null {
    // Pitch detection can jump an octave on the low strings; not in lessons that use that octave on purpose.
    const octaveSlipOk = e.string <= 1 && !this.chartMidis.has(e.midi + 12) && !this.chartMidis.has(e.midi - 12)
    if (voted !== null) {
      if (voted === e.midi || (e.bendTo !== undefined && voted === e.bendTo)) return { slip: false }
      if (this.o.octaveOk && pc(voted) === pc(e.midi)) return { slip: false }
      if (octaveSlipOk && Math.abs(voted - e.midi) === 12) return { slip: true }
    }
    if (o.source === 'key' || o.source === 'auto') return null
    // The string before can still ring louder and win the vote: the expected note showing up clearly is enough.
    // Not for a repeated note, where that "evidence" could just be the last one still ringing.
    if (this.lastMatchMidi === e.midi) return null
    const ev = evidenceFor(this.frames, o, e.midi)
    if (ev.n < 2) return null
    if (ev.exact >= EVIDENCE) return { slip: false }
    if (octaveSlipOk && ev.exact + ev.octave >= EVIDENCE) return { slip: true }
    return null
  }

  private process(o: InputOnset, out: JudgeResult[]) {
    const spb = this.o.secPerBeat
    const beat = (o.t - this.o.start) / spb
    if (beat < -2 || beat > this.chart.totalBeats + 1) return
    // Pitch changes inside a bend, vibrato or slide are part of that note.
    if ((o.source === 'pitch' || o.source === 'glide') && this.openTech.some((w) => o.t >= w.from && o.t <= w.to)) return
    if (o.source !== 'glide') {
      const bar = Math.floor(beat / 4)
      if (this.listen.has(bar) && beat < bar * 4 + 4 - LISTEN_TAIL_BEATS) {
        this.listenViolations++
        return
      }
    }
    const { midi: voted, stable } = voteMidi(this.frames, o)
    const strike = o.source === 'attack' || o.source === 'key' || o.source === 'auto'
    const cands = this.evs.filter((v) => {
      if (v.e.kind === 'rest') return false
      if (this.results.has(v.e.id) && !this.prov.has(v.e.id)) return false
      const err = this.err(v, o)
      return err >= -v.ok && err <= v.ok + this.o.windows.lateExtra
    })
    let pick: Ev | null = null
    let slip = false
    for (const v of cands) {
      if (v.e.kind === 'note') {
        if (o.source === 'glide' && v.e.tech !== 'slide') continue
        if (this.prov.has(v.e.id) && o.t - this.prov.get(v.e.id)!.o.t > HOLD_SEC) continue
        const m = this.pitchMatch(v.e, voted, o)
        if (m) {
          pick = v
          slip = m.slip
          break
        }
      } else if (strike && !this.prov.has(v.e.id)) {
        pick = v
        break
      }
    }
    if (pick) {
      let err = this.err(pick, o)
      const old = this.prov.get(pick.e.id)
      if (old) {
        if (Math.abs(old.err) < Math.abs(err)) err = old.err
        this.prov.delete(pick.e.id)
      }
      this.lastMatchT = o.t
      this.lastMatchMidi = pick.e.kind === 'note' ? pick.e.midi : null
      out.push(this.match(pick, { o, err, voted, stable }, slip))
      return
    }
    if (o.source === 'glide') return
    // Wrong pitch: the nearest note in time is held as wrong for a moment.
    const notes = cands.filter((v) => v.e.kind === 'note' && !this.results.has(v.e.id))
    if (notes.length) {
      const v = notes.reduce((a, b) => (Math.abs(this.err(b, o)) < Math.abs(this.err(a, o)) ? b : a))
      const err = this.err(v, o)
      const g = this.grade(v, err)
      this.prov.set(v.e.id, { o, err, voted, stable })
      this.results.set(v.e.id, { eventId: v.e.id, kind: 'note', verdict: 'wrong', grade: g, errMs: Math.round(err), pitchOk: false, played: voted, credit: WRONG_CREDIT })
      this.lastMatchT = o.t
      return
    }
    if (cands.length) return // e.g. a pitch change while a chord is due
    if (o.t - this.lastMatchT > EXTRA_GAP_SEC) this.extras++
  }

  private match(v: Ev, m: Match, slip: boolean): JudgeResult {
    const g = this.grade(v, m.err)
    const r: JudgeResult = {
      eventId: v.e.id,
      kind: v.e.kind,
      verdict: this.verdict(g, m.err),
      grade: g,
      errMs: Math.round(m.err),
      pitchOk: true,
      played: m.voted,
      credit: GRADE_CREDIT[g],
    }
    this.results.set(v.e.id, r)
    const instant = m.o.source === 'key' || m.o.source === 'auto'
    const e = v.e
    if (e.kind === 'note') this.noteChecks(v, e, r, m, slip, instant)
    else if (e.kind === 'chord') {
      r.chordOk = null
      const from = m.o.t + CHROMA_FROM
      const to = Math.min(m.o.t + CHROMA_TO, v.next)
      if (e.chroma && to > from) {
        this.chroma.set(e.id, { from, to, frames: [] })
        this.posts.push({ until: to, run: () => this.chordCheck(v, r, m) })
      } else this.chordCheck(v, r, m)
    } else if (e.kind === 'mute') {
      if (m.stable >= MUTE_STABLE && m.voted !== null) r.credit *= MUTE_RANG
    }
    return r
  }

  private noteChecks(v: Ev, e: NoteEv, r: JudgeResult, m: Match, slip: boolean, instant: boolean) {
    const o = m.o
    if (slip) r.octaveSlip = true
    r.techOk = null
    const tech = e.tech
    if (tech === 'bend' || tech === 'vibrato' || tech === 'slide') this.openTech.push({ from: o.t, to: v.end })
    if (instant) {
      if (tech === 'bend' || tech === 'vibrato') r.techOk = true
      if (tech === 'hammer' || tech === 'pull' || tech === 'slide') r.legato = true
      if (tech === 'pm') r.pmOk = true
      if (tech === 'bend') this.openBend = { ev: e, to: v.end }
      this.prevPeak = o.peak
      return
    }
    if (tech === 'hammer' || tech === 'pull') {
      r.legato = o.source === 'pitch' || (o.source === 'attack' && this.prevPeak > 0 && o.peak < LEGATO_PEAK * this.prevPeak && (o.strength ?? 0) < LEGATO_MAX_STRENGTH)
    } else if (tech === 'slide') {
      r.legato = o.source === 'glide' || o.source === 'pitch'
    }
    this.prevPeak = o.peak
    const target = r.played ?? e.midi
    if (tech === 'bend' && e.bendTo !== undefined) {
      this.openBend = { ev: e, to: v.end }
      this.posts.push({ until: v.end, run: () => this.bendCheck(v, e, r, o.t) })
    } else if (tech === 'vibrato') {
      this.posts.push({ until: v.end, run: () => this.vibratoCheck(v, r, o.t, target) })
    } else if (tech === 'pm') {
      r.pmOk = null
      this.posts.push({ until: o.t + PM_PEAK_SEC + PM_SEC, run: () => this.pmCheck(r, o.t) })
    }
    if (e.dur >= SUSTAIN_BEATS && tech !== 'bend' && tech !== 'vibrato') {
      this.posts.push({ until: v.end, run: () => this.sustainCheck(v, r, o.t, target) })
    }
  }

  private runPosts(t: number) {
    if (!this.posts.length) return
    const due = this.posts.filter((p) => t >= p.until)
    if (!due.length) return
    this.posts = this.posts.filter((p) => t < p.until)
    for (const p of due) p.run()
  }

  private framesIn(a: number, b: number): InputFrame[] {
    return this.frames.filter((f) => f.t >= a && f.t <= b)
  }

  // ---- post checks (they adjust a result that was already reported) ----

  private chordCheck(v: Ev, r: JudgeResult, m: Match) {
    const e = v.e
    if (e.kind !== 'chord') return
    const w = this.chroma.get(e.id)
    this.chroma.delete(e.id)
    if (e.chroma && w && w.frames.length >= CHROMA_MIN_FRAMES) {
      const avg = new Float32Array(12)
      for (const f of w.frames) for (let i = 0; i < 12; i++) avg[i] += f[i] / w.frames.length
      const c = checkChord(avg, e.symbol)
      r.chordOk = c.ok
      if (!c.ok) {
        r.credit *= CHORD_FAIL
        r.chordMissing = c.missing
      }
    } else if (e.power) {
      const p = m.voted === null ? null : pc(m.voted)
      const ok = p !== null && (p === e.pcs[0] || p === e.pcs[1])
      r.chordOk = ok
      if (!ok) r.credit *= POWER_FAIL
    } else r.chordOk = null
  }

  private bendCheck(v: Ev, e: NoteEv, r: JudgeResult, hit: number) {
    if (this.openBend?.ev === e) this.openBend = null
    const to = e.bendTo!
    const reachEnd = hit + Math.min(1, e.dur) * this.o.secPerBeat
    const fs = this.framesIn(hit, v.end).filter((f) => f.midiF !== null)
    const i = fs.findIndex((f) => f.t <= reachEnd && Math.abs(f.midiF! - to) <= BEND_REACH)
    let ok = false
    if (i >= 0) {
      const rest = fs.slice(i)
      ok = rest.filter((f) => Math.abs(f.midiF! - to) <= BEND_REACH).length >= BEND_HOLD * rest.length
    }
    r.techOk = ok
    if (!ok) r.credit *= BEND_FAIL
  }

  private vibratoCheck(v: Ev, r: JudgeResult, hit: number, target: number) {
    const pts: { t: number; v: number }[] = []
    for (const f of this.framesIn(hit + VIB_SKIP, v.end)) {
      if (f.midiF !== null && Math.abs(f.midiF - target) <= 1) pts.push({ t: f.t, v: f.midiF })
    }
    const ok = vibratoCheck(pts).ok
    r.techOk = ok
    if (!ok) r.credit *= VIB_FAIL
  }

  private pmCheck(r: JudgeResult, hit: number) {
    const head = this.framesIn(hit, hit + PM_PEAK_SEC)
    if (!head.length) return
    const peak = head.reduce((a, b) => (b.rms > a.rms ? b : a))
    if (peak.rms <= 0) return
    r.pmOk = this.framesIn(peak.t + 1e-6, peak.t + PM_SEC).some((f) => f.rms <= PM_DROP * peak.rms)
  }

  private sustainCheck(v: Ev, r: JudgeResult, hit: number, target: number) {
    const fs = this.framesIn(hit + SUSTAIN_EDGE, v.end - SUSTAIN_EDGE).filter((f) => f.rms > VOTE_RMS)
    let s = 0
    for (const f of fs) s += f.midi === null ? 0.5 : Math.abs(f.midi - target) <= 1 ? 1 : 0
    const share = fs.length ? s / fs.length : 0
    r.sustain = share
    r.credit *= 0.85 + 0.15 * share
  }

  // ---- rests and misses ----

  private judgeRest(v: Ev): JudgeResult {
    const fs = this.framesIn(v.te + REST_SKIP, v.end)
    const gate = Math.max(REST_GATE_MIN, REST_GATE_SHARE * this.o.restGate())
    const quiet = fs.filter((f) => f.rms < gate).length
    const clean = !fs.length || quiet >= REST_CLEAN * fs.length
    const r: JudgeResult = {
      eventId: v.e.id,
      kind: 'rest',
      verdict: clean ? 'clean-stop' : 'ringing',
      grade: clean ? 'perfect' : 'miss',
      errMs: null,
      pitchOk: true,
      credit: clean ? 1 : 0,
    }
    this.results.set(v.e.id, r)
    return r
  }

  private miss(v: Ev): JudgeResult {
    const r: JudgeResult = { eventId: v.e.id, kind: v.e.kind, verdict: 'miss', grade: 'miss', errMs: null, pitchOk: false, played: null, credit: 0 }
    this.results.set(v.e.id, r)
    return r
  }
}
