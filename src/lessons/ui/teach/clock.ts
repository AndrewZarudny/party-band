// The demo loop's clock, shared by the hand and pick demos, and its optional sound.
import type { Chart, ChartFingering } from '../../types'
import { firstPhrase } from '../../fingering'
import { STANDARD_TUNING } from '../../../music/theory'
import type { LeadVoice } from '../../synth'
import { loopBeat, stepsOf } from './phrase'
import type { Step } from './phrase'

const START_SEC = 0.3 // breath before the first pass
const AHEAD_SEC = 0.2 // lead voice look-ahead

/** Loops the first phrase at a set tempo with one beat of silence between passes. */
export class DemoClock {
  readonly from: number
  readonly to: number
  readonly spb: number
  readonly steps: Step[]
  private t0 = -1
  private ctx: AudioContext | null = null
  private sent = new Map<number, Set<string>>() // pass -> step ids already on the lead voice

  constructor(chart: Chart, fingering: ChartFingering, bpm: number) {
    const p = firstPhrase(chart)
    this.from = p.from
    this.to = p.to
    this.spb = 60 / bpm
    this.steps = stepsOf(chart, fingering, p.from, p.to)
  }

  get len() {
    return this.to - this.from + 1
  }

  /** Audio time when sound is on (so notes and pictures agree), else performance time. */
  private now(): number {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000
  }

  /** Switch the time source; the loop starts again from the top. */
  setAudio(ctx: AudioContext | null) {
    this.ctx = ctx
    this.t0 = -1
    this.sent.clear()
  }

  /** The chart beat now: from..to is the phrase, to..to+1 the silence. Before the first pass it counts up to `from`. */
  beat = (): number => {
    const now = this.now()
    if (this.t0 < 0) this.t0 = now + START_SEC
    if (now < this.t0) return this.from - (this.t0 - now) / this.spb
    return loopBeat(now - this.t0, this.spb, this.from, this.to).beat
  }

  /** Puts the phrase's next notes on the lead voice, once each per pass. Call every frame while sound is on. */
  schedule(lead: LeadVoice) {
    if (!this.ctx || this.t0 < 0) return
    const now = this.ctx.currentTime
    const passSec = this.len * this.spb
    const pass = Math.max(0, Math.floor((now - this.t0) / passSec))
    for (const p of [pass, pass + 1]) {
      for (const s of this.steps) {
        const at = this.t0 + p * passSec + (s.beat - this.from) * this.spb
        if (at < now - 0.01 || at > now + AHEAD_SEC) continue
        let ids = this.sent.get(p)
        if (!ids) this.sent.set(p, (ids = new Set()))
        const key = String(s.id)
        if (ids.has(key)) continue
        ids.add(key)
        playStep(lead, s, at, this.spb)
      }
    }
    // finished passes only: notes still in the look-ahead keep their mark
    for (const k of this.sent.keys()) if (k < pass) this.sent.delete(k)
  }
}

function playStep(lead: LeadVoice, s: Step, at: number, spb: number) {
  if (s.kind === 'note') lead.note(at, STANDARD_TUNING[s.string] + s.fret, s.dur * spb, s.legato ? 0.75 : 1)
  else if (s.kind === 'chord' && s.frets) {
    const ms = s.frets.map((f, si) => (f >= 0 ? STANDARD_TUNING[si] + f : -1)).filter((m) => m >= 0)
    if (s.pick === 'U') ms.reverse()
    ms.forEach((m, i) => lead.note(at + i * 0.015, m, s.dur * spb, s.palmMute ? 0.45 : 0.7))
  }
}
