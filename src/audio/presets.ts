// The current tone (amp settings + optional capture and cab IR) and the user's saved tone presets.
import { engine } from './engine'
import type { Tone } from './tone'
import { PRESETS } from './tone'
import { getCapture, saveCapture } from '../music/library'
import type { CaptureEntry } from '../music/library'

/** A capture or IR in the local library (IndexedDB), by id, with its credits. */
export interface GearRef {
  id: string
  name: string
  gear?: 'amp' | 'amp-cab' | 'pedal'
  creator?: string
  license?: string
  url?: string
}

export interface TonePreset {
  id: string
  name: string
  settings: Tone
  capture?: GearRef // NAM amp/pedal capture replacing the built-in amp
  ir?: GearRef // cabinet impulse response
  builtIn?: boolean
}

// ---- Saved presets ----------------------------------------------------------

export const BUILT_IN: TonePreset[] = PRESETS.map((p) => ({ id: `builtin:${p.name}`, name: p.name, settings: p, builtIn: true }))

export function loadPresets(): TonePreset[] {
  try {
    return JSON.parse(localStorage.getItem('tone-presets') ?? '[]') as TonePreset[]
  } catch {
    return []
  }
}

function storePresets(p: TonePreset[]) {
  try {
    localStorage.setItem('tone-presets', JSON.stringify(p))
  } catch {
    /* storage unavailable */
  }
  emit()
}

export const allPresets = () => [...loadPresets(), ...BUILT_IN]
export const findPreset = (id?: string) => (id ? allPresets().find((p) => p.id === id) : undefined)

/** Saves the current tone as a preset (new, or overwriting `id`). Returns the preset. */
export function savePreset(name: string, id?: string): TonePreset {
  const list = loadPresets()
  const preset: TonePreset = {
    id: id ?? `user:${Date.now().toString(36)}`,
    name: name.trim() || 'My tone',
    settings: { ...engine.tone, name: name.trim() || 'My tone' },
    capture: current.capture,
    ir: current.ir,
  }
  const i = list.findIndex((p) => p.id === preset.id)
  if (i >= 0) list[i] = preset
  else list.unshift(preset)
  storePresets(list)
  current.presetId = preset.id
  emit()
  return preset
}

export function deletePreset(id: string) {
  storePresets(loadPresets().filter((p) => p.id !== id))
  if (current.presetId === id) current.presetId = undefined
}

// ---- The current tone ---------------------------------------------------------

const current: { presetId?: string; capture?: GearRef; ir?: GearRef } = {}
const loaded = { capture: '', ir: '' }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const currentSetup = () => ({ ...current })
export function onSetup(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

// Loads one change at a time, then checks again: clicking tones quickly ends on the last one clicked, never
// on a slow capture that finished loading after a later choice.
let loading: Promise<void> | null = null
let again = false
async function loadGearOnce() {
  const want = { capture: current.capture?.id ?? '', ir: current.ir?.id ?? '' }
  if (want.capture !== loaded.capture) {
    const c = want.capture ? await getCapture(want.capture) : undefined
    await engine.setCapture(c ? { kind: c.gear ?? 'amp', name: c.name, json: new TextDecoder().decode(c.data) } : null)
    loaded.capture = want.capture
  }
  if (want.ir !== loaded.ir) {
    const c = want.ir ? await getCapture(want.ir) : undefined
    await engine.setIr(c ? { name: c.name, data: c.data } : null)
    loaded.ir = want.ir
  }
}
function loadGear(): Promise<void> {
  if (loading) {
    again = true
    return loading
  }
  loading = (async () => {
    try {
      do {
        again = false
        await loadGearOnce()
      } while (again || (current.capture?.id ?? '') !== loaded.capture || (current.ir?.id ?? '') !== loaded.ir)
    } finally {
      loading = null
    }
  })()
  return loading
}

/** Switches to a whole tone: amp settings plus its capture and cab (loaded only when they change). */
export async function applyTone(t: { id?: string; name: string; settings: Tone; capture?: GearRef; ir?: GearRef }) {
  current.presetId = t.id
  current.capture = t.capture
  current.ir = t.ir
  engine.setTone({ ...t.settings, name: t.name })
  emit()
  await loadGear()
}

/** Replaces the current tone's capture or cab. */
export async function setGear(slot: 'capture' | 'ir', ref: GearRef | undefined) {
  current[slot] = ref
  emit()
  await loadGear()
}

/** Stores a downloaded or imported file in the local library and puts it on the current tone. */
export async function addGear(entry: CaptureEntry) {
  await saveCapture(entry)
  await setGear(entry.kind === 'ir' ? 'ir' : 'capture', { id: entry.id, name: entry.name, gear: entry.gear, creator: entry.creator, license: entry.license, url: entry.url })
}

/** A .nam capture or .wav IR from disk or the Downloads folder. */
export async function importGearFile(file: File) {
  const isIr = /\.wav$/i.test(file.name)
  await addGear({
    id: `file-${Date.now()}`,
    kind: isIr ? 'ir' : 'nam',
    name: file.name.replace(/\.[^.]+$/, ''),
    gear: isIr ? undefined : 'amp',
    addedAt: Date.now(),
    data: await file.arrayBuffer(),
  })
}

// ---- The song open in Learn a song (for "Get original tone") -------------------

export interface SongInfo {
  artist: string
  title: string
  track: string
  cues: string[]
}
let song: SongInfo | null = null
export const getCurrentSong = () => song
export function setCurrentSong(s: SongInfo | null) {
  song = s
  emit()
}

/** Asks Learn a song to use this preset for the song part that's playing (picked up via onSetup). */
let pendingLink: string | null = null
export function linkToCurrentSong(presetId: string) {
  pendingLink = presetId
  emit()
}
export function takePendingLink(): string | null {
  const p = pendingLink
  pendingLink = null
  return p
}

/**
 * A TONE3000 download (.zip of captures/IRs): loads a playable (A2) capture and the first IR.
 * Returns what was loaded, or null if the zip has nothing usable.
 */
export async function importGearZip(file: File): Promise<string | null> {
  const { unzipSync } = await import('fflate')
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const base = file.name.replace(/\.zip$/i, '')
  const nams = Object.entries(files)
    .filter(([n]) => /\.nam$/i.test(n) && !n.startsWith('__MACOSX'))
    .filter(([, d]) => {
      try {
        return (JSON.parse(new TextDecoder().decode(d)) as { architecture?: string }).architecture === 'SlimmableContainer'
      } catch {
        return false
      }
    })
    .sort(([a], [b]) => a.localeCompare(b))
  const wav = Object.entries(files).find(([n]) => /\.wav$/i.test(n) && !n.startsWith('__MACOSX'))
  const loaded: string[] = []
  if (nams.length) {
    // Several versions (usually gain steps): take the middle one; the others stay in the zip.
    const [path, data] = nams[Math.floor((nams.length - 1) / 2)]
    const name = `${base} · ${path.split('/').pop()!.replace(/\.nam$/i, '')}`
    await addGear({ id: `zip-${Date.now()}`, kind: 'nam', name, gear: /full.?rig|cab|4x12|2x12|1x12/i.test(base) ? 'amp-cab' : 'amp', addedAt: Date.now(), data: data.slice().buffer })
    loaded.push(name)
  }
  if (wav) {
    const name = `${base} · ${wav[0].split('/').pop()!.replace(/\.wav$/i, '')}`
    await addGear({ id: `zip-ir-${Date.now()}`, kind: 'ir', name, addedAt: Date.now(), data: wav[1].slice().buffer })
    loaded.push(name)
  }
  return loaded.length ? loaded.join(' + ') : null
}
