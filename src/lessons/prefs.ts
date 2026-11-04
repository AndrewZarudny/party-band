// Lessons tab settings, kept in localStorage.
import type { Prefs, Speed } from './types'

const KEY = 'lessons-prefs'

export const DEFAULT_PREFS: Prefs = {
  speed: 1,
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
}

const SPEEDS: Speed[] = [0.7, 0.85, 1]
const ZOOMS: Prefs['zoom'][] = [0.75, 1, 1.25]

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

function normalize(raw: unknown): Prefs {
  const d = DEFAULT_PREFS
  if (!raw || typeof raw !== 'object') return { ...d }
  const o = raw as Record<string, unknown>
  const nudge = typeof o.visualNudgeMs === 'number' && isFinite(o.visualNudgeMs) ? Math.max(-100, Math.min(100, Math.round(o.visualNudgeMs))) : d.visualNudgeMs
  return {
    speed: SPEEDS.find((s) => s === o.speed) ?? d.speed,
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
