// Song tone: one or more amp tones for a song part, and from which bar each one plays.
import type * as alphaTab from '@coderline/alphatab'
import type { Tone } from './tone'
import type { GearRef } from './presets'
export type { GearRef } from './presets'
import { presetByName, suggestTone } from './tone'

type Score = alphaTab.model.Score
type Track = alphaTab.model.Track

export interface ToneVariant {
  id: string
  name: string
  settings: Tone
  capture?: GearRef // NAM amp/pedal capture replacing the built-in amp
  ir?: GearRef // cabinet impulse response
  presetId?: string // use a saved tone preset for this part instead
}

export interface SongToneData {
  source: 'estimate' | 'custom'
  tones: ToneVariant[]
  timeline: { bar: number; tone: string }[] // bar is 1-based
}

export interface Cue {
  bar: number // 1-based
  text: string
}

/** Section names and text notes ("Clean sound", "Distortion: fade in") from the tab file. */
export function readCues(score: Score, track: Track): Cue[] {
  const cues: Cue[] = []
  score.masterBars.forEach((mb, i) => {
    const sec = mb.section
    if (sec && (sec.text || sec.marker)) cues.push({ bar: i + 1, text: `[section] ${[sec.marker, sec.text].filter(Boolean).join(' ')}` })
  })
  for (const bar of track.staves[0]?.bars ?? []) {
    for (const v of bar.voices)
      for (const b of v.beats) {
        if (b.text && b.text.trim()) cues.push({ bar: bar.index + 1, text: `[note] ${b.text.trim()}` })
      }
  }
  // De-duplicate repeated notes on the same bar and keep order.
  const seen = new Set<string>()
  return cues.filter((c) => (seen.has(`${c.bar}|${c.text}`) ? false : (seen.add(`${c.bar}|${c.text}`), true))).sort((a, b) => a.bar - b.bar)
}

/** Without AI: one tone from artist/instrument, plus clean/drive/lead switches where the file's notes say so. */
export function estimateTone(meta: { artist: string; title: string; trackName: string; program?: number }, cues: Cue[]): SongToneData {
  const main = suggestTone(meta)
  const drive = main.gain >= 3 ? main : presetByName('Classic rock')
  const tones: ToneVariant[] = [{ id: 'main', name: main.name, settings: main }]
  const timeline: SongToneData['timeline'] = [{ bar: 1, tone: 'main' }]
  const add = (id: string, name: string, settings: Tone) => {
    if (!tones.some((t) => t.id === id)) tones.push({ id, name, settings })
  }
  for (const c of cues) {
    const t = c.text.toLowerCase()
    let id: string | null = null
    if (/clean|acoustic|arpegg/.test(t)) {
      id = main.gain < 3 ? 'main' : 'clean'
      if (id === 'clean') add('clean', 'Clean', presetByName('Clean'))
    } else if (/dist|overdrive|crunch|heavy|fuzz|rhythm gtr/.test(t)) {
      id = main.gain >= 3 ? 'main' : 'drive'
      if (id === 'drive') add('drive', drive.name, drive)
    } else if (/solo|lead/.test(t)) {
      id = 'lead'
      add('lead', 'Lead', presetByName('Lead'))
    }
    if (id && timeline[timeline.length - 1].tone !== id) timeline.push({ bar: c.bar, tone: id })
  }
  // If the song starts on a "clean" note at bar 1, make that the opening tone.
  if (timeline.length > 1 && timeline[1].bar === 1) timeline.shift()
  return { source: 'estimate', tones, timeline }
}

/** The tone that plays at a bar (1-based). */
export function toneAt(data: SongToneData, bar: number): ToneVariant {
  let id = data.timeline[0]?.tone
  for (const e of data.timeline) if (e.bar <= bar) id = e.tone
  return data.tones.find((t) => t.id === id) ?? data.tones[0]
}

const key = (artist: string, title: string, track: string) => `song-tone:${artist.toLowerCase()}|${title.toLowerCase()}#${track.toLowerCase()}`

export function loadToneData(artist: string, title: string, track: string): SongToneData | null {
  try {
    return JSON.parse(localStorage.getItem(key(artist, title, track)) ?? 'null') as SongToneData | null
  } catch {
    return null
  }
}

export function saveToneData(artist: string, title: string, track: string, data: SongToneData) {
  try {
    localStorage.setItem(key(artist, title, track), JSON.stringify(data))
  } catch {
    /* storage unavailable */
  }
}
