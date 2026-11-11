// One play-through of a lesson: clock, band, input, judging and the end result.
// The constructor is pure (LessonIntro uses it for previews); start() does all the side effects.
import type { Autoplay, BackingSpec, ChartEvent, Chart, InputFrame, InputOnset, JudgeResult, KeyName, Lesson, LessonResult, LiveHud, PlayedNote, RunState, Speed } from './types'
import { engine } from '../audio/engine'
import { BackingBand } from '../audio/backing'
import type { BackingPart } from '../audio/backing'
import { FEELS, keysVoicing } from '../music/parts'
import type { Feel, KeysVoicing } from '../music/parts'
import { STANDARD_TUNING, parseChord } from '../music/theory'
import type { Chord, FretPos } from '../music/theory'
import { boxNotes, makePhrase } from '../music/phrase'
import { buildChart } from './charts'
import { AudioClock, LessonClock, swungBeat } from './clock'
import type { Tick } from './clock'
import { LessonInput } from './input'
import { KEYBOARD_DEVICE, defaultKeyOffsetMs, defaultOffsetMs, deviceKey, loadLatency } from './calibration'
import { readChroma } from './chroma'
import { LeadVoice } from './synth'
import { Judge, STRUM_SHIFT_MS, voteMidi, windowsFor } from './judge'
import { ChainMeter, buildResult } from './scoring'
import { TechSpotter, analyseImprov, chordPcs, noteKind, scalePcsOf } from './improv'

const END_PAD_SEC = 0.4
const END_GUARD_SEC = 0.2 // endAt(): a beat closer than this is already scheduled (lookahead 0.12 s)
const VOTE_SEC = 0.1
const ARP_SEC = 0.025 // listen mode: per-string delay of a strummed chord
const PLAYED_KEPT = 64
const SLOPPY_JITTER = 0.14
const SLOPPY_WRONG = 0.15
const SLOPPY_SKIP = 0.1
const BAND_GAIN = 0.7 // BackingBand's own output level; lesson.backing.level scales it
const ALL_PARTS: Record<BackingPart, boolean> = { drums: true, bass: true, keys: true }

export interface RunOpts {
  lesson: Lesson
  speed: Speed
  easyTiming: boolean
  backingOn: boolean
  keyboard: boolean
  mic?: boolean // a microphone source: room noise needs a firmer attack before it counts
  listen?: boolean // demo playback by LeadVoice, no judging, no result
  autoplay?: Autoplay | null
  chart?: Chart // a prepared chart (loops); default buildChart(lesson)
  shuffle?: boolean // shuffle mode: a straight lesson swung (blues band), practice only
  bandLevel?: number // band volume multiplier (listen mode), default 1
}

type Played = { beat: number; midi: number; kind: 'chord' | 'scale' | 'out' }

/** DEV only: ?lessons-autoplay=perfect|sloppy|silent */
export function autoplayFromUrl(): Autoplay | null {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null
  const v = new URLSearchParams(location.search).get('lessons-autoplay')
  return v === 'perfect' || v === 'sloppy' || v === 'silent' ? v : null
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export class LessonRun {
  readonly lesson: Lesson
  readonly chart: Chart
  readonly bpm: number
  readonly secPerBeat: number
  /** Judged, drawn and played on the swung grid: shuffle mode, or a band feel that swings. */
  readonly swing: boolean
  state: RunState = 'idle'
  hud: LiveHud = { chain: 0, bestChain: 0, roar: false, points: 0, last: null, lastPlayed: null, bend: null }
  calibrated = false
  played: Played[] = []
  onJudge: ((r: JudgeResult, milestone: string | null) => void) | null = null
  onEnd: ((r: LessonResult) => void) | null = null
  /** A reported result's post checks are done (loops wait for it before calling a pass clean). */
  onSettle: ((eventId: number) => void) | null = null
  onState: ((s: RunState) => void) | null = null

  private opts: RunOpts
  private aclock: AudioClock | null = null
  private clock: LessonClock | null = null
  private input: LessonInput | null = null
  private judge: Judge | null = null
  private chain = new ChainMeter()
  private spotter: TechSpotter | null = null
  private lead: LeadVoice | null = null
  private band: BackingBand | null = null
  private offSec = 0
  private useEngine = false
  private raf = 0
  private chromaBuf = new Float32Array(12)
  private autoQueue: { t: number; midi: number | null }[] = []
  private improvQueue: InputOnset[] = []
  private improvFrames: InputFrame[] = []
  private improvNotes: PlayedNote[] = []
  private box: FretPos[] = []
  private scalePcs: number[] = []
  private listenBars = new Set<number>()
  private endBeat = Infinity

  constructor(o: RunOpts) {
    this.opts = o
    this.lesson = o.lesson
    this.bpm = Math.round(o.lesson.bpm * o.speed)
    this.secPerBeat = 60 / this.bpm
    this.chart = o.chart ?? buildChart(o.lesson)
    const backing = o.lesson.backing
    this.swing = !!o.shuffle || (!!backing && !!FEELS[backing.feel]?.swing)
  }

  /** The band's feel: in shuffle mode a straight lesson borrows the blues shuffle. */
  private feel(): Feel | null {
    const b = this.lesson.backing
    if (!b) return null
    const own = FEELS[b.feel]
    return this.opts.shuffle && !own?.swing ? FEELS.blues : own
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return
    const o = this.opts
    const lesson = this.lesson
    const ctx = await engine.ensureContext()
    if ((this.state as RunState) !== 'idle') return // stopped while waiting
    const listen = !!o.listen
    const autoplay = listen ? null : o.autoplay !== undefined ? o.autoplay : autoplayFromUrl()
    const keyboardMode = o.keyboard || !engine.running
    const useEngine = engine.running && !keyboardMode && !autoplay && !listen
    this.useEngine = useEngine

    // The run's one offset: every input time and the judge clock are corrected by it.
    // calibrated = a saved calibration was used on real input; fake input (autoplay, listen) never counts,
    // so fun lines and heat never read early/late from it. The judge still gets tight windows for it.
    let offMs = 0
    let pitchLagMs = 35
    const exact = !!autoplay || listen // injected times are exact: no offset
    this.calibrated = false
    if (exact) {
      offMs = 0
    } else if (keyboardMode) {
      const cal = loadLatency(KEYBOARD_DEVICE)
      offMs = cal?.offsetMs ?? defaultKeyOffsetMs()
      this.calibrated = !!cal
    } else {
      const cal = loadLatency(deviceKey())
      offMs = cal ? cal.offsetMs : defaultOffsetMs()
      pitchLagMs = cal ? cal.pitchLagMs : 35
      this.calibrated = !!cal
    }
    this.offSec = offMs / 1000

    const spb = this.secPerBeat
    const improv = lesson.type === 'improv' && lesson.improv ? lesson.improv : null
    if (improv) {
      this.scalePcs = scalePcsOf(improv)
      this.box = boxNotes(this.scalePcs, [], improv.boxFret)
      this.spotter = new TechSpotter()
    }
    this.aclock = new AudioClock(ctx)
    this.lead = new LeadVoice(ctx)
    const backing = lesson.backing
    const bandOn = !!backing && o.backingOn
    if (backing && o.backingOn) {
      this.band = new BackingBand(ctx, ctx.destination)
      // listen mode lifts the band above its usual level; the total stays at or under unity gain
      this.band.setVolume(Math.min(1, BAND_GAIN * (backing.level ?? 1) * (o.bandLevel ?? 1)))
    }
    this.listenBars = new Set(this.chart.listenBars)
    const chords: (Chord | null)[] = backing ? backing.chords.map((s) => parseChord(s)) : []
    const voicings: (KeysVoicing | null)[] = []
    let prev: number[] | null = null
    for (const c of chords) {
      const v: KeysVoicing | null = c ? keysVoicing(c, prev) : null
      if (v) prev = v.right
      voicings.push(v)
    }
    this.clock = new LessonClock()
    this.clock.run(ctx, {
      bpm: this.bpm,
      countInBeats: lesson.countInBeats ?? 4,
      totalBeats: this.chart.totalBeats,
      swing: this.swing,
      // The click fills in whenever no band plays (no backing, or the Band switch is off).
      click: lesson.click ?? !bandOn,
      onTick: (k) => this.onTick(k, chords, voicings, listen),
    })

    if (!listen) {
      const minGapSec = this.chart.minGapBeats * spb
      this.input = new LessonInput({
        clock: this.aclock,
        offsetMs: offMs,
        pitchLagMs,
        onsetRatio: (lesson.type === 'chords' || lesson.type === 'rhythm' ? 1.4 : 1.6) + (o.mic ? 0.2 : 0),
        absRms: o.mic ? 0.004 : undefined,
        refractoryMs: Number.isFinite(minGapSec) ? clamp(0.45 * minGapSec * 1000, 40, 90) : 90,
        strums: this.chart.events.some((e) => e.kind === 'chord' || e.kind === 'mute'),
        keyboard: keyboardMode,
        useEngine,
      })
      if (!improv) {
        const input = this.input
        this.judge = new Judge(this.chart, {
          start: this.clock.start,
          secPerBeat: spb,
          windows: windowsFor(lesson.timing, o.easyTiming, exact || this.calibrated),
          octaveOk: !!lesson.octaveOk,
          restGate: () => input.peakMedian(),
          listenBars: this.chart.listenBars,
          swing: this.swing,
        })
      }
      this.input.onOnset((on) => this.handleOnset(on))
      this.input.onFrame((f) => this.handleFrame(f))
      this.input.setKeyHint((t, key) => this.keyHint(t, key))
      this.input.start()
      if (autoplay) this.autoQueue = this.planAutoplay(autoplay)
    }

    if (import.meta.env.DEV) {
      const clock = this.clock
      const w = window as unknown as { __fretwiseLessons?: unknown }
      w.__fretwiseLessons = {
        run: this,
        inject: (midi: number | null, beat: number) => this.input?.inject({ t: clock.timeOfBeat(swungBeat(beat, this.swing)), midi, source: 'auto' }),
      }
    }

    this.setState('countin')
    this.raf = requestAnimationFrame(this.loop)
  }

  /** Stopped by the user or unmount: no result. Idempotent. */
  stop() {
    this.band?.stop() // silent at once, also notes scheduled ahead
    this.release()
    if (this.state !== 'ended' && this.state !== 'stopped') this.setState('stopped')
  }

  /** Corrected audio time: what the judge and analysers line up with. */
  now(): number {
    return this.aclock ? this.aclock.now() - this.offSec : 0
  }

  /** Beat to draw at, from the uncorrected clock minus the output delay, plus the display nudge. */
  visualBeat(nudgeMs: number): number {
    if (!this.aclock || !this.clock) return -(this.lesson.countInBeats ?? 4)
    return this.clock.beatAt(this.aclock.now() - engine.latencyMs / 1000 + nudgeMs / 1000)
  }

  result(id: number): JudgeResult | undefined {
    return this.judge?.results.get(id)
  }

  /** The result for `id` is reported and final (no post check still to run). */
  settled(id: number): boolean {
    return this.state === 'ended' ? this.judge?.results.has(id) === true : this.judge?.settled(id) === true
  }

  pendingEvent(): ChartEvent | null {
    return this.judge ? this.judge.pending(this.now()) : null
  }

  /** Where the run ends: the chart's end, or earlier after endAt(). */
  get lastBeat(): number {
    return Math.min(this.endBeat, this.chart.totalBeats)
  }

  /** Loops: end the run at `beat` (a pass boundary) instead of the chart's end.
   *  False when that beat is already scheduled or isn't earlier than the current end. */
  endAt(beat: number): boolean {
    if (!this.clock || !this.aclock || beat >= this.lastBeat) return false
    if (this.clock.timeOfBeat(beat) - END_GUARD_SEC < this.aclock.now()) return false
    this.endBeat = beat
    this.clock.limit(beat)
    return true
  }

  /**
   * Jams: end right now with a result for the bars played so far, instead of stopping with nothing.
   * False (and nothing happens) unless a jam is playing and at least `minBeats` of it were played.
   */
  endNow(minBeats: number): boolean {
    if (this.state !== 'playing' || !this.clock || !this.spotter) return false
    const now = this.now()
    const bars = Math.floor(this.clock.beatAt(now) / 4)
    if (bars * 4 < minBeats || bars * 4 >= this.lastBeat) return false
    this.endBeat = bars * 4
    this.band?.stop()
    this.end(now)
    return true
  }

  /** The chart up to where the run ended early (whole bars), so a shortened jam is scored on what was played. */
  private playedChart(): Chart {
    const c = this.chart
    if (this.lastBeat >= c.totalBeats) return c
    const bars = Math.max(1, Math.floor(this.lastBeat / 4))
    const cut: Chart = {
      ...c,
      bars,
      totalBeats: bars * 4,
      calls: c.calls.filter((x) => x.beat < bars * 4),
      listenBars: c.listenBars.filter((b) => b < bars),
      chordTimeline: c.chordTimeline.slice(0, bars),
    }
    if (c.improvBars) cut.improvBars = c.improvBars.filter((x) => x.bar < bars)
    return cut
  }

  // ---- internals ----

  private setState(s: RunState) {
    this.state = s
    this.onState?.(s)
  }

  private release() {
    this.clock?.stop()
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.input?.stop()
    this.lead?.stopAll()
    this.band = null // no further playStep; at the natural end the last notes ring out
    this.autoQueue = []
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const w = window as unknown as { __fretwiseLessons?: { run?: unknown } }
      if (w.__fretwiseLessons?.run === this) delete w.__fretwiseLessons
    }
  }

  private beatAt(t: number) {
    return this.clock ? this.clock.beatAt(t) : 0
  }

  private onTick(k: Tick, chords: (Chord | null)[], voicings: (KeysVoicing | null)[], listen: boolean) {
    if (k.beat < 0 || k.beat >= this.lastBeat) return
    const spb = this.secPerBeat
    const bar = Math.floor(k.beat / 4)
    const backing = this.lesson.backing
    const feel = this.feel()
    if (this.band && backing && feel && chords.length) {
      const i = bar % chords.length
      const c = chords[i]
      const v = voicings[i]
      const parts = this.partsFor(backing, bar)
      if (c && v && parts) this.band.playStep(k.t, k.step, 30 / this.bpm, c, feel, v, parts)
    }
    const lead = this.lead
    if (!lead) return
    const inThis = (beat: number) => beat >= k.beat && beat < k.beat + 0.5
    for (const c of this.chart.calls) {
      if (inThis(c.beat)) lead.note(k.t + (c.beat - k.beat) * spb, c.midi, c.dur * spb)
    }
    if (!listen) return
    for (const e of this.chart.events) {
      if (!inThis(e.beat)) continue
      const t = k.t + (e.beat - k.beat) * spb
      if (e.kind === 'note') lead.note(t, e.midi, e.dur * spb)
      else if (e.kind === 'chord') {
        const strings = e.frets.map((f, s) => (f >= 0 ? STANDARD_TUNING[s] + f : -1)).filter((m) => m >= 0)
        if (e.dir === 'U') strings.reverse()
        strings.forEach((m, i) => lead.note(t + i * ARP_SEC, m, e.dur * spb, 0.7))
      }
    }
  }

  /** Band parts for one bar: the lesson's parts, thinned out in listen bars when the lesson asks. null = band rests. */
  private partsFor(b: BackingSpec, bar: number): Record<BackingPart, boolean> | null {
    const p = b.parts ? { drums: !!b.parts.drums, bass: !!b.parts.bass, keys: !!b.parts.keys } : ALL_PARTS
    if (!this.listenBars.has(bar)) return p
    const mode = b.onListen ?? 'all'
    if (mode === 'none') return null
    return mode === 'drums' ? { drums: p.drums, bass: false, keys: false } : p
  }

  private handleOnset(on: InputOnset) {
    if (on.source === 'auto') this.calibrated = false // a DEV inject into a real run: its timing is fake too
    this.judge?.onset(on)
    if (this.spotter) {
      this.spotter.onset(on, this.beatAt(on.t))
      if (on.source !== 'glide') this.improvQueue.push(on)
    }
  }

  private handleFrame(f: InputFrame) {
    this.judge?.frame(f)
    if (this.spotter) {
      this.spotter.frame(f, this.beatAt(f.t))
      this.improvFrames.push(f)
      while (this.improvFrames.length && this.improvFrames[0].t < f.t - 2) this.improvFrames.shift()
    }
  }

  private loop = () => {
    if (this.state === 'stopped' || this.state === 'ended' || !this.clock) return
    this.raf = requestAnimationFrame(this.loop)
    const now = this.now()
    if (this.state === 'countin' && this.clock.beatAt(now) >= 0) this.setState('playing')

    // Autoplay: inject each planned onset once its time has come, at its exact time.
    while (this.autoQueue.length && this.autoQueue[0].t <= now) {
      const a = this.autoQueue.shift()!
      this.input?.inject({ t: a.t, midi: a.midi, source: 'auto' })
    }

    if (this.judge) {
      for (const r of this.judge.tick(now)) {
        const m = this.chain.push(r, now)
        this.syncHud(r)
        this.onJudge?.(r, m)
      }
      for (const id of this.judge.takeSettled()) this.onSettle?.(id)
      const ids = this.judge.chromaWindows(now)
      // only a live guitar run reads chroma: an idle interface must not grade key or auto runs
      if (this.useEngine && ids.length && readChroma(this.chromaBuf)) this.judge.addChroma(ids, this.chromaBuf)
      this.hud.bend = this.judge.bendProgress(now)
    }
    if (this.spotter) this.processImprov(now)

    if (now > this.clock.timeOfBeat(this.lastBeat) + END_PAD_SEC) this.end(now)
  }

  private syncHud(r: JudgeResult) {
    const h = this.hud
    h.chain = this.chain.chain
    h.bestChain = this.chain.best
    h.roar = this.chain.roar
    h.points = this.chain.points
    h.last = r.verdict
    if (r.played !== undefined && r.played !== null) h.lastPlayed = r.played
  }

  private processImprov(now: number) {
    while (this.improvQueue.length) {
      const o = this.improvQueue[0]
      const instant = o.source === 'key' || o.source === 'auto'
      if (!instant && o.t + VOTE_SEC > now) break
      this.improvQueue.shift()
      const { midi } = voteMidi(this.improvFrames, o)
      if (midi === null) continue
      const beat = this.beatAt(o.t)
      this.improvNotes.push({ t: o.t, beat, midi, legato: o.source === 'pitch' })
      this.played.push({ beat, midi, kind: noteKind(midi, this.chordAt(beat) || null, this.scalePcs) })
      if (this.played.length > PLAYED_KEPT) this.played.shift()
      this.hud.lastPlayed = midi
    }
  }

  private chordAt(beat: number): string {
    const tl = this.chart.chordTimeline
    if (!tl.length) return ''
    return tl[clamp(Math.floor(beat / 4), 0, tl.length - 1)].symbol
  }

  private end(now: number) {
    const lesson = this.lesson
    const listen = !!this.opts.listen
    let result: LessonResult | null = null
    if (!listen) {
      const summary = this.judge ? this.judge.finish() : null
      this.chain.end(now)
      if (this.spotter) this.processImprov(Infinity)
      const chart = this.spotter ? this.playedChart() : this.chart
      const improv = lesson.improv && this.spotter ? analyseImprov(lesson.improv, chart, this.improvNotes, this.spotter.hits, this.swing) : null
      result = buildResult({
        lesson,
        chart,
        summary,
        improv,
        chain: this.chain,
        bpm: this.bpm,
        speed: this.opts.speed,
        easyTiming: this.opts.easyTiming,
        secPerBeat: this.secPerBeat,
        playedSec: this.lastBeat * this.secPerBeat,
        calibrated: this.calibrated,
        swing: this.swing,
        shuffle: !!this.opts.shuffle,
      })
    }
    this.release()
    this.setState('ended')
    if (result) this.onEnd?.(result)
  }

  // ---- keyboard and autoplay ----

  private keyHint(t: number, key: KeyName): number | null {
    if (this.lesson.type === 'improv') {
      const box = this.box
      if (!box.length) return null
      if (key === 'hit') return box[Math.floor(Math.random() * box.length)].midi
      if (key[0] === 's') return box[(Number(key.slice(1)) - 1) % box.length].midi
      return null
    }
    const ev = this.judge?.pending(t) ?? null
    if (ev && ev.kind === 'chord' && ev.power && key === 'hit') {
      // same root the autoplay plan sends, so a power chord can get full credit
      const s = ev.frets.findIndex((f) => f >= 0)
      return s >= 0 ? STANDARD_TUNING[s] + ev.frets[s] : null
    }
    if (!ev || ev.kind !== 'note') return null
    if (key === 'hit') return ev.midi
    if (key === 'wrong') return ev.midi + 1
    if (key[0] === 's') {
      const s = 6 - Number(key.slice(1))
      return ev.string === s ? ev.midi : STANDARD_TUNING[s]
    }
    return null
  }

  private planAutoplay(mode: Autoplay): { t: number; midi: number | null }[] {
    if (mode === 'silent' || !this.clock) return []
    const clock = this.clock
    const plan: { t: number; midi: number | null }[] = []
    const improv = this.lesson.improv
    if (this.lesson.type === 'improv' && improv) {
      // Scale phrases of 3–5 eighths with a beat's rest between, never in call bars.
      const listen = new Set(this.chart.listenBars)
      const total = this.chart.totalBeats
      let b = 0
      while (b < total) {
        const bar = Math.floor(b / 4)
        if (listen.has(bar)) {
          b = (bar + 1) * 4
          continue
        }
        const n = 3 + Math.floor(Math.random() * 3)
        const phrase = makePhrase(this.box, this.scalePcs, chordPcs(this.chordAt(b)), improv.endPcs ?? [improv.key], n)
        let i = 0
        for (; i < phrase.length; i++) {
          const nb = b + i * 0.5
          if (nb >= total || listen.has(Math.floor(nb / 4))) break
          plan.push({ t: clock.timeOfBeat(swungBeat(nb, this.swing)), midi: phrase[i].midi })
        }
        b += Math.max(1, i) * 0.5 + 1
      }
      return plan
    }
    const sloppy = mode === 'sloppy'
    for (const e of this.chart.events) {
      if (e.kind === 'rest') continue
      if (sloppy && Math.random() < SLOPPY_SKIP) continue
      let t = clock.timeOfBeat(swungBeat(e.beat, this.swing))
      let midi: number | null = null
      if (e.kind === 'note') midi = e.midi
      else if (e.kind === 'chord' && e.power) {
        const s = e.frets.findIndex((f) => f >= 0)
        midi = s >= 0 ? STANDARD_TUNING[s] + e.frets[s] : null
      }
      if (e.kind !== 'note') t -= STRUM_SHIFT_MS / 1000
      if (sloppy) {
        t += (Math.random() * 2 - 1) * SLOPPY_JITTER
        if (midi !== null && Math.random() < SLOPPY_WRONG) midi += 1
      }
      plan.push({ t, midi })
    }
    return plan.sort((a, b) => a.t - b.t)
  }
}
