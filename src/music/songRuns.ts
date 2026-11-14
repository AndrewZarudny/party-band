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
