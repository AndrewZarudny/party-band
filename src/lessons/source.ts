// Where the Lessons tab listens: the guitar cable into an audio interface, or a microphone in the room.
import { engine } from '../audio/engine'
import type { InputSource } from './types'

const INTERFACE = /scarlett|focusrite|audient|motu|presonus|behringer|steinberg|universal audio|\bssl\b|arturia|m-audio|line 6|irig|audio interface/i
// Inputs that carry the computer's own sound, never a guitar.
const NOT_AN_INPUT = /loopback|stereo mix|what u hear|wave out/i
// Two-input Focusrite boxes: the instrument jack is input 2, the right channel.
const INPUT_2_IS_GUITAR = /scarlett|focusrite/i

export interface SourceDevice {
  id: string
  label: string
  iface: boolean // an audio interface (has an instrument input)
}

/** Real device labels; the browser hides them until an input has been allowed once. */
async function rawInputs(): Promise<MediaDeviceInfo[]> {
  const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  if (all.length && all.every((d) => !d.label)) {
    // Ask once, then let go of the stream: this must not switch the engine's live input.
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  }
  return all
}

export async function listSources(): Promise<SourceDevice[]> {
  return (await rawInputs())
    .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && !NOT_AN_INPUT.test(d.label))
    .map((d) => ({ id: d.deviceId, label: d.label || 'Microphone', iface: INTERFACE.test(d.label) }))
}

/** The microphone a 'mic' source uses: the saved one, else the first input that isn't an interface. */
export function pickMic(list: SourceDevice[], micId: string | null): SourceDevice | null {
  return list.find((d) => d.id === micId) ?? list.find((d) => !d.iface) ?? list[0] ?? null
}

let inFlight: Promise<unknown> = Promise.resolve()

/**
 * Connects the engine to the source. Cable: the interface's instrument input (input 2 on a Scarlett).
 * Mic: a separate mic hears both channels; a mic plugged into the interface is its input 1.
 * Calls run one at a time, so two quick clicks can't open two streams.
 * Throws 'no-interface' / 'no-mic' when there is nothing to connect to.
 */
export function connectSource(source: InputSource, micId: string | null): Promise<string> {
  const run = inFlight.catch(() => {}).then(() => doConnect(source, micId))
  inFlight = run
  return run
}

async function doConnect(source: InputSource, micId: string | null): Promise<string> {
  const list = await listSources()
  if (source === 'cable') {
    const dev = list.find((d) => d.iface)
    if (!dev) throw new Error('no-interface')
    await engine.start(dev.id)
    engine.setChannel(INPUT_2_IS_GUITAR.test(dev.label) ? 'right' : 'auto')
    return dev.label
  }
  const dev = pickMic(list, micId)
  if (!dev) throw new Error('no-mic')
  await engine.start(dev.id)
  engine.setChannel(dev.iface ? 'left' : 'mix')
  return dev.label
}

/** True when the engine hears a mic: a non-interface input, or an interface's mic input. */
export function onMicInput(): boolean {
  const iface = INTERFACE.test(engine.info.label)
  const left = engine.channel === 'left' || engine.channel === 'mix' || (engine.channel === 'auto' && engine.autoPick === 'left')
  return !iface || left
}

/** True when the engine is listening the way `source` asks (so the lesson can start without switching). */
export function sourceMatches(source: InputSource): boolean {
  if (!engine.running) return false
  return source === 'mic' ? onMicInput() : !onMicInput()
}
