// Loop the hard part: a few bars (or a generated drill) over and over, a little faster after each clean pass.
// No React. A loop is a chain of LessonRun segments, one per speed; passes inside a segment run back to back.
import type { Autoplay, Chart, ChartEvent, JudgeResult, Lesson, LessonResult, LoopPass, LoopSpec, LoopSummary, Progress, Speed, Verdict } from './types'
import { buildChart } from './charts'
import { LessonRun } from './run'
import { goodOrBetter } from './scoring'
import { FULL_SPEED, pct, snapSpeed } from './speed'

export const LOOP_REPS = 8 // passes per segment
export const CLEAN_ACC = 0.9
export const LOOP_STEP = 0.05 // speed step after a clean pass
export const LOOP_START_SHARE = 0.7 // a bars loop starts at 70% of the run's speed
export const MAX_LOOP_BARS = 4
export const LOOP_MIN_SPEED = 0.5 // loops may go under the lesson floor (MIN_SPEED): the player just struggled there
const FAR_UNDER = 0.8 // a run under this speed aims the loop at a nearer target than full speed
const EASE_AFTER = 3 // passes in a row under EASE_ACC ease the speed off one step
const EASE_ACC = 0.6
const CHANGE_MS = 900 // the "Faster" banner between segments

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
 * A bars loop from a result card: starts at 70% of the run's speed (at least a step under it), ends at the
 * lesson's tempo. A run far under full speed aims a few steps above it instead.
 */
export function loopSpecFor(lesson: Lesson, r: LessonResult, from: number, to: number): LoopSpec {
  const range = withCalls(buildChart(lesson), from, to)
  const start = clamp(snapSpeed(Math.min(r.speed * LOOP_START_SHARE, r.speed - 2 * LOOP_STEP)), LOOP_MIN_SPEED, FULL_SPEED)
  const target = r.speed >= FAR_UNDER ? FULL_SPEED : clamp(snapSpeed(Math.max(r.speed + 2 * LOOP_STEP, start + 6 * LOOP_STEP)), start, FULL_SPEED)
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

/** A loop with a clean pass counts once on the lesson's record. Nothing else changes. */
export function recordLoop(p: Progress, lessonId: string, s: LoopSummary): Progress {
  if (s.clean === 0 || !p.lessons[lessonId]) return p
  const next = JSON.parse(JSON.stringify(p)) as Progress
  const rec = next.lessons[lessonId]
  rec.loops = (rec.loops ?? 0) + 1
  rec.loopTop = Math.max(rec.loopTop ?? 0, s.topSpeed)
  return next
}

// ---- Session ----------------------------------------------------------------

export interface LoopView {
  phase: 'idle' | 'countin' | 'playing' | 'change' | 'done' | 'paused' | 'error'
  speed: Speed // current segment
  next: Speed | null // decided speed for the next segment, shown in the banner
  passes: LoopPass[]
  clean: number
  live: { good: number; judged: number; total: number } // the pass being played now
  last: Verdict | null // last verdict, for the pop
  vKey: number
  note: string | null // banner line
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
  readonly chart: Chart
  readonly lesson: Lesson
  run: LessonRun | null
  view: LoopView
  onChange: ((v: LoopView) => void) | null
  onRun: ((r: LessonRun) => void) | null
  onJudge: ((r: JudgeResult, run: LessonRun) => void) | null

  private opts: LoopOpts
  private passBeats: number
  private perPass: number
  private results: JudgeResult[]
  private calibrated: boolean
  private bad: number
  private seg: number // segment token: callbacks of an old run are ignored
  private timer: number
  private pausing: boolean
  private stopped: boolean
  private resumeAt: Speed | 'done' | null // what a pass in this segment already decided; kept over a pause
  private flush: (() => void) | null // closes the segment's decided passes

  constructor(spec: LoopSpec, o: LoopOpts) {
    this.spec = spec
    this.opts = o
    this.chart = sliceChart(buildChart(spec.lesson), spec.fromBar, spec.toBar, LOOP_REPS)
    this.lesson = loopLesson(spec.lesson, spec.fromBar, spec.toBar, LOOP_REPS)
    this.passBeats = 4 * (spec.toBar - spec.fromBar + 1)
    this.perPass = this.chart.events.filter((e) => e.beat < this.passBeats).length
    this.run = null
    this.view = {
      phase: 'idle',
      speed: spec.startSpeed,
      next: null,
      passes: [],
      clean: 0,
      live: { good: 0, judged: 0, total: this.perPass },
      last: null,
      vKey: 0,
      note: null,
    }
    this.onChange = null
    this.onRun = null
    this.onJudge = null
    this.results = []
    this.calibrated = false
    this.bad = 0
    this.seg = 0
    this.timer = 0
    this.pausing = false
    this.stopped = false
    this.resumeAt = null
    this.flush = null
  }

  /** A new segment at `speed` (one-bar count-in). */
  start(speed?: Speed) {
    if (this.stopped) return
    window.clearTimeout(this.timer)
    this.timer = 0
    const old = this.run
    this.seg++
    if (old) old.stop()
    const seg = this.seg
    const sp = speed ?? this.view.speed
    if (this.view.phase === 'done') this.bad = 0
    const run = new LessonRun({
      lesson: this.lesson,
      chart: this.chart,
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
    const live = new Map<number, { good: number; judged: number }>() // the meter: verdicts as they come in
    const seen = new Set<number>() // results reported to the loop (a held match isn't final yet)
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

    /** Settles the next speed as soon as pass k's outcome is certain. False while it could still go either way. */
    const decide = (k: number, final: boolean): boolean => {
      if (pending !== null) return true
      const { good, bad } = count(k, final)
      const target = this.spec.targetSpeed
      if (good >= CLEAN_ACC * n - eps) {
        this.bad = 0
        if (sp >= target - 1e-6) setPending(k, 'done', `Clean at ${pct(target)}. Locked in.`)
        else {
          const nx = Math.min(target, snapSpeed(sp + LOOP_STEP))
          setPending(k, nx, `Clean! Next: ${pct(nx)}`)
        }
        return true
      }
      if (n - bad >= CLEAN_ACC * n - eps) return false // could still be clean
      const sloppy = n - bad < EASE_ACC * n - eps
      if (!sloppy && good < EASE_ACC * n - eps) return false
      this.bad = sloppy ? this.bad + 1 : 0
      if (this.bad >= EASE_AFTER && sp > LOOP_MIN_SPEED + 1e-6) {
        this.bad = 0
        const nx = Math.max(LOOP_MIN_SPEED, snapSpeed(sp - LOOP_STEP))
        setPending(k, nx, `Easing off to ${pct(nx)}`)
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
      this.emit({
        passes: [...v.passes, { speed: sp, acc, clean }],
        clean: v.clean + (clean ? 1 : 0),
        note: pending === null ? `${Math.round(acc * 100)}% clean. 90% moves it up.` : v.note,
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
      const ev = this.chart.events[r.eventId]
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
        if (pending === 'done') this.emit({ phase: 'done', next: null })
        else if (typeof pending === 'number') {
          const nx = pending
          this.emit({ phase: 'change', next: nx })
          this.timer = window.setTimeout(() => this.start(nx), CHANGE_MS)
        } else this.start(sp)
      }
    }
    this.emit({ phase: 'idle', speed: sp, next: null, live: { good: 0, judged: 0, total: this.perPass } })
    this.onRun?.(run)
    run.start().catch((err: unknown) => {
      console.error('Loop segment failed to start', err)
      if (seg !== this.seg) return
      this.seg++
      run.stop()
      this.emit({ phase: 'error' })
    })
  }

  /** After a pause or an error: the speed a clean pass already earned (or the done card), else the same speed. */
  resume() {
    if (this.stopped) return
    const p = this.resumeAt
    if (p === 'done') {
      window.clearTimeout(this.timer)
      this.timer = 0
      this.emit({ phase: 'done', next: null })
    } else this.start(p ?? this.view.speed)
  }

  /** Stops the segment; the unfinished pass is dropped. Resume with resume(). */
  pause() {
    if (this.stopped) return
    window.clearTimeout(this.timer)
    this.timer = 0
    const run = this.run
    const p = this.view.phase
    if (p === 'paused' || p === 'done' || p === 'error') return
    if (!run || run.state === 'ended' || run.state === 'stopped') {
      // between segments (the "Faster" banner): nothing is playing
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
    const target = this.spec.targetSpeed
    const clean = passes.filter((x) => x.clean)
    return {
      passes: [...passes],
      clean: clean.length,
      topSpeed: clean.reduce((m, x) => Math.max(m, x.speed), 0),
      reached: clean.some((x) => x.speed >= target - 1e-6),
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
