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

/** Today's session plan from two copies (v2 plans only): the later day wins; on the same day the one with more done steps. */
function mergePlan(a: unknown, b: unknown): unknown {
  const v2 = (x: unknown) => (x && typeof x === 'object' && (x as Item).v === 2 ? x : null)
  const pa = v2(a)
  const pb = v2(b)
  const da = dayOf(pa)
  const db = dayOf(pb)
  if (!da && !db) return null
  if (da !== db) return da > db ? pa : pb
  const win = { ...((doneSteps(pa) >= doneSteps(pb) ? pa : pb) as Item) }
  delete win.bonus
  return win
}

const PAIN_RANK: Record<string, number> = { sharp: 3, mild: 2, none: 1 }

/** Session logs: one entry per day; same day: the larger time, any set/counted/pocket, the worse pain. */
function mergeSessions(a: unknown, b: unknown): { log: Item[]; before: number } {
  const sa = (a && typeof a === 'object' ? a : {}) as Item
  const sb = (b && typeof b === 'object' ? b : {}) as Item
  const days = new Map<string, Item>()
  const add = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const x of list) {
      if (!x || typeof x !== 'object' || typeof (x as Item).day !== 'string') continue
      const d = x as Item
      const o = days.get(String(d.day))
      if (!o) {
        days.set(String(d.day), { ...d })
        continue
      }
      const m: Item = {
        ...(o.set !== true && d.set === true ? d : o),
        sec: Math.max(num(o.sec), num(d.sec)),
        set: o.set === true || d.set === true,
        counted: o.counted === true || d.counted === true,
        pocket: o.pocket === true || d.pocket === true,
      }
      const pain = (PAIN_RANK[String(d.pain)] ?? 0) > (PAIN_RANK[String(o.pain)] ?? 0) ? d.pain : o.pain
      if (pain === undefined) delete m.pain
      else m.pain = pain
      // the week goal that applied that day
      const goal = m.goal ?? o.goal ?? d.goal
      if (goal !== undefined) m.goal = goal
      days.set(String(d.day), m)
    }
  }
  add(sa.log)
  add(sb.log)
  const log = [...days.values()].sort((x, y) => (String(x.day) < String(y.day) ? -1 : String(x.day) > String(y.day) ? 1 : 0))
  return { log, before: Math.max(num(sa.before), num(sb.before)) }
}

const HIST_MAX = 16

/** Session history of one lesson from two copies, by session number. */
function mergeHist(a: unknown, b: unknown): Item[] | undefined {
  if (!Array.isArray(a) && !Array.isArray(b)) return undefined
  const by = new Map<number, Item>()
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue
    for (const x of list) {
      if (!x || typeof x !== 'object' || typeof (x as Item).s !== 'number') continue
      const e = x as Item
      const o = by.get(num(e.s))
      if (!o) {
        by.set(num(e.s), { ...e })
        continue
      }
      const m: Item = { ...o }
      if (typeof e.best === 'number') m.best = typeof o.best === 'number' ? Math.max(o.best, e.best) : e.best
      const oc = o.cold as Item | undefined
      const ec = e.cold as Item | undefined
      if (ec && (!oc || (ec.clean === true && oc.clean !== true))) m.cold = ec
      by.set(num(e.s), m)
    }
  }
  return [...by.values()].sort((x, y) => num(x.s) - num(y.s)).slice(-HIST_MAX)
}

/** Session number of the newest cold attempt (clean or not) in a lesson's history; 0 when none. */
function newestCold(hist: unknown): number {
  if (!Array.isArray(hist)) return 0
  return Math.max(0, ...hist.filter((e) => e && typeof e === 'object' && (e as Item).cold).map((e) => num((e as Item).s)))
}

/**
 * The review of the copy with the newer cold attempt (a failed one moves the review too), then the later counted
 * cold pass, then more cold passes; ties keep the winner's.
 */
function pickReview(win: unknown, other: unknown, winHist: unknown, otherHist: unknown): unknown {
  const w = win as Item | undefined
  const o = other as Item | undefined
  if (!o) return w
  if (!w) return o
  const cw = newestCold(winHist)
  const co = newestCold(otherHist)
  if (cw !== co) return co > cw ? o : w
  if (num(o.lastColdS) !== num(w.lastColdS)) return num(o.lastColdS) > num(w.lastColdS) ? o : w
  return num(o.coldPasses) > num(w.coldPasses) ? o : w
}

/** Union of string lists, sorted, newest `max`. */
const unionSorted = (a: unknown, b: unknown, max: number) =>
  [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].filter((x): x is string => typeof x === 'string'))].sort().slice(-max)

/** Run samples by time and lesson, oldest first, newest 300. */
function mergeRuns(a: unknown, b: unknown): Item[] {
  const by = new Map<string, Item>()
  for (const list of [a, b]) if (Array.isArray(list)) for (const x of list) if (x && typeof x === 'object') by.set(`${num((x as Item).at)}|${String((x as Item).id)}`, x as Item)
  return [...by.values()].sort((x, y) => num(x.at) - num(y.at)).slice(-300)
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
 * record that was played more (its session history combined, the review with the later cold pass, the faster pass speed), achievements
 * are combined, today's plan takes the later day, session logs, met weeks and run samples are combined, heat cells
 * take the later day. Loop counts live in lesson records and follow the record that wins.
 * Null when a side is unreadable.
 */
export function mergeLessonsProgress(a: string, b: string): string | null {
  try {
    const pa = JSON.parse(a) as Item
    const pb = JSON.parse(b) as Item
    if (!pa || !pb || typeof pa !== 'object' || typeof pb !== 'object') return null
    const [base, other] = num(pa.xp) >= num(pb.xp) ? [pa, pb] : [pb, pa]
    const lessons: Record<string, Item> = { ...((other.lessons as Record<string, Item>) ?? {}) }
    const otherLessons = (other.lessons as Record<string, Item>) ?? {}
    for (const [id, r] of Object.entries((base.lessons as Record<string, Item>) ?? {})) {
      const o = lessons[id]
      const better = !o || num(r.plays) > num(o.plays) || (num(r.plays) === num(o.plays) && num(r.lastPlayed) >= num(o.lastPlayed))
      if (better) lessons[id] = r
    }
    // Session history is combined; the review follows the later cold pass.
    for (const id of Object.keys(lessons)) {
      const a = (base.lessons as Record<string, Item> | undefined)?.[id]
      const b = otherLessons[id]
      if (!a || !b) continue
      const winner = lessons[id]
      const lose = winner === a ? b : a
      const win = { ...winner }
      const hist = mergeHist(a.hist, b.hist)
      if (hist) win.hist = hist
      const review = pickReview(winner.review, lose.review, winner.hist, lose.hist)
      if (review) win.review = review
      // The pass speed is the fastest passing speed (as applyResult keeps it): a faster pass on the other side counts.
      const speeds = [winner.passedSpeed, lose.passedSpeed].filter((v): v is number => typeof v === 'number' && isFinite(v))
      if (winner.passedAt !== undefined && speeds.length) win.passedSpeed = Math.max(...speeds)
      lessons[id] = win
    }
    const achievements = { ...((other.achievements as Record<string, number>) ?? {}), ...((base.achievements as Record<string, number>) ?? {}) }
    // Old day-streak fields are not carried over: progress.ts no longer reads them.
    const rest = { ...base }
    delete rest.planStreak
    return JSON.stringify({
      ...rest,
      lessons,
      achievements,
      totalSec: Math.max(num(base.totalSec), num(other.totalSec)),
      plan: mergePlan(base.plan, other.plan),
      heat: mergeHeat(base.heat, other.heat),
      sessions: mergeSessions(base.sessions, other.sessions),
      weekXp: unionSorted(base.weekXp, other.weekXp, 20),
      runs: mergeRuns(base.runs, other.runs),
      ...(base.seenWeekly === true || other.seenWeekly === true ? { seenWeekly: true } : {}),
      keepOpen: unionSorted(base.keepOpen, other.keepOpen, 200),
      dinoBonus: Math.max(num(base.dinoBonus), num(other.dinoBonus)),
      // An old-map side keeps mapV off, so loading the merge migrates it (keepOpen and dinoBonus only grow).
      mapV: base.mapV === 2 && other.mapV === 2 ? 2 : undefined,
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
