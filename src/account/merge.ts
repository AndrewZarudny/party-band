// Lists that changed on two browsers are combined item by item instead of one copy replacing the other.
import { songKey } from '../music/songLibrary'
import { PRACTICE_KEY, mergePracticeRaw } from '../practice/data'
import { HALF_LIFE_DAYS, MAX_CELLS } from '../lessons/heat'
import { SKILLS_KEY, mergeStatsRaw } from '../skills/data'

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
export const isMergeKey = (k: string) => k in MERGERS || k === PRACTICE_KEY || k === SKILLS_KEY

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const dayOf = (x: unknown) => (x && typeof x === 'object' && typeof (x as Item).day === 'string' ? String((x as Item).day) : '')
const doneSteps = (x: unknown) => {
  const s = x && typeof x === 'object' ? (x as Item).steps : null
  return Array.isArray(s) ? s.filter((t) => t && typeof t === 'object' && (t as Item).state === 'done').length : 0
}

/** Today's set from two copies: the later day wins; on the same day the one with more done steps, keeping a given bonus. */
function mergePlan(a: unknown, b: unknown): unknown {
  const da = dayOf(a)
  const db = dayOf(b)
  if (!da && !db) return null
  if (da !== db) return da > db ? a : b
  const win = doneSteps(a) >= doneSteps(b) ? a : b
  return { ...(win as Item), bonus: (a as Item).bonus === true || (b as Item).bonus === true }
}

/** The plan streak with the later last day; on the same day, the longer one. */
function mergeStreak(a: unknown, b: unknown): unknown {
  const la = dayOf({ day: (a as Item | null)?.last })
  const lb = dayOf({ day: (b as Item | null)?.last })
  if (la !== lb) return la > lb ? a : b
  return num((a as Item | null)?.days) >= num((b as Item | null)?.days) ? (a ?? null) : (b ?? null)
}

/** Mistake heat from two copies: per cell the later day wins; on the same day the one with more events. */
function mergeHeat(a: unknown, b: unknown): unknown {
  const ca = (a as Item | null | undefined)?.cells as Record<string, Item> | undefined
  const cb = (b as Item | null | undefined)?.cells as Record<string, Item> | undefined
  if (!ca && !cb) return undefined
  const cells: Record<string, Item> = { ...(cb ?? {}) }
  for (const [k, x] of Object.entries(ca ?? {})) {
    const o = cells[k]
    if (!o || num(x.d) > num(o.d) || (num(x.d) === num(o.d) && num(x.n) >= num(o.n))) cells[k] = x
  }
  const keys = Object.keys(cells)
  if (keys.length <= MAX_CELLS) return { v: 1, cells }
  // Over the cap: keep the cells with the most events once faded to the newest day.
  const newest = Math.max(...keys.map((k) => num(cells[k].d)))
  const weight = (k: string) => num(cells[k].n) * 0.5 ** ((newest - num(cells[k].d)) / HALF_LIFE_DAYS)
  const kept: Record<string, Item> = {}
  for (const k of keys.sort((a, b) => weight(b) - weight(a)).slice(0, MAX_CELLS)) kept[k] = cells[k]
  return { v: 1, cells: kept }
}

/**
 * Two copies of the same player's lessons progress: the one with more XP is the base, each lesson keeps the
 * record that was played more, achievements are combined, today's set and the plan streak take the later day,
 * heat cells take the later day. Loop counts live in lesson records and follow the record that wins.
 * Null when a side is unreadable.
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
    return JSON.stringify({
      ...base,
      lessons,
      achievements,
      totalSec: Math.max(num(base.totalSec), num(other.totalSec)),
      plan: mergePlan(base.plan, other.plan),
      planStreak: mergeStreak(base.planStreak, other.planStreak) ?? { days: 0, last: '' },
      heat: mergeHeat(base.heat, other.heat),
    })
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
  // Skill games: history combined, the better best and the higher level kept.
  if (k === SKILLS_KEY) return mergeStatsRaw(win, other)
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
