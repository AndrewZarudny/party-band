// Lists that changed on two browsers are combined item by item instead of one copy replacing the other.
import { songKey } from '../music/songLibrary'
import { PRACTICE_KEY, mergePracticeRaw } from '../practice/data'

type Item = Record<string, unknown>

const parseList = (raw: string | null): Item[] | null => {
  if (raw === null) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Item[]) : null
  } catch {
    return null
  }
}

/** The winner's items, then the other side's items the winner lacks. */
function unionBy(win: Item[], other: Item[], key: (x: Item) => string): Item[] {
  const seen = new Set(win.map(key))
  return [...win, ...other.filter((x) => !seen.has(key(x)))]
}

const byId = (x: Item) => String(x.id)
const bySong = (x: Item) => songKey({ title: String(x.title ?? ''), artist: String(x.artist ?? '') })

const MERGERS: Record<string, (win: Item[], other: Item[]) => unknown[]> = {
  'band-songs': (w, o) => unionBy(w, o, bySong),
  'song-history': (w, o) =>
    unionBy(w, o, byId)
      .sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0))
      .slice(0, 300),
  'jam-pinned-phrases': (w, o) => unionBy(w, o, byId),
  'tone-presets': (w, o) => unionBy(w, o, byId),
}

/** Keys merged when both browsers changed them during normal sync. */
export const isMergeKey = (k: string) => k in MERGERS || k === PRACTICE_KEY

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Two copies of the same player's lessons progress: the one with more XP is the base, each lesson keeps the
 * record that was played more, achievements are combined. Null when a side is unreadable.
 */
export function mergeLessonsProgress(a: string, b: string): string | null {
  try {
    const pa = JSON.parse(a) as Item
    const pb = JSON.parse(b) as Item
    if (!pa || !pb || typeof pa !== 'object' || typeof pb !== 'object') return null
    const [base, other] = num(pa.xp) >= num(pb.xp) ? [pa, pb] : [pb, pa]
    const lessons: Record<string, Item> = { ...((other.lessons as Record<string, Item>) ?? {}) }
    for (const [id, r] of Object.entries((base.lessons as Record<string, Item>) ?? {})) {
      const o = lessons[id]
      const better = !o || num(r.plays) > num(o.plays) || (num(r.plays) === num(o.plays) && num(r.lastPlayed) >= num(o.lastPlayed))
      if (better) lessons[id] = r
    }
    const achievements = { ...((other.achievements as Record<string, number>) ?? {}), ...((base.achievements as Record<string, number>) ?? {}) }
    return JSON.stringify({ ...base, lessons, achievements, totalSec: Math.max(num(base.totalSec), num(other.totalSec)) })
  } catch {
    return null
  }
}

/**
 * Combines two values of a list key; `win` wins per item. In the first sign-in merge, favourites are
 * combined too (the guest's stars are added). Returns null when the key isn't a list or a side is unreadable.
 */
export function mergeValues(k: string, win: string | null, other: string | null, firstSignIn = false): string | null {
  // Practice time: per-browser buckets, the larger count wins, so either order gives the same result.
  if (k === PRACTICE_KEY) return mergePracticeRaw(win, other)
  const merger = MERGERS[k]
  if (!merger && !(firstSignIn && k === 'song-favorites')) return null
  const w = parseList(win)
  const o = parseList(other)
  if (!w || !o) return null
  if (merger) return JSON.stringify(merger(w, o))
  // Favourites are plain strings.
  const ws = JSON.parse(win ?? '[]') as unknown[]
  const os = JSON.parse(other ?? '[]') as unknown[]
  return JSON.stringify([...new Set([...ws, ...os].filter((x) => typeof x === 'string'))])
}
