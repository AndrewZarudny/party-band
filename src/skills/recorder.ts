// Records a take: the processed guitar (after the amp and effects), optionally with the backing band.
import { engine } from '../audio/engine'
import { BackingBand } from '../audio/backing'
import type { Chord } from '../music/theory'
import { parseChord } from '../music/theory'
import { FEELS, keysVoicing } from '../music/parts'
import type { KeysVoicing } from '../music/parts'

export const MAX_SEC = 180
const LOOKAHEAD = 0.12
const TIMER_MS = 25
const BAND_GAIN = 0.7

export interface Backing {
  id: string
  label: string
  chords: string[] // one per bar
  bpm: number
  feel: string
}

export const BACKINGS: Backing[] = [
  { id: 'am', label: 'Am G F G · 90 BPM', chords: ['Am', 'G', 'F', 'G'], bpm: 90, feel: 'pop' },
  { id: 'ea', label: 'E A · blues shuffle, 80 BPM', chords: ['E', 'E', 'A', 'A'], bpm: 80, feel: 'blues' },
  { id: 'gcd', label: 'G C D C · 100 BPM', chords: ['G', 'C', 'D', 'C'], bpm: 100, feel: 'pop' },
]

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined'
}

export class TakeRecorder {
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private dest: MediaStreamAudioDestinationNode | null = null
  private bandBus: GainNode | null = null
  private band: BackingBand | null = null
  private timer = 0
  private startedAt = 0

  async start(backing: Backing | null): Promise<void> {
    const ctx = await engine.ensureContext()
    const dest = ctx.createMediaStreamDestination()
    this.dest = dest
    engine.output?.connect(dest)
    if (backing) this.startBand(ctx, dest, backing)
    const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined)
    this.chunks = []
    rec.ondataavailable = (ev) => {
      if (ev.data.size) this.chunks.push(ev.data)
    }
    rec.start(1000)
    this.rec = rec
    this.startedAt = performance.now()
  }

  get seconds(): number {
    return this.rec ? (performance.now() - this.startedAt) / 1000 : 0
  }

  /** Stops and returns the take (null when nothing was recorded). */
  stop(): Promise<{ blob: Blob; sec: number } | null> {
    const rec = this.rec
    const sec = this.seconds
    this.stopBand()
    if (!rec) return Promise.resolve(null)
    this.rec = null
    return new Promise((resolve) => {
      rec.onstop = () => {
        this.disconnect()
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' })
        resolve(blob.size ? { blob, sec } : null)
      }
      try {
        rec.stop()
      } catch {
        this.disconnect()
        resolve(null)
      }
    })
  }

  private disconnect() {
    if (this.dest) {
      try {
        engine.output?.disconnect(this.dest)
      } catch {
        /* already disconnected */
      }
    }
    this.bandBus?.disconnect()
    this.bandBus = null
    this.dest = null
  }

  /** The band plays to the speakers and into the take; one chord per bar, eighth-note steps. */
  private startBand(ctx: AudioContext, dest: AudioNode, b: Backing) {
    const bus = ctx.createGain()
    bus.connect(ctx.destination)
    bus.connect(dest)
    this.bandBus = bus
    const band = new BackingBand(ctx, bus)
    band.setVolume(BAND_GAIN)
    this.band = band
    const chords = b.chords.map((c) => parseChord(c)).filter((c): c is Chord => !!c)
    const feel = FEELS[b.feel] ?? FEELS.pop
    const eighth = 30 / b.bpm
    const t0 = ctx.currentTime + 0.1
    const parts = { drums: true, bass: true, keys: true }
    let n = 0
    let voicing: KeysVoicing | null = null
    const tick = () => {
      while (t0 + n * eighth < ctx.currentTime + LOOKAHEAD) {
        const step = n % 8
        const chord = chords[Math.floor(n / 8) % chords.length]
        if (step === 0 || !voicing) voicing = keysVoicing(chord, voicing?.right ?? null)
        const swingT = feel.swing && n % 2 ? eighth * 0.33 : 0
        band.playStep(t0 + n * eighth + swingT, step, eighth, chord, feel, voicing, parts)
        n++
      }
    }
    this.timer = window.setInterval(tick, TIMER_MS)
    tick()
  }

  private stopBand() {
    window.clearInterval(this.timer)
    this.timer = 0
    this.band?.stop()
    this.band = null
  }
}
