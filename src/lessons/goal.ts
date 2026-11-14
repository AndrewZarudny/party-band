// A song goal with a date: "play Numb with the band by 31 December". Progress is measured along the song's path
// (parts, each part with the song, the whole song, band-ready) against the time passed since the goal was set.
// The plan puts the goal song in every session's Song block; the coach is told how it is going.
import type { SongLevels } from '../music/songLevels'

export interface SongGoal {
  songId: string
  title: string
  by: string // 'YYYY-MM-DD'
  setAt: number // ms
}

const KEY = 'song-goal'

export function loadGoal(): SongGoal | null {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SongGoal> | null
    return o && typeof o.songId === 'string' && typeof o.title === 'string' && typeof o.by === 'string' && typeof o.setAt === 'number' ? (o as SongGoal) : null
  } catch {
    return null
  }
}
export function saveGoal(g: SongGoal | null) {
  try {
    if (g) localStorage.setItem(KEY, JSON.stringify(g))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable */
  }
}

/** How far along the song's path, 0–1: parts 40%, each part with the song 25%, the whole song 20%, band-ready 15%. */
export function pathShare(parts: { passed: boolean }[], levels: SongLevels | null): number {
  const partsShare = parts.length ? parts.filter((p) => p.passed).length / parts.length : 1
  const sections = levels?.total ? Math.min(levels.total, Object.keys(levels.passed).length) / levels.total : 0
  // A song without part lessons starts at Learn a song: its parts share is the sections one.
  const p = parts.length ? partsShare : sections
  return 0.4 * p + 0.25 * sections + 0.2 * (levels?.full ? 1 : 0) + 0.15 * (levels?.ready ? 1 : 0)
}

export type GoalStatus = 'done' | 'ahead' | 'on track' | 'behind' | 'past'

/** Where the goal stands: progress against the share of the time passed, and the days left. */
export function goalPace(g: SongGoal, share: number, now: Date): { status: GoalStatus; share: number; due: number; daysLeft: number } {
  const end = new Date(g.by + 'T23:59:59').getTime()
  const daysLeft = Math.ceil((end - now.getTime()) / 86_400_000)
  const span = Math.max(1, end - g.setAt)
  const due = Math.max(0, Math.min(1, (now.getTime() - g.setAt) / span))
  const status: GoalStatus = share >= 1 ? 'done' : daysLeft < 0 ? 'past' : share >= due + 0.1 ? 'ahead' : share >= due - 0.1 ? 'on track' : 'behind'
  return { status, share, due, daysLeft }
}

/** The goal's standing from this browser's data (registered part lessons, saved levels), for the coach. */
export function goalFacts(isPassed: (id: string) => boolean, exists: (id: string) => boolean, levelsOf: (songId: string) => SongLevels | null, now: Date) {
  const g = loadGoal()
  if (!g) return null
  // The song's part lessons that are built now (song:<id>:<section index>).
  const parts = Array.from({ length: 64 }, (_, i) => `song:${g.songId}:${i}`).filter(exists).map((id) => ({ passed: isPassed(id) }))
  const levels = levelsOf(g.songId)
  const pace = goalPace(g, pathShare(parts, levels), now)
  return { song: g.title, bandReadyBy: g.by, daysLeft: pace.daysLeft, progressPercent: Math.round(pace.share * 100), expectedByNowPercent: Math.round(pace.due * 100), status: pace.status }
}
