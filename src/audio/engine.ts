// Guitar input → amp sim → output, plus pitch detection on the dry signal.
import type { Tone } from './tone'
import { AMP_MODELS, modelOf, presetByName } from './tone'
import { createOctaveDown } from './octave'
import { freqToMidiFloat } from '../music/theory'
import { loadHearAmp, saveHearAmp } from './hearAmp'
import type { NamModelInfo, NamNode } from 'neural-amp-modeler-wasm/engine'

/** What a NAM capture models: a pedal goes before the amp sim, an amp replaces it. */
export type CaptureKind = 'amp' | 'amp-cab' | 'pedal'

export type InputChannel = 'auto' | 'left' | 'right' | 'mix'

export interface PitchFrame {
  freq: number
  midi: number // rounded
  cents: number // deviation from `midi`
  rms: number
}

type Listener<T> = (v: T) => void

class Emitter<T> {
  private ls = new Set<Listener<T>>()
  on(l: Listener<T>) {
    this.ls.add(l)
    return () => {
      this.ls.delete(l)
    }
  }
  emit(v: T) {
    this.ls.forEach((l) => l(v))
  }
}

const dbToGain = (db: number) => Math.pow(10, db / 20)

function softClipCurve(asym: number): Float32Array<ArrayBuffer> {
  const n = 4096
  const curve = new Float32Array(n)
  const off = Math.tanh(asym)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1
    curve[i] = Math.tanh(x * 3 + asym) - off
  }
  return curve
}

function reverbImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return buf
}

/** YIN pitch detector. Returns frequency in Hz or 0 when no clear pitch. */
export function yin(buf: Float32Array, sr: number, diff: Float32Array, threshold = 0.12): number {
  const W = diff.length
  diff[0] = 1
  let running = 0
  for (let tau = 1; tau < W; tau++) {
    let sum = 0
    for (let i = 0; i < W; i++) {
      const d = buf[i] - buf[i + tau]
      sum += d * d
    }
    running += sum
    diff[tau] = running === 0 ? 1 : (sum * tau) / running
  }
  const minTau = Math.floor(sr / 1400)
  let tau = minTau
  for (; tau < W - 1; tau++) {
    if (diff[tau] < threshold) {
      while (tau + 1 < W && diff[tau + 1] < diff[tau]) tau++
      break
    }
  }
  if (tau >= W - 1) {
    // No dip under the threshold: accept the deepest dip if it is still fairly clear.
    let best = minTau
    for (let t = minTau; t < W; t++) if (diff[t] < diff[best]) best = t
    if (diff[best] > 0.35 || best >= W - 1) return 0
    tau = best
  }
  const a = diff[tau - 1]
  const b = diff[tau]
  const c = diff[tau + 1]
  const shift = (a - c) / (2 * (a - 2 * b + c))
  const t = tau + (Number.isFinite(shift) ? shift : 0)
  return sr / t
}

/** Turns a stream of pitch frames into discrete "note played" events. */
class NoteTracker {
  private cand = -1
  private candCount = 0
  private current = -1
  private peak = 0
  private dip = 1
  update(f: PitchFrame | null, rms: number, gateRms: number): number | null {
    if (!f) {
      this.candCount = 0
      if (rms < gateRms) this.current = -1
      this.dip = Math.min(this.dip, rms)
      return null
    }
    // Re-attack of the same note: level dipped and came back up.
    const reattack = rms > this.dip * 2 && this.peak > 0 && this.dip < this.peak * 0.45
    this.peak = Math.max(this.peak * 0.995, rms)
    this.dip = Math.min(this.dip, rms)
    if (f.midi === this.cand) this.candCount++
    else {
      this.cand = f.midi
      this.candCount = 1
    }
    if (this.candCount >= 2 && (this.cand !== this.current || reattack)) {
      this.current = this.cand
      this.peak = rms
      this.dip = rms
      return this.current
    }
    return null
  }
}

// Lessons' attack detector (tune on the Scarlett). Works on the ~48 kHz timeBuf.
const ONSET_NEW = 256 // newest window, ~5 ms
const ONSET_OLD = 1024 // reference window before it, ~21 ms
const ONSET_HOP = 64
const ONSET_MIN_RATIO = 1.3 // emitted at or above this; Lessons applies its own 1.4 / 1.6
const ONSET_MIN_ENERGY = 1e-7 // mean squared first difference; also the floor for the reference window
const ONSET_SAMPLE_K = 4 // a sample counts as the attack start when d² > K × reference energy
// Lessons' chord check: bins outside this band are ignored. Below ~150 Hz semitones are < 2 bins apart
// at 8192 points, so the low root's pitch class comes from its harmonics instead.
const CHROMA_MIN_HZ = 150
const CHROMA_MAX_HZ = 2100
const CHROMA_FLOOR_DB = -85
export interface OnsetFrame {
  ratio: number // energy of the newest 5 ms vs the 21 ms before (first-difference, i.e. high-passed)
  energy: number
  ageSec: number // how long before the end of this frame's buffer the attack started
}

export interface DeviceInfo {
  id: string
  label: string
}

export class GuitarEngine {
  ctx: AudioContext | null = null
  running = false
  channel: InputChannel = 'auto'
  /** Which physical input 'auto' is currently listening to. */
  autoPick: 'left' | 'right' = 'right'
  /** Per-input RMS, for the meters in the settings panel. */
  chLevels: [number, number] = [0, 0]
  info = { label: '', channels: 0, sampleRate: 0 }
  tone: Tone = presetByName('Clean')
  inputGainDb = 0
  /** The player's saved "Hear amp" choice. */
  hearAmp = loadHearAmp()
  /** What the amp output does right now: the saved choice, or a temporary mute (Tuner, mic input). */
  ampOn = this.hearAmp

  readonly pitch = new Emitter<PitchFrame | null>()
  readonly notes = new Emitter<number>()
  readonly level = new Emitter<number>()
  readonly state = new Emitter<void>()

  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private gL!: GainNode
  private gR!: GainNode
  private input!: GainNode
  private analyser!: AnalyserNode
  /** Lessons: a new pick or strum attack, emitted at most once per frame, right after `level`. */
  readonly onset = new Emitter<OnsetFrame>()
  private onsetSum = new Float64Array(2049)
  private onsetLastT = 0
  // Lessons' chord check: a longer window (8192 samples ≈ 170 ms, ~5.9 Hz bins), made on first use.
  private chromaAn: AnalyserNode | null = null
  private chromaSpec = new Float32Array(0)
  private chromaPc = new Int8Array(0)
  private gateGain!: GainNode
  private preHp!: BiquadFilterNode
  private preMid!: BiquadFilterNode
  private drive!: GainNode
  private shaper!: WaveShaperNode
  private post!: GainNode
  private bass!: BiquadFilterNode
  private mid!: BiquadFilterNode
  private treble!: BiquadFilterNode
  private presence!: BiquadFilterNode
  private voice!: BiquadFilterNode
  private cabLp!: BiquadFilterNode
  private chorusWet!: GainNode
  // Real-amp captures (NAM) and cabinet impulse responses.
  private ampIn!: GainNode
  private octDry!: GainNode
  private octWet!: GainNode
  private octIn!: GainNode
  private octave: Promise<AudioWorkletNode> | null = null
  private namIn!: GainNode
  private namToAmp!: GainNode
  private namToTone!: GainNode
  private nam: NamNode | null = null
  private irIn!: GainNode
  private irConv!: ConvolverNode
  capture: { kind: CaptureKind; name: string } | null = null
  irName: string | null = null
  private curveAsym = -1
  private cabIn!: GainNode
  private cabOut!: GainNode
  private cabBypass!: GainNode
  private master!: GainNode
  private delay!: DelayNode
  private delayWet!: GainNode
  private reverbWet!: GainNode
  private out!: GainNode
  private wet!: GainNode // amp and effects summed, before the amp on/off gain
  private aL!: AnalyserNode
  private aR!: AnalyserNode
  private chBuf = new Float32Array(1024)
  private raf = 0
  // Pitch detection runs at ~48 kHz whatever the device rate (Scarlett can run at 96/192k).
  private decim = 1
  private rawBuf = new Float32Array(2048)
  private timeBuf = new Float32Array(2048)
  private diffBuf = new Float32Array(1024)
  private autoHold = 0
  /** Loop frames in a row with exact digital silence on both inputs: a live interface is never exactly 0. */
  private deadFrames = 0
  private muteTimer: number | null = null
  private lastRestart = 0
  private tracker = new NoteTracker()
  private gateOpen = false

  /** True while the user wants the guitar connected; drives automatic reconnection. */
  private wanted = false
  private reconnecting = false

  constructor() {
    if (typeof window === 'undefined') return
    // Scarlett unplugged/replugged or the Mac woke up: reconnect if we were connected.
    navigator.mediaDevices?.addEventListener('devicechange', () => {
      if (this.wanted && !this.running) void this.reconnect()
    })
    // Coming back to this browser tab: make sure audio is running again.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') void this.ctx.resume()
      if (document.visibilityState === 'visible' && this.wanted && !this.running) void this.reconnect()
    })
    // Browsers only start audio after a click or key press; resume on the first one.
    const resume = () => {
      if (this.ctx && this.paused) void this.ctx.resume()
    }
    window.addEventListener('pointerdown', resume, true)
    window.addEventListener('keydown', resume, true)
  }

  /** Chrome stopped the audio: 'suspended' (waiting for a click) or 'interrupted' (macOS took the audio away). */
  private get paused() {
    const st = this.ctx?.state as string | undefined
    return !!st && st !== 'running' && st !== 'closed'
  }

  /** Audio is set up but stopped, and a click is needed to start it again (the app tries by itself first). */
  get needsResume() {
    return this.paused
  }

  /**
   * Creates (or resumes) the AudioContext. Usable for the metronome even without a guitar.
   * With `wait = false` it doesn't block on resuming (no click has happened yet on page load).
   */
  async ensureContext(wait = true): Promise<AudioContext> {
    if (!this.ctx) {
      // NAM captures are trained at 48 kHz; the browser resamples the interface if it runs higher.
      this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
      this.ctx.addEventListener('statechange', () => {
        this.state.emit()
        // The app never pauses audio itself: when Chrome or macOS does (another app took the audio, the output
        // changed), start it again. If Chrome wants a click first, the "click anywhere" bar shows.
        if (this.paused && this.wanted) setTimeout(() => this.paused && void this.ctx?.resume().catch(() => {}), 300)
      })
      this.buildGraph(this.ctx)
    }
    if (this.ctx.state !== 'running') {
      const p = this.ctx.resume()
      if (wait) await p
      else p.catch(() => {})
    }
    return this.ctx
  }

  /** Reconnects to the last used input after a reload, unplug or sleep. */
  async reconnect(): Promise<boolean> {
    if (this.reconnecting) return false
    this.reconnecting = true
    try {
      const saved = loadConnection()
      if (!saved) return false
      const { inputs, outputs } = await this.listDevices()
      const input =
        inputs.find((d) => d.id === saved.deviceId) ??
        inputs.find((d) => saved.label && d.label === saved.label) ??
        inputs.find((d) => /scarlett|focusrite/i.test(d.label))
      if (!input) return false
      await this.start(input.id, false)
      const out = loadOutput()
      if (out && outputs.some((o) => o.id === out) && this.canChooseOutput) await this.setOutput(out, false).catch(() => {})
      return true
    } catch {
      return false
    } finally {
      this.reconnecting = false
    }
  }

  /** On page load: reconnect silently if the guitar was connected last time and access is still granted. */
  async autoConnect() {
    if (!loadConnection() || this.running) return
    try {
      const perm = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
      if (perm && perm.state !== 'granted') return
    } catch {
      /* permissions API unavailable: try anyway */
    }
    this.wanted = true
    await this.reconnect()
  }

  async listDevices(): Promise<{ inputs: DeviceInfo[]; outputs: DeviceInfo[] }> {
    const all = await navigator.mediaDevices.enumerateDevices()
    const map = (kind: MediaDeviceKind) =>
      all.filter((d) => d.kind === kind).map((d, i) => ({ id: d.deviceId, label: d.label || `${kind} ${i + 1}` }))
    return { inputs: map('audioinput'), outputs: map('audiooutput') }
  }

  async start(deviceId?: string, waitForAudio = true) {
    const ctx = await this.ensureContext(waitForAudio)
    this.stopInput()
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    })
    const track = this.stream.getAudioTracks()[0]
    const label = track?.label ?? ''
    this.wanted = true
    saveConnection({ deviceId: track?.getSettings().deviceId ?? deviceId ?? '', label })
    // Muted by the browser for more than a moment (another capture took the device): connect again.
    track?.addEventListener('mute', () => {
      if (this.muteTimer) clearTimeout(this.muteTimer)
      this.muteTimer = window.setTimeout(() => {
        this.muteTimer = null
        if (this.stream?.getAudioTracks()[0] === track && track.muted && this.wanted) void this.restartInput()
      }, 2000)
    })
    track?.addEventListener('unmute', () => {
      if (this.muteTimer) clearTimeout(this.muteTimer)
      this.muteTimer = null
    })
    // The stream ends if the interface disappears (unplugged, sleep): try to come back.
    track?.addEventListener('ended', () => {
      if (this.stream?.getAudioTracks()[0] !== track) return
      this.stopInput()
      this.state.emit()
      if (this.wanted) setTimeout(() => void this.reconnect(), 1000)
    })
    // Scarlett Solo: input 1 = mic (left), input 2 = instrument (right). 'auto' starts on
    // input 2 and moves to whichever input actually carries signal.
    this.autoPick = 'right'
    this.source = ctx.createMediaStreamSource(this.stream)
    const channels = track?.getSettings().channelCount ?? this.source.channelCount
    const splitter = ctx.createChannelSplitter(2)
    this.source.connect(splitter)
    splitter.connect(this.gL, 0)
    splitter.connect(this.aL, 0)
    // A mono stream only has output 0 of the splitter carrying signal.
    splitter.connect(this.gR, channels > 1 ? 1 : 0)
    splitter.connect(this.aR, channels > 1 ? 1 : 0)
    this.info = { label, channels, sampleRate: ctx.sampleRate }
    this.applyChannel()
    this.running = true
    this.loop()
    this.state.emit()
    return label
  }

  /** Opens the guitar input again, on the same device (a stream that went dead or was muted). */
  private async restartInput() {
    // At most once in 30 s: an input that is silent for real (macOS input volume at zero) isn't reopened forever.
    if (this.reconnecting || Date.now() - this.lastRestart < 30000) return
    this.lastRestart = Date.now()
    this.deadFrames = 0
    this.stopInput()
    this.state.emit()
    if (!(await this.reconnect())) setTimeout(() => this.wanted && !this.running && void this.reconnect(), 1500)
  }

  private stopInput() {
    cancelAnimationFrame(this.raf)
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.source = null
    this.stream = null
    this.running = false
  }

  stop() {
    this.wanted = false
    saveConnection(null)
    this.stopInput()
    this.pitch.emit(null)
    this.state.emit()
  }

  /** The processed guitar sound (amp, cab and effects), taken before the amp on/off switch, for recording a take. */
  get output(): AudioNode | null {
    return this.ctx ? this.wet : null
  }

  /** The raw input (picked channel, input gain), for recording a mic or a dry guitar. */
  get dryOutput(): AudioNode | null {
    return this.ctx ? this.input : null
  }

  get latencyMs(): number {
    if (!this.ctx) return 0
    const c = this.ctx as AudioContext & { outputLatency?: number }
    return Math.round(((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000)
  }

  async setOutput(deviceId: string, waitForAudio = true) {
    const ctx = await this.ensureContext(waitForAudio)
    const c = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (c.setSinkId) await c.setSinkId(deviceId)
  }

  get canChooseOutput() {
    return 'setSinkId' in AudioContext.prototype
  }

  setChannel(ch: InputChannel) {
    this.channel = ch
    this.applyChannel()
    this.state.emit()
  }

  private applyChannel() {
    if (!this.gL) return
    const ch = this.channel === 'auto' ? this.autoPick : this.channel
    this.gL.gain.value = ch === 'left' ? 1 : ch === 'mix' ? 0.5 : 0
    this.gR.gain.value = ch === 'right' ? 1 : ch === 'mix' ? 0.5 : 0
  }

  setInputGain(db: number) {
    this.inputGainDb = db
    if (this.input) this.input.gain.value = dbToGain(db)
    this.state.emit()
  }

  /** A temporary mute or unmute that isn't saved; restore with setAmpOn(engine.hearAmp). */
  setAmpOn(on: boolean) {
    this.ampOn = on
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02)
    this.state.emit()
  }

  /** The "Hear amp" switch: saved for this browser and applied now. */
  setHearAmp(on: boolean) {
    this.hearAmp = on
    saveHearAmp(on)
    this.setAmpOn(on)
  }

  setTone(t: Tone) {
    this.tone = { ...t }
    if (!this.ctx) {
      this.state.emit()
      return
    }
    const now = this.ctx.currentTime
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, 0.03)
    const g = t.gain
    const model = AMP_MODELS[modelOf(t)]
    set(this.preHp.frequency, Math.max(28, 70 + g * 22 + model.tight))
    set(this.voice.frequency, model.voiceHz)
    set(this.voice.gain, model.voiceDb)
    set(this.voice.Q, model.voiceQ)
    set(this.cabLp.frequency, model.cabLp)
    set(this.chorusWet.gain, ((t.chorus ?? 0) / 10) * 0.8)
    // Octave down: blended in before the amp (or capture); at 10 the guitar itself is gone.
    const oct = Math.max(0, Math.min(10, t.octave ?? 0)) / 10
    set(this.octDry.gain, 1 - oct)
    set(this.octWet.gain, oct * 1.3)
    if (oct > 0) this.ensureOctave(this.ctx)
    if (model.asym !== this.curveAsym) {
      this.curveAsym = model.asym
      this.shaper.curve = softClipCurve(model.asym)
    }
    set(this.preMid.gain, g * 0.7)
    // Drive: up to ~48 dB into the clipper. The clipper's output tops out near ±1, so
    // compensate by the expected output level for a typical guitar signal (~0.15 peak).
    const driveDb = 2 + g * 4.6
    const driveLin = dbToGain(driveDb)
    set(this.drive.gain, driveLin)
    set(this.post.gain, (0.3 / Math.min(1, driveLin * 0.45)) * dbToGain(g * 0.9))
    set(this.bass.gain, t.bass)
    set(this.mid.gain, t.mid)
    set(this.treble.gain, t.treble)
    set(this.presence.gain, t.presence)
    set(this.master.gain, Math.pow(t.level / 10, 2) * 2)
    this.applyRouting()
    set(this.delay.delayTime, t.delayMs / 1000)
    set(this.delayWet.gain, (t.delay / 10) * 0.55)
    set(this.reverbWet.gain, (t.reverb / 10) * 0.9)
    this.state.emit()
  }

  /** Loads the octave-down effect the first time a tone uses it. */
  private ensureOctave(ctx: AudioContext) {
    this.octave ??= createOctaveDown(ctx).then((node) => {
      this.octIn.connect(node).connect(this.octWet)
      return node
    })
  }

  /** Chooses the signal path: built-in amp or capture, and simulated cab, IR or none. */
  private applyRouting() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, 0.02)
    const kind = this.nam ? this.capture?.kind : undefined
    set(this.ampIn.gain, kind === 'amp' || kind === 'amp-cab' || kind === 'pedal' ? 0 : 1)
    set(this.namToAmp.gain, kind === 'pedal' ? 1 : 0)
    // Captures are normalised to about −18 dB; trim to sit level with the built-in amp.
    set(this.namToTone.gain, kind === 'amp' || kind === 'amp-cab' ? 0.63 : 0)
    // A full-rig capture already includes its cabinet; an amp head needs one.
    const cab: 'sim' | 'ir' | 'none' = kind === 'amp-cab' ? 'none' : this.irName ? 'ir' : kind === 'amp' || this.tone.cab ? 'sim' : 'none'
    set(this.cabOut.gain, cab === 'sim' ? 1 : 0)
    set(this.irIn.gain, cab === 'ir' ? 1 : 0)
    set(this.cabBypass.gain, cab === 'none' ? (kind ? 1 : 0.6) : 0)
  }

  /** Loads a NAM capture (.nam JSON), or removes it when `c` is null. */
  async setCapture(c: { kind: CaptureKind; name: string; json: string } | null): Promise<NamModelInfo | undefined> {
    const ctx = await this.ensureContext(false)
    if (!c) {
      this.capture = null
      this.applyRouting()
      this.state.emit()
      return undefined
    }
    if (!this.nam) {
      const { NamEngine } = await import('neural-amp-modeler-wasm/engine')
      const eng = await NamEngine.attach(ctx)
      this.nam = await eng.createNode()
      this.namIn.connect(this.nam)
      this.nam.connect(this.namToAmp)
      this.nam.connect(this.namToTone)
    }
    const info = await this.nam.loadModel(c.json)
    this.capture = { kind: c.kind, name: c.name }
    this.applyRouting()
    this.state.emit()
    return info
  }

  /** Loads a cabinet impulse response (.wav), or removes it when `data` is null. */
  async setIr(ir: { name: string; data: ArrayBuffer } | null) {
    const ctx = await this.ensureContext(false)
    if (ir) {
      const buf = await ctx.decodeAudioData(ir.data.slice(0))
      // Normalise to unit energy so a cabinet doesn't change the overall level.
      let energy = 0
      for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) energy += v * v
      const k = energy > 0 ? 1 / Math.sqrt(energy / buf.numberOfChannels) : 1
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c)
        for (let i = 0; i < d.length; i++) d[i] *= k
      }
      this.irConv.normalize = false
      this.irConv.buffer = buf
      this.irName = ir.name
    } else this.irName = null
    this.applyRouting()
    this.state.emit()
  }

  /** Metronome loudness for every click in the app: 0–3 (1 = normal), remembered between sessions. */
  metronomeLevel = (() => {
    try {
      const v = Number(localStorage.getItem('metronome-level'))
      return Number.isFinite(v) && v > 0 ? Math.min(3, v) : 1
    } catch {
      return 1
    }
  })()

  setMetronomeLevel(v: number) {
    this.metronomeLevel = Math.max(0, Math.min(3, v))
    try {
      localStorage.setItem('metronome-level', String(this.metronomeLevel))
    } catch {
      /* storage unavailable */
    }
    this.state.emit()
  }

  /** Short metronome click at audio time `when`, scaled by the metronome level. */
  click(when: number, accent: boolean, volume = 0.5) {
    if (!this.ctx) return
    // The filtered square overshoots ~20%, so cap the envelope at 0.8 to stay clear of clipping.
    const peak = Math.min(0.8, volume * this.metronomeLevel)
    if (peak <= 0) return
    // A filtered square wave: brighter than a sine, so it cuts through a distorted guitar.
    const osc = this.ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = accent ? 1600 : 1000
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 4000
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(peak, when + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.055)
    osc.connect(lp).connect(g).connect(this.ctx.destination)
    osc.start(when)
    osc.stop(when + 0.07)
  }

  /** Finds the strongest new attack in the samples that arrived since the last frame. */
  private detectOnset(sr: number) {
    const x = this.timeBuf
    const n = x.length
    const S = this.onsetSum // S[i] = Σ d[j]² for j < i, d[j] = x[j] − x[j−1]
    S[0] = 0
    S[1] = 0
    for (let i = 1; i < n; i++) {
      const d = x[i] - x[i - 1]
      S[i + 1] = S[i] + d * d
    }
    const now = this.ctx!.currentTime
    const fresh = Math.round((now - this.onsetLastT) * sr)
    this.onsetLastT = now
    const from = Math.max(ONSET_NEW + ONSET_OLD, n - Math.max(ONSET_HOP, fresh))
    let best = 0
    let bestEnd = -1
    let bestOld = 0
    for (let p = from; p <= n; p += ONSET_HOP) {
      const eNew = (S[p] - S[p - ONSET_NEW]) / ONSET_NEW
      const eOld = Math.max(ONSET_MIN_ENERGY, (S[p - ONSET_NEW] - S[p - ONSET_NEW - ONSET_OLD]) / ONSET_OLD)
      const r = eNew / eOld
      if (eNew > ONSET_MIN_ENERGY && r > best) {
        best = r
        bestEnd = p
        bestOld = eOld
      }
    }
    if (bestEnd < 0 || best < ONSET_MIN_RATIO) return
    let idx = bestEnd - ONSET_NEW
    for (let i = idx; i < bestEnd; i++) {
      const d = x[i] - x[i - 1]
      if (d * d > ONSET_SAMPLE_K * bestOld) {
        idx = i
        break
      }
    }
    this.onset.emit({ ratio: best, energy: (S[bestEnd] - S[bestEnd - ONSET_NEW]) / ONSET_NEW, ageSec: (n - idx) / sr })
  }

  /**
   * Pitch-class profile of the dry guitar over the last ~170 ms, written into `out`
   * (12 bins, C = 0, L2-normalised). False when there's no input or nothing loud enough.
   */
  chroma(out: Float32Array): boolean {
    if (!this.ctx || !this.running) return false
    if (!this.chromaAn) {
      const a = this.ctx.createAnalyser()
      a.fftSize = 8192
      a.smoothingTimeConstant = 0
      this.input.connect(a)
      this.chromaAn = a
      this.chromaSpec = new Float32Array(a.frequencyBinCount)
      this.chromaPc = new Int8Array(a.frequencyBinCount)
      const sr = this.ctx.sampleRate
      for (let k = 0; k < a.frequencyBinCount; k++) {
        const f = (k * sr) / a.fftSize
        this.chromaPc[k] = f < CHROMA_MIN_HZ || f > CHROMA_MAX_HZ ? -1 : ((Math.round(freqToMidiFloat(f)) % 12) + 12) % 12
      }
    }
    this.chromaAn.getFloatFrequencyData(this.chromaSpec)
    out.fill(0)
    let total = 0
    for (let k = 1; k < this.chromaSpec.length - 1; k++) {
      const p = this.chromaPc[k]
      const db = this.chromaSpec[k]
      // Spectral peaks only, so leakage into neighbouring bins doesn't smear the notes.
      if (p < 0 || db < CHROMA_FLOOR_DB || db < this.chromaSpec[k - 1] || db < this.chromaSpec[k + 1]) continue
      const m = Math.pow(10, db / 20)
      out[p] += Math.sqrt(m)
      total += m
    }
    if (total < 1e-4) return false
    let s = 0
    for (let i = 0; i < 12; i++) s += out[i] * out[i]
    s = Math.sqrt(s) || 1
    for (let i = 0; i < 12; i++) out[i] /= s
    return true
  }

  private buildGraph(ctx: AudioContext) {
    const biquad = (type: BiquadFilterType, freq: number, q = 0.707, gain = 0) => {
      const f = ctx.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      f.gain.value = gain
      return f
    }
    const mono = () => {
      const g = ctx.createGain()
      g.channelCount = 1
      g.channelCountMode = 'explicit'
      return g
    }
    this.gL = mono()
    this.gR = mono()
    this.input = mono()
    this.gL.connect(this.input)
    this.gR.connect(this.input)
    this.input.gain.value = dbToGain(this.inputGainDb)

    this.decim = Math.max(1, Math.round(ctx.sampleRate / 48000))
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048 * Math.pow(2, Math.ceil(Math.log2(this.decim)))
    this.rawBuf = new Float32Array(this.analyser.fftSize)
    this.input.connect(this.analyser)
    this.aL = ctx.createAnalyser()
    this.aR = ctx.createAnalyser()
    this.aL.fftSize = this.aR.fftSize = 1024

    this.gateGain = ctx.createGain()
    this.preHp = biquad('highpass', 90, 0.7)
    this.preMid = biquad('peaking', 850, 0.8, 0)
    this.drive = ctx.createGain()
    this.shaper = ctx.createWaveShaper()
    this.shaper.curve = softClipCurve(0.15)
    this.shaper.oversample = '4x'
    this.post = ctx.createGain()
    this.bass = biquad('lowshelf', 120)
    this.mid = biquad('peaking', 650, 0.7)
    this.treble = biquad('highshelf', 3000)
    this.presence = biquad('peaking', 4800, 1.2)
    this.voice = biquad('peaking', 650, 0.8)

    // Cabinet: rough 4x12 response.
    this.cabIn = ctx.createGain()
    const cab = [
      biquad('highpass', 80, 0.8),
      biquad('peaking', 120, 1.2, 3),
      biquad('peaking', 1600, 1, -2.5),
      biquad('peaking', 2800, 1.6, 3),
      biquad('lowpass', 5000, 0.9),
      biquad('lowpass', 7000, 0.7),
    ]
    this.cabOut = ctx.createGain()
    this.cabBypass = ctx.createGain()
    this.master = ctx.createGain()
    this.out = ctx.createGain()
    // Start as the player left it: silent when they hear the guitar through their own hardware.
    this.out.gain.value = this.ampOn ? 1 : 0
    this.wet = ctx.createGain()

    this.input.connect(this.gateGain)
    this.ampIn = ctx.createGain()
    this.namIn = ctx.createGain()
    this.namToAmp = ctx.createGain()
    this.namToTone = ctx.createGain()
    this.namToAmp.gain.value = 0
    this.namToTone.gain.value = 0
    // Octave down sits first: the dry guitar and the octave (when on) mix into the amp and capture.
    this.octDry = ctx.createGain()
    this.octWet = ctx.createGain()
    this.octWet.gain.value = 0
    this.octIn = ctx.createGain()
    const octLp = biquad('lowpass', 1800, 0.7) // the shifter's grain lives up high; a bass doesn't need it
    this.gateGain.connect(this.octDry)
    this.gateGain.connect(this.octIn)
    this.octWet.connect(octLp)
    const preAmp = ctx.createGain()
    this.octDry.connect(preAmp)
    octLp.connect(preAmp)
    preAmp.connect(this.namIn)
    this.namToAmp.connect(this.preHp)
    this.namToTone.connect(this.bass)
    preAmp.connect(this.ampIn).connect(this.preHp).connect(this.preMid).connect(this.drive).connect(this.shaper).connect(this.post)
    this.post.connect(this.voice).connect(this.bass).connect(this.mid).connect(this.treble).connect(this.presence).connect(this.cabIn)
    this.cabLp = cab[4]
    let node: AudioNode = this.cabIn
    for (const f of cab) node = node.connect(f)
    node.connect(this.cabOut).connect(this.master)
    this.presence.connect(this.cabBypass).connect(this.master)
    this.irIn = ctx.createGain()
    this.irIn.gain.value = 0
    this.irConv = ctx.createConvolver()
    this.presence.connect(this.irIn).connect(this.irConv).connect(this.master)

    // Effects: delay with filtered feedback, synthetic plate-ish reverb.
    this.delay = ctx.createDelay(2)
    const fb = ctx.createGain()
    fb.gain.value = 0.35
    const fbLp = biquad('lowpass', 2800)
    this.delayWet = ctx.createGain()
    this.master.connect(this.delay)
    this.delay.connect(fbLp).connect(fb).connect(this.delay)
    this.delay.connect(this.delayWet).connect(this.wet)

    const conv = ctx.createConvolver()
    conv.buffer = reverbImpulse(ctx, 2.4, 3)
    this.reverbWet = ctx.createGain()
    this.master.connect(conv).connect(this.reverbWet).connect(this.wet)

    this.master.connect(this.wet)

    // Chorus: a short delay swept by a slow LFO, mixed in parallel.
    const chorusDelay = ctx.createDelay(0.05)
    chorusDelay.delayTime.value = 0.014
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.8
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = 0.0035
    lfo.connect(lfoDepth).connect(chorusDelay.delayTime)
    lfo.start()
    this.chorusWet = ctx.createGain()
    this.chorusWet.gain.value = 0
    this.master.connect(chorusDelay).connect(this.chorusWet).connect(this.wet)
    this.wet.connect(this.out).connect(ctx.destination)
    this.setTone(this.tone)
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (!this.ctx) return
    // Downsample to ~48 kHz so the detector window always spans ~43 ms (low E needs it).
    this.analyser.getFloatTimeDomainData(this.rawBuf)
    const k = this.rawBuf.length / this.timeBuf.length
    if (k === 1) this.timeBuf.set(this.rawBuf)
    else
      for (let i = 0; i < this.timeBuf.length; i++) {
        let s = 0
        for (let j = 0; j < k; j++) s += this.rawBuf[i * k + j]
        this.timeBuf[i] = s / k
      }

    // Per-input levels, and 'auto' follows the input that has the guitar on it.
    const chRms = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(this.chBuf)
      let s = 0
      for (let i = 0; i < this.chBuf.length; i++) s += this.chBuf[i] * this.chBuf[i]
      return Math.sqrt(s / this.chBuf.length)
    }
    const l = chRms(this.aL)
    const r = chRms(this.aR)
    this.chLevels = [Math.max(l, this.chLevels[0] * 0.9), Math.max(r, this.chLevels[1] * 0.9)]
    // Exact zeros on both inputs for 3 s while audio runs: the stream died without saying so. Open it again.
    this.deadFrames = l === 0 && r === 0 && this.ctx.state === 'running' ? this.deadFrames + 1 : 0
    if (this.deadFrames > 180 && this.wanted) {
      this.deadFrames = 0
      void this.restartInput()
    }
    if (this.channel === 'auto') {
      const other = this.autoPick === 'right' ? l : r
      const cur = this.autoPick === 'right' ? r : l
      this.autoHold = other > 0.003 && other > cur * 4 ? this.autoHold + 1 : 0
      if (this.autoHold > 20) {
        this.autoPick = this.autoPick === 'right' ? 'left' : 'right'
        this.autoHold = 0
        this.applyChannel()
        this.state.emit()
      }
    }

    let sum = 0
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i]
    const rms = Math.sqrt(sum / this.timeBuf.length)
    this.level.emit(rms)
    this.detectOnset(this.ctx.sampleRate / k)

    // Noise gate with hysteresis.
    const gateRms = this.tone.gate > 0 ? 0.0006 * Math.pow(1.6, this.tone.gate) : 0
    if (gateRms > 0) {
      const open = this.gateOpen ? rms > gateRms * 0.6 : rms > gateRms
      if (open !== this.gateOpen) {
        this.gateOpen = open
        this.gateGain.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, open ? 0.002 : 0.06)
      }
    } else if (!this.gateOpen) {
      this.gateOpen = true
      this.gateGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.002)
    }

    let frame: PitchFrame | null = null
    if (rms > 0.0012) {
      const f = yin(this.timeBuf, this.ctx.sampleRate / k, this.diffBuf, 0.15)
      if (f > 70 && f < 1400) {
        const mf = freqToMidiFloat(f)
        const midi = Math.round(mf)
        frame = { freq: f, midi, cents: Math.round((mf - midi) * 100), rms }
      }
    }
    this.pitch.emit(frame)
    const on = this.tracker.update(frame, rms, 0.001)
    if (on !== null) this.notes.emit(on)
  }
}

interface SavedConnection {
  deviceId: string
  label: string
}

function loadConnection(): SavedConnection | null {
  try {
    return JSON.parse(localStorage.getItem('guitar-connection') ?? 'null') as SavedConnection | null
  } catch {
    return null
  }
}

function saveConnection(c: SavedConnection | null) {
  try {
    if (c) localStorage.setItem('guitar-connection', JSON.stringify(c))
    else localStorage.removeItem('guitar-connection')
  } catch {
    /* storage unavailable */
  }
}

function loadOutput(): string | undefined {
  try {
    return (JSON.parse(localStorage.getItem('audio-devices') ?? '{}') as { output?: string }).output
  } catch {
    return undefined
  }
}

// Keep one engine across dev hot-reloads, so an edit never leaves a second, disconnected engine.
export const engine: GuitarEngine = (import.meta.hot?.data.engine as GuitarEngine | undefined) ?? new GuitarEngine()
if (import.meta.hot) import.meta.hot.data.engine = engine
