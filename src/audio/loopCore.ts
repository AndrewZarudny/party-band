// The looper's sample-by-sample logic, kept free of audio APIs so tests can run it. The audio worklet
// (looper.ts) runs this same class: its source is copied into the worklet, so it must not use anything from
// outside itself (no imports, no module constants).
//
// Times are in frames (samples) of the audio clock. A loop is the first take, plus overdub layers on top.
// Free mode: press to start recording, press again to close the loop (both ends shift by the same input delay,
// so the loop is seamless). Bars mode: a fixed length from a downbeat, recording shifted by the round trip so
// notes played on the click land on the loop's beat. Overdubs are always written one round trip earlier.

export type LoopState = 'idle' | 'recording' | 'playing' | 'overdubbing' | 'stopped'

export class LoopCore {
  state: LoopState = 'idle'
  layers: Float32Array[] = []
  len = 0
  rt = 0 // round trip, frames
  maxFrames: number
  private take: Float32Array | null = null
  private recStart = 0
  private fixedLen = 0 // bars mode: the loop's length is known before recording
  private playStart = 0
  private dub: Float32Array | null = null

  constructor(maxFrames: number) {
    this.maxFrames = maxFrames
  }

  /** Starts the first take at frame `at`. `frames`: a fixed (bars) length, else free. */
  record(at: number, frames = 0) {
    this.layers = []
    this.dub = null
    this.fixedLen = Math.max(0, Math.min(frames, this.maxFrames))
    this.len = this.fixedLen
    this.take = new Float32Array(this.fixedLen || this.maxFrames)
    this.recStart = this.fixedLen ? at + this.rt : at
    // Bars mode plays from the end of the recorded bars, on the beat (the last round trip is still coming in,
    // and playback reaches it only a whole loop later).
    this.playStart = this.fixedLen ? at + this.fixedLen : 0
    this.state = 'recording'
  }

  /** Free mode: the second press closes the loop at frame `at` and plays it from there. */
  close(at: number) {
    if (this.state !== 'recording' || this.fixedLen || !this.take) return
    const len = Math.max(1, Math.min(at - this.recStart, this.maxFrames))
    this.len = len
    this.layers = [this.take.slice(0, len)]
    this.take = null
    this.playStart = at
    this.state = 'playing'
  }

  /** Overdub on (a new layer) from now, while playing. */
  overdub() {
    if (this.state !== 'playing' || !this.len) return
    this.dub = new Float32Array(this.len)
    this.layers.push(this.dub)
    this.state = 'overdubbing'
  }

  /** Overdub off, or play again from the top at frame `at` after a stop. */
  play(at: number) {
    if (this.state === 'overdubbing') {
      this.dub = null
      this.state = 'playing'
    } else if (this.state === 'stopped' && this.len) {
      this.playStart = at
      this.state = 'playing'
    }
  }

  stop() {
    if (this.state === 'recording' && !this.fixedLen) return this.clear()
    if (this.state === 'recording') return
    this.dub = null
    if (this.len) this.state = 'stopped'
  }

  /** Takes off the last overdub (the first take stays). */
  undo() {
    if (this.layers.length < 2) return
    if (this.state === 'overdubbing') {
      this.dub = null
      this.state = 'playing'
    }
    this.layers.pop()
  }

  clear() {
    this.layers = []
    this.take = null
    this.dub = null
    this.len = 0
    this.fixedLen = 0
    this.state = 'idle'
  }

  /** Where playback is, 0–1 (for the UI); 0 when nothing plays. */
  progress(at: number): number {
    if (!this.len || (this.state !== 'playing' && this.state !== 'overdubbing')) return 0
    return (((at - this.playStart) % this.len) + this.len) % this.len / this.len
  }

  /** One block: `input` from the guitar, `output` gets the loop. `at`: the block's first frame. */
  process(input: Float32Array | null, output: Float32Array, at: number) {
    for (let i = 0; i < output.length; i++) {
      const f = at + i
      const x = input ? input[i] : 0
      let y = 0
      if (this.state === 'recording' && this.take) {
        const idx = f - this.recStart
        if (idx >= 0 && idx < this.take.length) this.take[idx] = x
        if (this.fixedLen) {
          // Bars: the take plays from its end on the beat; once the last round trip is in, it is the loop.
          if (f >= this.playStart) y = this.take[(f - this.playStart) % this.fixedLen]
          if (idx >= this.fixedLen - 1) {
            this.layers = [this.take]
            this.take = null
            this.state = 'playing'
          }
        } else if (idx >= this.take.length - 1) {
          // Free: the longest loop there is room for closes itself.
          this.close(f + 1)
        }
      } else if (this.state === 'playing' || this.state === 'overdubbing') {
        const pos = (((f - this.playStart) % this.len) + this.len) % this.len
        for (let l = 0; l < this.layers.length; l++) y += this.layers[l][pos]
        if (this.dub) this.dub[(((f - this.playStart - this.rt) % this.len) + this.len) % this.len] += x
      }
      output[i] = y
    }
  }
}
