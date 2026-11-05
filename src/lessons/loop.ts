// Loop the hard part: a few bars (or a generated drill) over and over.
// No React. A loop runs segments: fast passes at the work tempo, two slow relaxed passes, a short rest, again.
// A tempo is earned by a clean first pass plus two more clean passes, then the work tempo goes up one step.
import type { Autoplay, Chart, ChartEvent, JudgeResult, Lesson, LessonResult, LoopPass, LoopSpec, LoopSummary, Progress, Speed, Verdict } from './types'
import { buildChart } from './charts'
import { dayKey } from './progress'
import { LessonRun } from './run'
import { goodOrBetter } from './scoring'
import { EARN_PASSES, FULL_SPEED, bpmAt, snapSpeed, tempoStep } from './speed'

export const FAST_PASSES = 4 // heuristic: passes per fast segment
export const SLOW_PASSES = 2 // heuristic: relaxed passes per slow segment
export const SLOW_STEPS = 3 // heuristic: a slow pass is 3 tempo steps (about 9 BPM) under the work tempo
export const REST_SEC = 25 // research: 20–30 s rest between blocks
export const LOOP_REPS = FAST_PASSES // passes in the loop chart
export const CLEAN_ACC = 0.9
export const LOOP_START_SHARE = 0.7 // a bars loop starts at 70% of the run's speed
export const MAX_LOOP_BARS = 4
export const LOOP_MIN_SPEED = 0.5 // loops may go under the lesson floor (MIN_SPEED): the player just struggled there
const FAR_UNDER = 0.8 // a run under this speed aims the loop at a nearer target than full speed
const CHANGE_MS = 1200 // the banner between segments

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Bars from..to of a chart, repeated `reps` times back to back. Ids are 0..n-1 in beat order. */
export function sliceChart(chart: Chart, from: number, to: number, reps: number): Chart {
  const nb = to - from + 1
  const passBeats = 4 * nb
  const lo = from * 4
  const hi = (to + 1) * 4
  const src = chart.events.filter((e) => e.beat >= lo && e.beat < hi)
  const srcCalls = chart.calls.filter((c) => c.beat >= lo && c.beat < hi)
  const drafts: ChartEvent[] = []
  const calls: Chart['calls'] = []
  const listenBars: number[] = []
  const chordTimeline: Chart['chordTimeline'] = []
  const listenSrc = chart.listenBars.filter((b) => b >= from && b <= to)
  for (let r = 0; r < reps; r++) {
    const shift = r * passBeats - lo
    for (const e of src) drafts.push({ ...e, beat: e.beat + shift })
    for (const c of srcCalls) calls.push({ ...c, beat: c.beat + shift })
    for (const b of listenSrc) listenBars.push(b - from + r * nb)
    for (let i = 0; i < nb; i++) chordTimeline.push({ beat: 4 * (r * nb + i), symbol: chart.chordTimeline[from + i]?.symbol ?? '' })
  }
  const events = drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.beat - b.d.beat || a.i - b.i)
    .map(({ d }, id) => ({ ...d, id }) as ChartEvent)
  calls.sort((a, b) => a.beat - b.beat)

  // Same rule as buildChart: only events the player strikes.
  let minGapBeats = Infinity
  let prev: number | null = null
  for (const e of events) {
    if (e.kind === 'rest') continue
    if (prev !== null && e.beat > prev) minGapBeats = Math.min(minGapBeats, e.beat - prev)
    prev = e.beat
  }
  return { lessonId: chart.lessonId, bars: nb * reps, totalBeats: passBeats * reps, events, calls, listenBars, chordTimeline, minGapBeats }
}

/** The lesson a loop segment runs: the slice's length, a one-bar count-in, the band following the slice. */
export function loopLesson(lesson: Lesson, from: number, to: number, reps: number): Lesson {
  const nb = to - from + 1
  const out: Lesson = { ...lesson, bars: nb * reps, countInBeats: 4 }
  const b = lesson.backing
  if (b && b.chords.length) out.backing = { ...b, chords: Array.from({ length: nb }, (_, i) => b.chords[(from + i) % b.chords.length]) }
  return out
}

/** Call & response: a loop keeps the call with its answer. */
export function withCalls(chart: Chart, from: number, to: number): { from: number; to: number } {
  const listen = new Set(chart.listenBars)
  let f = from
  let t = to
  if (!listen.has(f) && listen.has(f - 1)) f--
  if (f === t && listen.has(f) && f + 1 < chart.bars) t = f + 1
  return { from: f, to: t }
}

/** At least one event to strike in bars from..to. */
export function playable(chart: Chart, from: number, to: number): boolean {
  return chart.events.some((e) => e.kind !== 'rest' && e.beat >= from * 4 && e.beat < (to + 1) * 4)
}

/** The bar (or two) with the lowest accuracy, when it is under the clean mark. */
export function hardRange(chart: Chart, barAcc: (number | null)[]): { from: number; to: number } | null {
  let h = -1
  for (let i = 0; i < barAcc.length; i++) {
    const a = barAcc[i]
    if (a === null) continue
    const cur = h >= 0 ? barAcc[h] : null
    if (cur === null || a < cur) h = i
  }
  if (h < 0) return null
  const ha = barAcc[h]
  if (ha === null || ha >= CLEAN_ACC) return null
  const nx = barAcc[h + 1]
  const to = nx !== undefined && nx !== null && nx < CLEAN_ACC ? h + 1 : h
  const r = withCalls(chart, h, to)
  return playable(chart, r.from, r.to) ? r : null
}

/** 'Bar 5' or 'Bars 5–6' (1-based). */
export function loopTitle(from: number, to: number): string {
  return from === to ? `Bar ${from + 1}` : `Bars ${from + 1}–${to + 1}`
}

/**
 * A bars loop from a result card: starts at 70% of the run's speed (at least two tempo steps under it), ends
 * at the lesson's tempo. A run far under full speed aims a few steps above it instead.
 */
export function loopSpecFor(lesson: Lesson, r: LessonResult, from: number, to: number): LoopSpec {
  const range = withCalls(buildChart(lesson), from, to)
  const step = tempoStep(lesson)
  const start = clamp(snapSpeed(Math.min(r.speed * LOOP_START_SHARE, r.speed - 2 * step)), LOOP_MIN_SPEED, FULL_SPEED)
  const target = r.speed >= FAR_UNDER ? FULL_SPEED : clamp(snapSpeed(Math.max(r.speed + 2 * step, start + 6 * step)), start, FULL_SPEED)
  return {
    kind: 'bars',
    lesson,
    fromBar: range.from,
    toBar: range.to,
    startSpeed: start,
    targetSpeed: target,
    title: loopTitle(range.from, range.to),
    sourceId: lesson.id,
  }
}

/** A loop with a clean pass counts once on the lesson's record, and the lesson isn't cold today any more. */
export function recordLoop(p: Progress, lessonId: string, s: LoopSummary, now: Date): Progress {
  if (s.clean === 0 || !p.lessons[lessonId]) return p
  const next = JSON.parse(JSON.stringify(p)) as Progress
  const rec = next.lessons[lessonId]
  rec.loops = (rec.loops ?? 0) + 1
  rec.loopTop = Math.max(rec.loopTop ?? 0, s.earned)
  rec.loopDay = dayKey(now)
  return next
}

/**
 * The fast segment's decision after its passes so far (true = clean), in order.
 * First pass not clean: one step slower. A clean first pass plus two more: earned, one step faster
 * ('done' at the target). FAST_PASSES without that: the same tempo again. null: keep playing.
 */
export function decideFast(passes: boolean[], w: Speed, target: Speed, step: Speed): { next: Speed | 'done' | null; earned: boolean } {
  if (!passes.length) return { next: null, earned: false }
  if (!passes[0]) return { next: Math.max(LOOP_MIN_SPEED, snapSpeed(w - step)), earned: false }
  if (passes.filter(Boolean).length >= EARN_PASSES) {
    if (w >= target - 1e-6) return { next: 'done', earned: true }
    return { next: Math.min(target, snapSpeed(w + step)), earned: true }
  }
  if (passes.length >= FAST_PASSES) return { next: w, earned: false }
  return { next: null, earned: false }
}

/** The relaxed tempo of a slow segment. */
export function slowSpeed(w: Speed, step: Speed): Speed {
  return Math.max(LOOP_MIN_SPEED, snapSpeed(w - SLOW_STEPS * step))
}

// ---- Session ----------------------------------------------------------------

export type LoopSeg = 'fast' | 'slow'

export interface LoopView {
  phase: 'idle' | 'countin' | 'playing' | 'change' | 'rest' | 'done' | 'paused' | 'error'
  seg: LoopSeg // the segment playing (between segments: the one coming up)
  speed: Speed // current segment
  work: Speed // the fast work tempo
  next: Speed | null // decided work tempo, shown in the banner
  passes: LoopPass[]
  clean: number // clean fast passes
  earned: Speed // fastest tempo earned in this loop; 0 = none
  live: { good: number; judged: number; total: number } // the pass being played now
  last: Verdict | null // last verdict, for the pop
  vKey: number
  note: string | null // banner line
  restLeft: number // seconds of the rest (phase 'rest')
}

export interface LoopOpts {
  easyTiming: boolean
  backingOn: boolean
  keyboard: boolean
  mic: boolean
  autoplay: Autoplay | null
}

export class LoopSession {
  readonly spec: LoopSpec
  readonly chart: Chart // fast segments; every pass of every segment uses these event ids
  readonly lesson: Lesson
  readonly step: Speed
  run: LessonRun | null
  view: LoopView
  onChange: ((v: LoopView) => void) | null
  onRun: ((r: LessonRun) => void) | null
  onJudge: ((r: JudgeResult, run: LessonRun) => void) | null

  private opts: LoopOpts
  private slowChart: Chart
  private slowLesson: Lesson
  private passBeats: number
  private perPass: number
  private results: JudgeResult[]
  private calibrated: boolean
  private reached: boolean
  private seg: number // segment token: callbacks of an old run are ignored
  private timer: number
  private pausing: boolean
  private stopped: boolean
  private resumeAt: Speed | 'done' | null // what a fast pass in this segment already decided; kept over a pause
  private flush: (() => void) | null // closes the segment's decided passes

  constructor(spec: LoopSpec, o: LoopOpts) {
    this.spec = spec
    this.opts = o
    const full = buildChart(spec.lesson)
    this.chart = sliceChart(full, spec.fromBar, spec.toBar, FAST_PASSES)
    this.lesson = loopLesson(spec.lesson, spec.fromBar, spec.toBar, FAST_PASSES)
    // the slow chart is the fast one's first passes: same event ids
    this.slowChart = sliceChart(full, spec.fromBar, spec.toBar, SLOW_PASSES)
    this.slowLesson = loopLesson(spec.lesson, spec.fromBar, spec.toBar, SLOW_PASSES)
    this.step = tempoStep(spec.lesson)
    this.passBeats = 4 * (spec.toBar - spec.fromBar + 1)
    this.perPass = this.chart.events.filter((e) => e.beat < this.passBeats).length
    this.run = null
    this.view = {
      phase: 'idle',
      seg: 'fast',
      speed: spec.startSpeed,
      work: spec.startSpeed,
      next: null,
      passes: [],
      clean: 0,
      earned: 0,
      live: { good: 0, judged: 0, total: this.perPass },
      last: null,
      vKey: 0,
      note: null,
      restLeft: 0,
    }
    this.onChange = null
    this.onRun = null
    this.onJudge = null
    this.results = []
    this.calibrated = false
    this.reached = false
    this.seg = 0
    this.timer = 0
    this.pausing = false
    this.stopped = false
    this.resumeAt = null
    this.flush = null
  }

  /** BPM of a speed, for the banners. */
  bpm(s: Speed): number {
    return bpmAt(this.spec.lesson, s)
  }

  /** A fast segment at `speed` (default: the work tempo), after a one-bar count-in. */
  start(speed?: Speed) {
    if (speed !== undefined) this.emit({ work: speed })
    this.play('fast', this.view.work)
  }

  /** Ends the rest now ("Go now"); the next fast segment starts. */
  skipRest() {
    if (this.stopped || this.view.phase !== 'rest') return
    this.play('fast', this.view.work)
  }

  private rest() {
    window.clearTimeout(this.timer)
    this.emit({ phase: 'rest', seg: 'fast', restLeft: REST_SEC, next: null, note: `Rest ${REST_SEC} s. Shake out your hands.` })
    const seg = this.seg
    this.timer = window.setTimeout(() => {
      if (seg === this.seg) this.skipRest()
    }, REST_SEC * 1000)
  }

  private play(kind: LoopSeg, sp: Speed) {
    if (this.stopped) return
    window.clearTimeout(this.timer)
    this.timer = 0
    const old = this.run
    this.seg++
    if (old) old.stop()
    const seg = this.seg
    const fast = kind === 'fast'
    const chart = fast ? this.chart : this.slowChart
    const run = new LessonRun({
      lesson: fast ? this.lesson : this.slowLesson,
      chart,
      speed: sp,
      easyTiming: this.opts.easyTiming,
      backingOn: this.opts.backingOn,
      keyboard: this.opts.keyboard,
      mic: this.opts.mic,
      autoplay: this.opts.autoplay,
    })
    this.run = run
    this.pausing = false
    this.resumeAt = null
    const n = this.perPass
    const eps = 1e-9
    const target = this.spec.targetSpeed
    const step = this.step
    const live = new Map<number, { good: number; judged: number }>() // the meter: verdicts as they come in
    const seen = new Set<number>() // results reported to the loop (a held match isn't final yet)
    const outcomes: boolean[] = [] // fast passes decided so far, in order (true = clean)
    let pending: Speed | 'done' | null = null
    let top = 0 // newest pass with a verdict
    let nextDecide = 0 // passes are decided, then closed, in order
    let nextClose = 0

    // Only passes that end by the run's (maybe moved) end count; a cut-off pass is dropped.
    const whole = (k: number) => (k + 1) * this.passBeats <= run.lastBeat + eps
    // sliceChart numbers events in beat order, so pass k holds ids k*n .. k*n+n-1.
    const ids = (k: number) => Array.from({ length: n }, (_, i) => k * n + i)
    const liveOf = (k: number) => ({ good: live.get(k)?.good ?? 0, judged: live.get(k)?.judged ?? 0, total: n })

    /** Final good results and not-good results in pass k. `final`: the run is over, every result stands. */
    const count = (k: number, final: boolean) => {
      let good = 0
      let bad = 0
      for (const id of ids(k)) {
        const r = final || seen.has(id) ? run.result(id) : undefined
        if (!r) {
          if (final) bad++
        } else if (!goodOrBetter(r)) bad++ // a post check only ever takes credit away
        else if (final || run.settled(id)) good++
      }
      return { good, bad }
    }

    const setPending = (k: number, p: Speed | 'done', note: string) => {
      pending = p
      this.resumeAt = p
      // End at the pass line; when that's already scheduled, at the next bar line, at worst after one more pass.
      const b0 = (k + 1) * this.passBeats
      for (let b = b0; b <= b0 + this.passBeats; b += 4) if (run.endAt(b)) break
      this.emit({ note, next: typeof p === 'number' ? p : null })
    }

    /** Fast segments: settles pass k as soon as its outcome is certain. False while it could still go either way. */
    const decide = (k: number, final: boolean): boolean => {
      if (!fast || pending !== null) return true
      const { good, bad } = count(k, final)
      let clean: boolean
      if (good >= CLEAN_ACC * n - eps) clean = true
      else if (n - bad < CLEAN_ACC * n - eps) clean = false
      else return false
      outcomes.push(clean)
      const d = decideFast(outcomes, sp, target, step)
      const got = outcomes.filter(Boolean).length
      const bpm = this.bpm(sp)
      if (d.earned) {
        this.reached = this.reached || d.next === 'done'
        this.emit({ earned: Math.max(this.view.earned, sp) })
      }
      if (d.next === 'done') setPending(k, 'done', `Clean at ${bpm} BPM. Locked in.`)
      else if (d.next !== null) {
        const nx = d.next
        const note = d.earned
          ? `Clean three times at ${bpm} BPM. Next: ${this.bpm(nx)} BPM.`
          : !outcomes[0]
            ? 'First pass not clean. One step slower.'
            : `${got} of ${EARN_PASSES} clean at ${bpm} BPM. Same tempo after a rest.`
        setPending(k, nx, note)
      } else {
        const left = EARN_PASSES - got
        this.emit({ note: clean ? `Clean. ${left} more clean at ${bpm} BPM earns it.` : `${got} of ${EARN_PASSES} clean at ${bpm} BPM. Keep going.` })
      }
      return true
    }

    /** Adds pass k to the dots once every result in it is final. */
    const close = (k: number, final: boolean): boolean => {
      if (!final && !ids(k).every((id) => seen.has(id) && run.settled(id))) return false
      const { good } = count(k, true)
      const acc = good / n
      const clean = acc >= CLEAN_ACC - eps
      const v = this.view
      for (const id of ids(k)) {
        const r = run.result(id)
        if (r) this.results.push(r)
      }
      const pass: LoopPass = fast ? { speed: sp, acc, clean } : { speed: sp, acc, clean, slow: true }
      this.emit({
        passes: [...v.passes, pass],
        clean: v.clean + (fast && clean ? 1 : 0),
        live: liveOf(Math.max(top, k + 1)),
      })
      return true
    }

    const advance = (final: boolean) => {
      while (whole(nextDecide) && decide(nextDecide, final)) nextDecide++
      while (nextClose < nextDecide && close(nextClose, final)) nextClose++
    }
    // A pause keeps passes that were already decided (their trailing results count as they stand).
    this.flush = () => {
      if (seg !== this.seg) return
      while (nextClose < nextDecide && close(nextClose, true)) nextClose++
    }

    run.onJudge = (r) => {
      if (seg !== this.seg || seen.has(r.eventId)) return
      const ev = chart.events[r.eventId]
      if (!ev || ev.beat >= run.lastBeat) return
      seen.add(r.eventId)
      const k = Math.floor(ev.beat / this.passBeats)
      const t = live.get(k) ?? { good: 0, judged: 0 }
      live.set(k, t)
      t.judged++
      if (goodOrBetter(r)) t.good++
      top = Math.max(top, k)
      this.onJudge?.(r, run)
      this.emit({ live: liveOf(top), last: r.verdict, vKey: this.view.vKey + 1 })
      advance(false)
    }
    run.onSettle = () => {
      if (seg === this.seg) advance(false)
    }
    run.onEnd = null
    run.onState = (s) => {
      if (seg !== this.seg) return
      if (s === 'countin' || s === 'playing') {
        this.calibrated = run.calibrated
        this.emit({ phase: s })
      } else if (s === 'stopped') {
        if (this.pausing) this.emit({ phase: 'paused' })
      } else if (s === 'ended') {
        advance(true) // every result is final now
        if (!fast) {
          this.rest()
          return
        }
        if (pending === 'done') {
          this.emit({ phase: 'done', next: null })
          return
        }
        // the work tempo for the next fast segment; first two slow, relaxed passes
        const nx = typeof pending === 'number' ? pending : sp
        const slow = slowSpeed(sp, step)
        this.emit({ phase: 'change', seg: 'slow', work: nx, next: nx, note: `Now ${SLOW_PASSES} slow, relaxed passes at ${this.bpm(slow)} BPM.` })
        this.timer = window.setTimeout(() => {
          if (seg === this.seg) this.play('slow', slow)
        }, CHANGE_MS)
      }
    }
    this.emit({
      phase: 'idle',
      seg: kind,
      speed: sp,
      next: null,
      live: { good: 0, judged: 0, total: this.perPass },
      work: fast ? sp : this.view.work,
      note: fast ? `${this.bpm(sp)} BPM: clean on the first pass, then two more.` : 'Slow and relaxed: these passes are just for feel.',
    })
    this.onRun?.(run)
    run.start().catch((err: unknown) => {
      console.error('Loop segment failed to start', err)
      if (seg !== this.seg) return
      this.seg++
      run.stop()
      this.emit({ phase: 'error' })
    })
  }

  /** After a pause or an error: the tempo a fast pass already decided (or the done card), else the work tempo. */
  resume() {
    if (this.stopped) return
    const p = this.resumeAt
    if (p === 'done') {
      window.clearTimeout(this.timer)
      this.timer = 0
      this.emit({ phase: 'done', next: null })
    } else this.start(p ?? this.view.work)
  }

  /** Stops the segment (or the rest); the unfinished pass is dropped. Resume with resume(). */
  pause() {
    if (this.stopped) return
    window.clearTimeout(this.timer)
    this.timer = 0
    const run = this.run
    const p = this.view.phase
    if (p === 'paused' || p === 'done' || p === 'error') return
    if (!run || run.state === 'ended' || run.state === 'stopped') {
      // between segments (the banner or the rest): nothing is playing
      this.seg++
      this.emit({ phase: 'paused' })
      return
    }
    this.flush?.()
    this.pausing = true
    run.stop()
    this.seg++
    if (this.view.phase !== 'paused') this.emit({ phase: 'paused' })
  }

  /** Final; idempotent. */
  stop() {
    if (this.stopped) return
    this.stopped = true
    window.clearTimeout(this.timer)
    this.timer = 0
    if (this.run && this.run.state !== 'ended' && this.run.state !== 'stopped') this.flush?.()
    this.seg++
    this.run?.stop()
  }

  summary(): LoopSummary | null {
    const passes = this.view.passes
    if (!passes.length) return null
    const clean = passes.filter((x) => x.clean && !x.slow)
    return {
      passes: [...passes],
      clean: clean.length,
      topSpeed: clean.reduce((m, x) => Math.max(m, x.speed), 0),
      reached: this.reached,
      earned: this.view.earned,
      results: [...this.results],
      chart: this.chart,
      calibrated: this.calibrated,
    }
  }

  private emit(patch: Partial<LoopView>) {
    this.view = { ...this.view, ...patch }
    this.onChange?.(this.view)
  }
}
