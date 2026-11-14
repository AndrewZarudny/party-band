// Where each band song stands, for the Songs tab: when it was last played and whether to the end, which ones
// need a rehearsal, how far you got with it in Learn a song (band-ready or not), and the band's notes on it.
import type { SongSetup } from './songForm'
import type { PlayLog } from './songLibrary'
import { songKey } from './songLibrary'
import { loadLevels } from './songLevels'

const DAY = 86_400_000
/** Not played for this many days: time to rehearse it again. */
export const REHEARSE_AFTER_DAYS = 14

export interface SongStatus {
  plays: number
  finished: number // played to the end
  lastAt: number | null
  /** Why it needs a rehearsal, or null when it's fresh. */
  rehearse: string | null
}

/** A title without its "(Live)", "- Remastered" and the like, for matching across tabs. */
export const normTitle = (t: string) => t.toLowerCase().replace(/\s*[-–(].*$/, '').trim()

export function songStatus(song: SongSetup, history: PlayLog[], now = Date.now()): SongStatus {
  const k = songKey(song)
  const mine = history.filter((h) => h.key === k)
  const finished = mine.filter((h) => h.finished).length
  const lastAt = mine.length ? Math.max(...mine.map((h) => h.startedAt)) : null
  const days = lastAt === null ? null : Math.floor((now - lastAt) / DAY)
  const rehearse =
    lastAt === null ? 'never played' : !finished ? 'never played to the end' : days !== null && days >= REHEARSE_AFTER_DAYS ? `not played for ${days} days` : null
  return { plays: mine.length, finished, lastAt, rehearse }
}

/** The songs to rehearse, most urgent first: never played, then never finished, then the longest unplayed. */
export function rehearseList(library: SongSetup[], history: PlayLog[], now = Date.now()) {
  const rank = (s: SongStatus) => (s.lastAt === null ? 0 : !s.finished ? 1 : 2)
  return library
    .map((song) => ({ song, st: songStatus(song, history, now) }))
    .filter((x) => x.st.rehearse)
    .sort((a, b) => rank(a.st) - rank(b.st) || (a.st.lastAt ?? 0) - (b.st.lastAt ?? 0))
}

export const agoText = (t: number, now = Date.now()) => {
  const d = Math.floor((now - t) / DAY)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

/**
 * Your own part of a song in Learn a song, matched by title: 'ready' (a whole run at full tempo, band-ready),
 * 'learning' (some parts passed) or null (not started there). Read from what Learn a song keeps per song.
 */
export function learnedState(title: string): { state: 'ready' | 'learning'; done: number; total: number } | null {
  const want = normTitle(title)
  let keys: string[]
  try {
    keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '').filter((k) => k.startsWith('song-runs:'))
  } catch {
    return null
  }
  for (const k of keys) {
    const id = k.slice('song-runs:'.length)
    let runs: { title?: string }[]
    try {
      runs = JSON.parse(localStorage.getItem(k) ?? '[]') as { title?: string }[]
    } catch {
      continue
    }
    const t = runs.find((r) => r?.title)?.title
    if (!t || normTitle(t) !== want) continue
    const l = loadLevels(id)
    if (!l) return null
    if (l.ready) return { state: 'ready', done: l.total, total: l.total }
    return { state: 'learning', done: Object.keys(l.passed).length, total: l.total }
  }
  return null
}

// ---- The band's notes on a song ("watch the chorus ending", "capo 2 for Alina") ----------------------------

const NOTES = 'song-notes'
const readNotes = (): Record<string, string> => {
  try {
    const o = JSON.parse(localStorage.getItem(NOTES) ?? '{}') as Record<string, string>
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}
export const loadSongNote = (key: string) => readNotes()[key] ?? ''
export function saveSongNote(key: string, text: string) {
  const all = readNotes()
  if (text.trim()) all[key] = text.slice(0, 2000)
  else delete all[key]
  try {
    localStorage.setItem(NOTES, JSON.stringify(all))
  } catch {
    /* storage unavailable */
  }
}
