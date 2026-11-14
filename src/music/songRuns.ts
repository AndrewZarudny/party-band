// Every judged run in Learn a song, per song: which part, how many notes hit, at what speed, passed or not.
// The level note shows the trend; the weakest part and the coach read it too. The last 300 per song are kept.

export interface SongRun {
  at: number
  part: number | 'full' // section index, or the whole song
  pct: number // notes hit
  speed: number // percent
  passed: boolean
  timingMs?: number | null // average lean against the beat, + = late (when measured)
  missBars?: number[] // bar indexes with a miss, one entry per miss
  title?: string // the song, for summaries across songs
  partName?: string // the part's name (Verse 1, Chorus)
}

const PREFIX = 'song-runs:'
const MAX = 300

export function loadRuns(songId: string): SongRun[] {
  try {
    const a = JSON.parse(localStorage.getItem(PREFIX + songId) ?? '[]') as SongRun[]
    return Array.isArray(a) ? a.filter((r) => r && typeof r.at === 'number' && typeof r.pct === 'number') : []
  } catch {
    return []
  }
}

export function saveRun(songId: string, r: SongRun) {
  const all = [...loadRuns(songId), r].slice(-MAX)
  try {
    localStorage.setItem(PREFIX + songId, JSON.stringify(all))
  } catch {
    /* storage unavailable */
  }
}

/** The last few runs of a part, oldest first: their notes-hit shares, for "58% → 72%". */
export function partTrend(runs: SongRun[], part: number | 'full', n = 5): number[] {
  return runs
    .filter((r) => r.part === part)
    .slice(-n)
    .map((r) => r.pct)
}

/**
 * The weakest part to practise: of the parts not passed yet (or passed under `goodPct`), the one with the lowest
 * recent average (its last 3 runs); a part never played counts as 0. Null when every part is good.
 */
export function weakestPart(runs: SongRun[], parts: number, passed: (i: number) => number | null, goodPct = 85): number | null {
  let best: { i: number; avg: number } | null = null
  for (let i = 0; i < parts; i++) {
    const p = passed(i)
    if (p !== null && p >= goodPct) continue
    const recent = partTrend(runs, i, 3)
    const avg = recent.length ? recent.reduce((a, x) => a + x, 0) / recent.length : 0
    if (!best || avg < best.avg) best = { i, avg }
  }
  return best ? best.i : null
}

/** The bar with the most misses in a run, and how many; null under 2 misses there. */
export function worstBar(bars: number[]): { bar: number; misses: number } | null {
  const n = new Map<number, number>()
  for (const b of bars) n.set(b, (n.get(b) ?? 0) + 1)
  let best: { bar: number; misses: number } | null = null
  for (const [bar, misses] of n) if (!best || misses > best.misses || (misses === best.misses && bar < best.bar)) best = { bar, misses }
  return best && best.misses >= 2 ? best : null
}

/**
 * Work in Learn a song between two times, across every song: per song, the runs, the parts played and passed,
 * and each part's first and last score in the window (to show where it moved). Songs with no runs are left out.
 */
export function songWork(from: number, to: number) {
  const out: { song: string; runs: number; passes: number; parts: { part: string; runs: number; firstPct: number; lastPct: number }[] }[] = []
  let keys: string[]
  try {
    keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '').filter((k) => k.startsWith(PREFIX))
  } catch {
    return out
  }
  for (const k of keys) {
    const runs = loadRuns(k.slice(PREFIX.length)).filter((r) => r.at >= from && r.at < to)
    if (!runs.length) continue
    const byPart = new Map<string, SongRun[]>()
    for (const r of runs) {
      const name = r.partName ?? (r.part === 'full' ? 'Whole song' : `Part ${Number(r.part) + 1}`)
      byPart.set(name, [...(byPart.get(name) ?? []), r])
    }
    out.push({
      song: runs[runs.length - 1].title ?? 'A song',
      runs: runs.length,
      passes: runs.filter((r) => r.passed).length,
      parts: [...byPart.entries()].map(([part, rs]) => ({ part, runs: rs.length, firstPct: rs[0].pct, lastPct: rs[rs.length - 1].pct })),
    })
  }
  return out.sort((a, b) => b.runs - a.runs)
}
