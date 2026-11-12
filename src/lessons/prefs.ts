// Lessons tab settings, kept in localStorage.
import type { Prefs } from './types'
import { cleanSpeed } from './speed'

const KEY = 'lessons-prefs'

export const DEFAULT_PREFS: Prefs = {
  speedPick: null,
  easyTiming: false,
  backingOn: true,
  keyboard: false,
  input: 'cable',
  micId: null,
  zoom: 1,
  visualNudgeMs: 0,
  showFretboard: true,
  lastLesson: null,
  seenRoar: false,
  age: null,
  guides: 'auto',
  seenBasics: false,
  jamIdeas: true,
  jamBandVol: 1,
  jamTracks: {},
}

const ZOOMS: Prefs['zoom'][] = [0.75, 1, 1.25]
const GUIDES: Prefs['guides'][] = ['auto', 'on', 'off']

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

/** A saved manual speed for one lesson; null = Auto. */
function pickOf(v: unknown): Prefs['speedPick'] {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const speed = cleanSpeed(o.speed)
  return typeof o.lessonId === 'string' && speed !== undefined ? { lessonId: o.lessonId, speed } : null
}

function normalize(raw: unknown): Prefs {
  const d = DEFAULT_PREFS
  if (!raw || typeof raw !== 'object') return { ...d }
  const o = raw as Record<string, unknown>
  const nudge = typeof o.visualNudgeMs === 'number' && isFinite(o.visualNudgeMs) ? Math.max(-100, Math.min(100, Math.round(o.visualNudgeMs))) : d.visualNudgeMs
  return {
    // Old saved `speed` values are ignored on purpose: everyone starts on Auto once.
    speedPick: pickOf(o.speedPick),
    easyTiming: bool(o.easyTiming, d.easyTiming),
    backingOn: bool(o.backingOn, d.backingOn),
    keyboard: bool(o.keyboard, d.keyboard),
    input: o.input === 'mic' ? 'mic' : 'cable',
    micId: typeof o.micId === 'string' ? o.micId : null,
    zoom: ZOOMS.find((z) => z === o.zoom) ?? d.zoom,
    visualNudgeMs: nudge,
    showFretboard: bool(o.showFretboard, d.showFretboard),
    lastLesson: typeof o.lastLesson === 'string' ? o.lastLesson : null,
    seenRoar: bool(o.seenRoar, d.seenRoar),
    age: typeof o.age === 'number' && isFinite(o.age) && o.age >= 3 && o.age <= 120 ? Math.round(o.age) : null,
    guides: GUIDES.find((g) => g === o.guides) ?? d.guides,
    seenBasics: bool(o.seenBasics, d.seenBasics),
    jamIdeas: bool(o.jamIdeas, d.jamIdeas),
    jamTracks:
      o.jamTracks && typeof o.jamTracks === 'object'
        ? Object.fromEntries(Object.entries(o.jamTracks as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
        : {},
    jamBandVol: typeof o.jamBandVol === 'number' && isFinite(o.jamBandVol) ? Math.max(0.1, Math.min(1, o.jamBandVol)) : d.jamBandVol,
  }
}

/** Settings from any saved shape (an account's copy, an old version), with defaults filled in. */
export const parsePrefs = (raw: unknown): Prefs => normalize(raw)

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normalize(JSON.parse(raw)) : { ...DEFAULT_PREFS }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable */
  }
}
