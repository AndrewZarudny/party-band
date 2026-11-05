// Skill games' stats: best results, a short history and each game's level. Synced with the account; no side effects here.
import { dayKey } from '../practice/data'

export const SKILLS_KEY = 'skills-stats'

export type GameId = 'find' | 'name' | 'changes' | 'clock' | 'ear' | 'record'

export interface SkillEntry {
  id: string
  game: GameId
  at: number // ms
  score: number // the game's main number (found, % right, changes, ms drift, phrase length)
  detail?: string // e.g. the chord pair "A-E"
}

export interface SkillStats {
  v: 1
  best: Record<string, number> // "game" or "game:detail" -> best score
  history: SkillEntry[] // newest first
  levels: { fretMax: number; clockGap: number; earLen: number }
  levelsAt: number // ms of the last level change, so a merge keeps the newer levels (they go down too)
  xp: { day: string; got: number } // XP given to lessons today (capped)
}

const HISTORY_MAX = 300
export const FRET_STEPS = [5, 7, 9, 12]

export function emptyStats(): SkillStats {
  return { v: 1, best: {}, history: [], levels: { fretMax: 5, clockGap: 1, earLen: 2 }, levelsAt: 0, xp: { day: '', got: 0 } }
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const GAMES: GameId[] = ['find', 'name', 'changes', 'clock', 'ear', 'record']

function entryOf(v: unknown): SkillEntry | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !GAMES.includes(o.game as GameId)) return null
  return { id: o.id, game: o.game as GameId, at: num(o.at), score: num(o.score), ...(typeof o.detail === 'string' ? { detail: o.detail } : {}) }
}

export function parseStats(raw: string | null): SkillStats {
  const s = emptyStats()
  if (!raw) return s
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null
    if (!o || typeof o !== 'object') return s
    if (o.best && typeof o.best === 'object')
      for (const [k, v] of Object.entries(o.best as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) s.best[k] = v
    if (Array.isArray(o.history)) s.history = o.history.map(entryOf).filter((x): x is SkillEntry => !!x)
    const l = (o.levels ?? {}) as Record<string, unknown>
    s.levels = {
      fretMax: FRET_STEPS.includes(num(l.fretMax)) ? num(l.fretMax) : 5,
      clockGap: Math.max(1, Math.min(4, Math.round(num(l.clockGap, 1)))),
      earLen: Math.max(2, Math.min(6, Math.round(num(l.earLen, 2)))),
    }
    s.levelsAt = num(o.levelsAt)
    const x = (o.xp ?? {}) as Record<string, unknown>
    s.xp = { day: typeof x.day === 'string' ? x.day : '', got: num(x.got) }
  } catch {
    /* unreadable: start empty */
  }
  return s
}

// Lower is better for drift; higher for everything else.
export const lowerBetter = (game: GameId) => game === 'clock'

export const bestKey = (game: GameId, detail?: string) => (detail ? `${game}:${detail}` : game)

/** Adds a finished round; returns the new stats and whether it beat the best. */
export function record(s: SkillStats, game: GameId, score: number, detail?: string, now = Date.now()): { stats: SkillStats; best: boolean } {
  const k = bestKey(game, detail)
  const old = s.best[k]
  const best = old === undefined || (lowerBetter(game) ? score < old : score > old)
  const e: SkillEntry = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, game, at: now, score, ...(detail ? { detail } : {}) }
  return {
    stats: { ...s, best: best ? { ...s.best, [k]: score } : s.best, history: [e, ...s.history].slice(0, HISTORY_MAX) },
    best,
  }
}

/**
 * Two browsers' copies: history combined by id (newest first), each best the better one,
 * the levels of the copy that changed them last (levels drop after misses, so the higher one is not
 * the right one; copies without a time keep the higher), today's XP the later day (same day: the larger count).
 */
export function mergeStatsRaw(a: string | null, b: string | null): string {
  const x = parseStats(a)
  const y = parseStats(b)
  const seen = new Set(x.history.map((e) => e.id))
  const history = [...x.history, ...y.history.filter((e) => !seen.has(e.id))].sort((p, q) => q.at - p.at).slice(0, HISTORY_MAX)
  const best: Record<string, number> = { ...y.best }
  for (const [k, v] of Object.entries(x.best)) {
    const o = best[k]
    const game = k.split(':')[0] as GameId
    best[k] = o === undefined ? v : lowerBetter(game) ? Math.min(v, o) : Math.max(v, o)
  }
  const levels =
    x.levelsAt !== y.levelsAt
      ? (x.levelsAt > y.levelsAt ? x : y).levels
      : {
          fretMax: Math.max(x.levels.fretMax, y.levels.fretMax),
          clockGap: Math.max(x.levels.clockGap, y.levels.clockGap),
          earLen: Math.max(x.levels.earLen, y.levels.earLen),
        }
  const levelsAt = Math.max(x.levelsAt, y.levelsAt)
  const xp = x.xp.day !== y.xp.day ? (x.xp.day > y.xp.day ? x.xp : y.xp) : { day: x.xp.day, got: Math.max(x.xp.got, y.xp.got) }
  return JSON.stringify({ v: 1, best, history, levels, levelsAt, xp })
}

/** Best score per day for one game (and detail), oldest first: for the progress charts. */
export function dailyBest(s: SkillStats, game: GameId, detail?: string, days = 30): { day: string; score: number }[] {
  const by = new Map<string, number>()
  for (const e of s.history) {
    if (e.game !== game || (detail !== undefined && e.detail !== detail)) continue
    const d = dayKey(new Date(e.at))
    const cur = by.get(d)
    by.set(d, cur === undefined ? e.score : lowerBetter(game) ? Math.min(cur, e.score) : Math.max(cur, e.score))
  }
  return [...by.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1)).slice(-days).map(([day, score]) => ({ day, score }))
}
