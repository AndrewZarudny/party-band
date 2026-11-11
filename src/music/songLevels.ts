// A song as levels: one per section of its tab (Intro, Verse 1, ...), then the whole song.
// A level is passed by playing it through in Learn a song with enough notes right, at 70% speed or faster.
// Kept per song in localStorage (one key per song, so it follows the account like the song's tuning choice).

export const LEVELS_PREFIX = 'song-levels:'
/** Share of the section's notes that must be hit. Heuristic: the same bar as passing a lesson. */
export const PASS_PCT = 70
/** Slowest speed a pass counts at; under it the run is practice. */
export const PASS_SPEED = 70
/** Fewer judged notes than this is too little to call a pass. */
export const MIN_NOTES = 4
const CHUNK = 8 // bars per level when the tab marks no sections

export interface SongSection {
  name: string
  from: number // bar index, inclusive
  to: number // inclusive
}

export interface LevelRecord {
  pct: number // best share of notes hit in a passing run
  speed: number // fastest speed of a passing run, in percent
}

export interface SongLevels {
  track: string // the track the levels were played on
  total: number // sections in the song
  passed: Record<string, LevelRecord> // by section index
  full?: LevelRecord // the whole song, start to end
}

/**
 * The song's sections from its bars' section names (null = no marker on that bar). Bars before the first
 * marker are "Start"; a tab with no markers is cut into 8-bar levels. Repeated names get a number.
 */
export function songSections(names: (string | null)[]): SongSection[] {
  const n = names.length
  if (!n) return []
  const starts = names.map((x, i) => (x && x.trim() ? i : -1)).filter((i) => i >= 0)
  const out: SongSection[] = []
  if (!starts.length) {
    for (let from = 0; from < n; from += CHUNK) {
      const to = Math.min(n, from + CHUNK) - 1
      out.push({ name: `Bars ${from + 1}–${to + 1}`, from, to })
    }
    return out
  }
  if (starts[0] > 0) out.push({ name: 'Start', from: 0, to: starts[0] - 1 })
  starts.forEach((from, k) => out.push({ name: (names[from] as string).trim(), from, to: (starts[k + 1] ?? n) - 1 }))
  // "Chorus", "Chorus" → "Chorus", "Chorus 2"
  const seen = new Map<string, number>()
  for (const s of out) {
    const c = (seen.get(s.name) ?? 0) + 1
    seen.set(s.name, c)
    if (c > 1) s.name = `${s.name} ${c}`
  }
  return out
}

/** A run passes its level with enough notes judged, PASS_PCT of them hit, at PASS_SPEED or faster. */
export function levelPassed(hit: number, miss: number, speed: number): boolean {
  const total = hit + miss
  return total >= MIN_NOTES && speed >= PASS_SPEED && (100 * hit) / total >= PASS_PCT
}

const better = (a: LevelRecord | undefined, b: LevelRecord): LevelRecord => (a ? { pct: Math.max(a.pct, b.pct), speed: Math.max(a.speed, b.speed) } : b)

/** The record after a passing run of section `index` (or of the whole song when index is 'full'). */
export function withPass(l: SongLevels | null, track: string, total: number, index: number | 'full', run: LevelRecord): SongLevels {
  // Another track is another part: its levels start again.
  const base: SongLevels = l && l.track === track ? { ...l, total, passed: { ...l.passed } } : { track, total, passed: {} }
  if (index === 'full') base.full = better(base.full, run)
  else base.passed[String(index)] = better(base.passed[String(index)], run)
  return base
}

/** The first section not passed yet; null when every section is. */
export function nextLevel(l: SongLevels | null, total: number): number | null {
  for (let i = 0; i < total; i++) if (!l?.passed[String(i)]) return i
  return null
}

/** Sections passed, of how many, and whether the whole song is. */
export function levelCount(l: SongLevels | null): { done: number; total: number; full: boolean } {
  if (!l) return { done: 0, total: 0, full: false }
  return { done: Math.min(l.total, Object.keys(l.passed).length), total: l.total, full: !!l.full }
}

const rec = (v: unknown): LevelRecord | null => {
  const o = v as { pct?: unknown; speed?: unknown } | null
  return o && typeof o.pct === 'number' && typeof o.speed === 'number' ? { pct: o.pct, speed: o.speed } : null
}

export function parseLevels(raw: string | null): SongLevels | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { track?: unknown; total?: unknown; passed?: unknown; full?: unknown } | null
    if (!o || typeof o.track !== 'string' || typeof o.total !== 'number') return null
    const passed: Record<string, LevelRecord> = {}
    if (o.passed && typeof o.passed === 'object') for (const [k, v] of Object.entries(o.passed as Record<string, unknown>)) {
      const r = rec(v)
      if (r && /^\d+$/.test(k)) passed[k] = r
    }
    const out: SongLevels = { track: o.track, total: Math.max(0, Math.round(o.total)), passed }
    const full = rec(o.full)
    if (full) out.full = full
    return out
  } catch {
    return null
  }
}

export function loadLevels(songId: string): SongLevels | null {
  try {
    return parseLevels(localStorage.getItem(LEVELS_PREFIX + songId))
  } catch {
    return null
  }
}

export function saveLevels(songId: string, l: SongLevels): void {
  try {
    localStorage.setItem(LEVELS_PREFIX + songId, JSON.stringify(l))
  } catch {
    /* storage unavailable */
  }
}
