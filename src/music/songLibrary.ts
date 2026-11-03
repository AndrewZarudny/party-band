// Band songs: every song set up for a jam (with its form edits and lyrics), and a log of what was played.
import type { SongSetup } from './songForm'

const LIB = 'band-songs'
const HIST = 'song-history'

export const songKey = (s: { title: string; artist: string }) => `${s.title}|${s.artist}`.toLowerCase()

const read = <T,>(k: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? 'null') as T | null) ?? fallback
  } catch {
    return fallback
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* storage full or unavailable */
  }
}

export const loadLibrary = (): SongSetup[] => read<SongSetup[]>(LIB, [])

/** Adds or updates a song (matched by title and artist), most recent first. */
export function saveToLibrary(song: SongSetup) {
  const k = songKey(song)
  write(LIB, [song, ...loadLibrary().filter((s) => songKey(s) !== k)])
}

export function removeFromLibrary(key: string) {
  write(
    LIB,
    loadLibrary().filter((s) => songKey(s) !== key),
  )
}

// Favourite songs, by songKey (kept apart from the list, so starring a song doesn't reorder it).
const FAV = 'song-favorites'
export const loadFavorites = (): Set<string> => new Set(read<string[]>(FAV, []))
export function setFavorite(key: string, on: boolean) {
  const favs = loadFavorites()
  if (on) favs.add(key)
  else favs.delete(key)
  write(FAV, [...favs])
}

export interface PlayLog {
  id: string
  key: string // songKey
  title: string
  artist: string
  startedAt: number
  endedAt?: number
  playedSec: number
  totalSec: number
  finished: boolean
  players: string[] // "🎤 Alina" …
  withRecording: boolean
}

export const loadHistory = (): PlayLog[] => read<PlayLog[]>(HIST, [])

export function logStart(e: Omit<PlayLog, 'id' | 'playedSec' | 'finished'>): string {
  const id = `p${Date.now().toString(36)}`
  write(HIST, [{ ...e, id, playedSec: 0, finished: false }, ...loadHistory()].slice(0, 300))
  return id
}

/** Finishes a log entry; a play of only a few seconds (a false start) isn't kept. */
export function logEnd(id: string, playedSec: number, finished: boolean) {
  write(
    HIST,
    loadHistory()
      .map((h) => (h.id === id ? { ...h, endedAt: Date.now(), playedSec, finished } : h))
      .filter((h) => h.id !== id || finished || playedSec >= 10),
  )
}

export function clearHistory() {
  write(HIST, [])
}
