// "Hear your hardest bar": a lesson run on the guitar is taped (the processed sound, on the audio thread), and the
// result card plays that bar as you played it, then as written (the demo voice), back to back.
import { engine } from '../audio/engine'
import type { Chart, ChartEvent, Lesson } from './types'
import { STANDARD_TUNING } from '../music/theory'
import { LeadVoice } from './synth'

const ARP_SEC = 0.025 // a chord's strings, a little apart, as in listen mode
const GAP_SEC = 0.6 // between your bar and the written one

/**
 * Where bar `bar` (0-based, 4 beats) of a run is in the tape: the audio-clock times the beats were heard, plus the
 * round trip, since what you played on a beat reaches the tape that much later. A little lead-in and tail so the
 * first and last notes aren't clipped.
 */
export function barWindow(start: number, secPerBeat: number, bar: number, offSec: number, beatsPerBar = 4): { from: number; to: number } {
  const t0 = start + bar * beatsPerBar * secPerBeat + offSec
  return { from: t0 - 0.12, to: t0 + beatsPerBar * secPerBeat + 0.12 }
}

/** The chart's notes and chords that start in bar `bar`, with their beat inside the bar. */
export function barEvents(chart: Chart, bar: number, beatsPerBar = 4): { ev: ChartEvent; beat: number }[] {
  const from = bar * beatsPerBar
  return chart.events.filter((e) => e.beat >= from && e.beat < from + beatsPerBar).map((ev) => ({ ev, beat: ev.beat - from }))
}

// ---- The tape: the run's sound, collected on the audio thread -------------------------------------

const TAP = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; this.from = 0; this.port.onmessage = () => this.flush(); }
  flush() { if (this.n) { this.port.postMessage({ from: this.from, data: this.buf.slice(0, this.n) }); this.n = 0; } }
  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) return true;
    if (this.n === 0) this.from = currentFrame;
    this.buf.set(x, this.n); this.n += x.length;
    if (this.n + 128 > this.buf.length) this.flush();
    return true;
  }
}
registerProcessor('run-tap', Tap);
`
const tapLoaded = new WeakMap<BaseAudioContext, Promise<void>>()

export class RunTape {
  private node: AudioWorkletNode | null = null
  private chunks: { from: number; data: Float32Array }[] = []
  private rate = 48000
  private source: AudioNode | null = null

  async start(ctx: AudioContext, source: AudioNode) {
    if (!tapLoaded.has(ctx)) {
      const url = URL.createObjectURL(new Blob([TAP], { type: 'application/javascript' }))
      tapLoaded.set(ctx, ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)))
    }
    await tapLoaded.get(ctx)
    this.rate = ctx.sampleRate
    const n = new AudioWorkletNode(ctx, 'run-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' })
    n.port.onmessage = (e: MessageEvent<{ from: number; data: Float32Array }>) => this.chunks.push(e.data)
    source.connect(n)
    this.node = n
    this.source = source
  }

  stop() {
    const n = this.node
    if (!n) return
    n.port.postMessage('flush')
    // The last chunk arrives a moment later; then the tap is let go.
    window.setTimeout(() => {
      this.source?.disconnect(n)
      n.port.onmessage = null
    }, 300)
    this.node = null
  }

  /** The sound between two audio-clock times, or null when the tape doesn't cover them. */
  segment(from: number, to: number): Float32Array | null {
    const a = Math.round(from * this.rate)
    const b = Math.round(to * this.rate)
    if (b <= a || !this.chunks.length || this.chunks[0].from > a) return null
    const out = new Float32Array(b - a)
    let got = 0
    for (const c of this.chunks) {
      const s = Math.max(a, c.from)
      const e = Math.min(b, c.from + c.data.length)
      if (e > s) {
        out.set(c.data.subarray(s - c.from, e - c.from), s - a)
        got += e - s
      }
    }
    return got > 0.8 * (b - a) ? out : null
  }
}

// ---- The latest run's tape, for its result card --------------------------------------------------

export interface RunReplay {
  lessonId: string
  tape: RunTape
  start: number // audio time of the chart's first beat
  secPerBeat: number
  offSec: number
}

let latest: RunReplay | null = null
export const setLatestReplay = (r: RunReplay | null) => (latest = r)
export const replayFor = (lessonId: string) => (latest?.lessonId === lessonId ? latest : null)

/** Plays bar `bar` as you played it, then as written. Resolves when both are done. */
export async function playBar(r: RunReplay, lesson: Lesson, chart: Chart, bar: number): Promise<boolean> {
  const ctx = await engine.ensureContext()
  const w = barWindow(r.start, r.secPerBeat, bar, r.offSec)
  const mine = r.tape.segment(w.from, w.to)
  if (!mine) return false
  const buf = ctx.createBuffer(1, mine.length, ctx.sampleRate)
  buf.copyToChannel(mine as Float32Array<ArrayBuffer>, 0)
  const t = ctx.currentTime + 0.1
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start(t)
  // The bar as written, after a short gap, on the same beat grid.
  const written = t + buf.duration + GAP_SEC + 0.12
  const lead = new LeadVoice(ctx)
  const open = lesson.tuning ?? STANDARD_TUNING
  for (const { ev, beat } of barEvents(chart, bar)) {
    const at = written + beat * r.secPerBeat
    if (ev.kind === 'note') lead.note(at, ev.midi, ev.dur * r.secPerBeat)
    else if (ev.kind === 'chord') {
      const strings = ev.frets.map((f, s) => (f >= 0 ? open[s] + f : -1)).filter((m) => m >= 0)
      strings.forEach((m, i) => lead.note(at + i * ARP_SEC, m, ev.dur * r.secPerBeat, 0.7))
    }
  }
  const total = (written - ctx.currentTime + 4 * r.secPerBeat + 0.3) * 1000
  await new Promise((res) => window.setTimeout(res, total))
  return true
}
