// Judged notes for the lesson effects (runway and fretboard). PlayScreen pushes; each effect layer drains what it hasn't seen.
// One bus per run, found through the run itself, so neither props nor React state carry it.
import type { JudgeResult, Verdict } from '../types'

export interface FxHit {
  seq: number
  eventId: number
  verdict: Verdict
  /** counted as a hit: perfect, good, early or late */
  hit: boolean
  /** the chain length when this hit reached a milestone (8, 16, 32, 64), else 0 */
  milestone: number
  roar: boolean
  played: number | null
}

const SIZE = 32
const buses = new WeakMap<object, FxBus>()

export function fxBusFor(run: object): FxBus {
  let b = buses.get(run)
  if (!b) {
    b = new FxBus()
    buses.set(run, b)
  }
  return b
}

export class FxBus {
  seq = 0
  /** bumps when the end-of-run sweep should play */
  celebrateSeq = 0
  private ring: FxHit[] = []

  constructor() {
    for (let i = 0; i < SIZE; i++) this.ring.push({ seq: 0, eventId: -1, verdict: 'miss', hit: false, milestone: 0, roar: false, played: null })
  }

  push(r: JudgeResult, milestone: number, roar: boolean) {
    this.seq++
    const h = this.ring[this.seq % SIZE]
    h.seq = this.seq
    h.eventId = r.eventId
    h.verdict = r.verdict
    h.hit = r.grade !== 'miss' && r.verdict !== 'miss' && r.verdict !== 'wrong' && r.verdict !== 'ringing'
    h.milestone = milestone
    h.roar = roar
    h.played = r.played ?? null
  }

  /** Calls cb for each record newer than `since`, oldest first (at most the last 32). Returns the newest seq. */
  drain(since: number, cb: (h: FxHit) => void): number {
    for (let s = Math.max(since + 1, this.seq - SIZE + 1); s <= this.seq; s++) cb(this.ring[s % SIZE])
    return this.seq
  }

  celebrate() {
    this.celebrateSeq++
  }
}
