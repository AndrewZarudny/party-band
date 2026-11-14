// The looper: records the processed guitar (amp, cab, effects) and plays it back round and round, with overdub
// layers on top, like a loop pedal. The loop runs on the audio thread (an AudioWorklet running LoopCore), so it
// never drifts or gaps. Two pedal actions: main (record, close the loop, overdub on and off, play) and second
// (stop, play). The round trip for lining up overdubs comes from the Lessons sync (Tap In), else a default.
import { useSyncExternalStore } from 'react'
import { engine } from './engine'
import { LoopCore } from './loopCore'
import type { LoopState } from './loopCore'
import { defaultOffsetMs, deviceKey, loadLatency } from '../lessons/calibration'

const MAX_SEC = 60

// The worklet: LoopCore's own source, wrapped. Reports state and position to the page about 10 times a second.
const PROCESSOR = `
const Core = (${LoopCore.toString()});
class Looper extends AudioWorkletProcessor {
  constructor() {
    super();
    this.c = new Core(Math.round(sampleRate * ${MAX_SEC}));
    this.tick = 0;
    this.port.onmessage = (e) => {
      const m = e.data, c = this.c;
      const at = m.at != null ? Math.round(m.at * sampleRate) : currentFrame;
      if (m.type === 'rt') c.rt = Math.max(0, Math.round((m.ms / 1000) * sampleRate));
      else if (m.type === 'record') c.record(at, m.seconds ? Math.round(m.seconds * sampleRate) : 0);
      else if (m.type === 'close') c.close(at);
      else if (m.type === 'overdub') c.overdub();
      else if (m.type === 'play') c.play(at);
      else if (m.type === 'stop') c.stop();
      else if (m.type === 'undo') c.undo();
      else if (m.type === 'clear') c.clear();
      else if (m.type === 'mix') { const data = c.mix(); this.port.postMessage({ mix: data, rate: sampleRate }, [data.buffer]); return; }
      this.report();
    };
  }
  report() {
    const c = this.c;
    this.port.postMessage({ state: c.state, layers: c.layers.length, len: c.len / sampleRate, pos: c.progress(currentFrame) });
  }
  process(inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const inp = inputs[0] && inputs[0][0];
    const before = this.c.state;
    this.c.process(inp || null, out, currentFrame);
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    if (this.c.state !== before || ++this.tick % 38 === 0) this.report();
    return true;
  }
}
registerProcessor('looper', Looper);
`

export type LoopMode = 'free' | 'bars'

export interface LooperView {
  ready: boolean
  state: LoopState
  layers: number
  lenSec: number
  pos: number // 0–1 through the loop
  mode: LoopMode
  bars: number
  bpm: number
  click: boolean
  volume: number // 0–1.5
  countIn: number | null // beats left before recording starts (bars mode)
  error: string | null
  /** The looper panel is open: then the pedals work the looper, not the band. */
  panelOpen: boolean
}

let view: LooperView = { ready: false, state: 'idle', layers: 0, lenSec: 0, pos: 0, mode: 'free', bars: 4, bpm: 90, click: true, volume: 1, countIn: null, error: null, panelOpen: false }
const listeners = new Set<() => void>()
const set = (patch: Partial<LooperView>) => {
  view = { ...view, ...patch }
  for (const l of listeners) l()
}
export const useLooper = () => useSyncExternalStore(subscribe, () => view)
function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let node: AudioWorkletNode | null = null
let gain: GainNode | null = null
let starting: Promise<AudioWorkletNode | null> | null = null
let loopStart = 0 // audio time of the loop's first downbeat (bars mode click)
let clickTimer: number | null = null
let countTimer: number | null = null

async function ensure(): Promise<AudioWorkletNode | null> {
  if (node) return node
  starting ??= (async () => {
    try {
      const ctx = await engine.ensureContext()
      const url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
      const n = new AudioWorkletNode(ctx, 'looper', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit' })
      n.port.onmessage = (e: MessageEvent<{ state: LoopState; layers: number; len: number; pos: number; mix?: Float32Array; rate?: number }>) => {
        if (e.data.mix) {
          mixWaiter?.(e.data.mix, e.data.rate ?? 48000)
          mixWaiter = null
          return
        }
        set({ state: e.data.state, layers: e.data.layers, lenSec: e.data.len, pos: e.data.pos })
      }
      gain = ctx.createGain()
      gain.gain.value = view.volume
      engine.output?.connect(n)
      n.connect(gain).connect(ctx.destination)
      node = n
      set({ ready: true, error: null })
      return n
    } catch (err) {
      set({ error: `The looper couldn't start: ${err instanceof Error ? err.message : String(err)}` })
      return null
    } finally {
      starting = null
    }
  })()
  return starting
}

/** The round trip (guitar in, sound out): the Lessons sync's, else a typical one. */
function roundTripMs(): number {
  return loadLatency(deviceKey())?.offsetMs ?? defaultOffsetMs()
}

const send = (m: Record<string, unknown>) => node?.port.postMessage(m)
const beatSec = () => 60 / view.bpm

function stopClicks() {
  if (clickTimer) window.clearInterval(clickTimer)
  clickTimer = null
}

/** Bars mode with the click on: clicks on the loop's beats while it records and plays (accent on bar starts). */
function startClicks() {
  stopClicks()
  if (!view.click || view.mode !== 'bars') return
  let next = 0 // beat index from loopStart
  clickTimer = window.setInterval(() => {
    const ctx = engine.ctx
    if (!ctx || (view.state !== 'recording' && view.state !== 'playing' && view.state !== 'overdubbing')) return
    const b = beatSec()
    while (next * b + loopStart < ctx.currentTime) next++
    while (loopStart + next * b < ctx.currentTime + 0.12) {
      engine.click(loopStart + next * b, next % 4 === 0, 0.35)
      next++
    }
  }, 25)
}

/** The main pedal: record, close the loop (free), overdub on, overdub off, play after a stop. */
export async function looperMain() {
  const n = await ensure()
  const ctx = engine.ctx
  if (!n || !ctx) return
  send({ type: 'rt', ms: roundTripMs() })
  const s = view.state
  if (s === 'idle') {
    if (view.mode === 'free') {
      send({ type: 'record' })
      return
    }
    // Bars: a one-bar count-in, then exactly that many bars from the downbeat.
    const b = beatSec()
    const at = ctx.currentTime + 0.15 + 4 * b
    for (let k = 0; k < 4; k++) engine.click(at - (4 - k) * b, k === 0, 0.5)
    loopStart = at
    send({ type: 'record', at, seconds: view.bars * 4 * b })
    let left = 4
    set({ countIn: left })
    if (countTimer) window.clearInterval(countTimer)
    countTimer = window.setInterval(() => {
      left = Math.ceil((at - ctx.currentTime) / b)
      if (left <= 0) {
        if (countTimer) window.clearInterval(countTimer)
        countTimer = null
        set({ countIn: null })
      } else if (left !== view.countIn) set({ countIn: left })
    }, 50)
    startClicks()
  } else if (s === 'recording') {
    if (view.mode === 'free') send({ type: 'close', at: ctx.currentTime })
  } else if (s === 'playing') send({ type: 'overdub' })
  else if (s === 'overdubbing') send({ type: 'play' })
  else if (s === 'stopped') {
    loopStart = ctx.currentTime
    send({ type: 'play', at: ctx.currentTime })
    startClicks()
  }
}

/** The second pedal: stop while it plays (or throw away a free take still recording), play after a stop. */
export async function looperSecond() {
  const ctx = engine.ctx
  if (!node || !ctx) return
  if (view.state === 'stopped') {
    loopStart = ctx.currentTime
    send({ type: 'play', at: ctx.currentTime })
    startClicks()
  } else if (view.state !== 'idle') {
    send({ type: 'stop' })
    stopClicks()
  }
}

let mixWaiter: ((data: Float32Array, rate: number) => void) | null = null

/** A mono 16-bit WAV file of `data` (−1…1) at `rate`. */
export function wavBlob(data: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + data.length * 2)
  const v = new DataView(buf)
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + data.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, data.length * 2, true)
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true)
  return new Blob([buf], { type: 'audio/wav' })
}

/** The loop as it sounds now (all layers), as a WAV file and its length; null with no loop. */
export function looperMixdown(): Promise<{ blob: Blob; sec: number } | null> {
  if (!node || !view.layers) return Promise.resolve(null)
  return new Promise((resolve) => {
    mixWaiter = (data, rate) => resolve(data.length ? { blob: wavBlob(data, rate), sec: data.length / rate } : null)
    send({ type: 'mix' })
    window.setTimeout(() => {
      if (mixWaiter) {
        mixWaiter = null
        resolve(null)
      }
    }, 3000)
  })
}

export const looperUndo = () => send({ type: 'undo' })
export function looperClear() {
  send({ type: 'clear' })
  stopClicks()
  if (countTimer) window.clearInterval(countTimer)
  countTimer = null
  set({ countIn: null })
}

export function setLooper(patch: Partial<Pick<LooperView, 'mode' | 'bars' | 'bpm' | 'click' | 'volume' | 'panelOpen'>>) {
  set(patch)
  if (patch.volume !== undefined && gain && engine.ctx) gain.gain.setTargetAtTime(patch.volume, engine.ctx.currentTime, 0.02)
  if (patch.click !== undefined) {
    if (patch.click) startClicks()
    else stopClicks()
  }
}
