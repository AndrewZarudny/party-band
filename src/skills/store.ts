// Reading and saving the skill stats, and the small XP they give to the lessons progress.
import { dayKey, loadProgress, saveProgress } from '../lessons/progress'
import type { GameId, SkillEntry, SkillStats } from './data'
import { SKILLS_KEY, emptyStats, parseStats, record, skillXp } from './data'

const XP_PER_DAY = 60

export function loadStats(): SkillStats {
  try {
    return parseStats(localStorage.getItem(SKILLS_KEY))
  } catch {
    return emptyStats()
  }
}

export function saveStats(s: SkillStats): void {
  try {
    localStorage.setItem(SKILLS_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

const listeners = new Set<(e: SkillEntry) => void>()

/** Called for every recorded entry (ratings and measurements too). Returns the unsubscribe. */
export function onSkillRound(fn: (e: SkillEntry) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * A little XP into the lessons progress (at most 60 a day from skills). Returns the XP given.
 * Only touches xp, so lesson records, sessions and the plan are left alone.
 */
export function giveXp(s: SkillStats, amount: number, now = new Date()): { stats: SkillStats; xp: number } {
  const today = dayKey(now)
  const got = s.xp.day === today ? s.xp.got : 0
  const xp = Math.max(0, Math.min(Math.round(amount), XP_PER_DAY - got))
  if (!xp) return { stats: s, xp: 0 }
  try {
    if (localStorage.getItem('lessons-progress') === null) return { stats: s, xp: 0 } // no dino yet
  } catch {
    return { stats: s, xp: 0 }
  }
  const p = loadProgress()
  saveProgress({ ...p, xp: p.xp + xp })
  return { stats: { ...s, xp: { day: today, got: got + xp } }, xp }
}

/** Saves a round: history, best, and XP for a real gain only (skillXp). */
export function finishRound(game: GameId, score: number, detail?: string): { best: boolean; xp: number; stats: SkillStats } {
  const before = loadStats()
  const r = record(before, game, score, detail)
  const g = giveXp(r.stats, skillXp(before, game, score, detail))
  saveStats(g.stats)
  const e = g.stats.history[0]
  if (e) listeners.forEach((fn) => fn(e))
  return { best: r.best, xp: g.xp, stats: g.stats }
}

export function setLevels(patch: Partial<SkillStats['levels']>): SkillStats {
  const s = loadStats()
  const levels = { ...s.levels, ...patch }
  const same = levels.fretMax === s.levels.fretMax && levels.clockGap === s.levels.clockGap && levels.earLen === s.levels.earLen
  if (same) return s // unchanged: keep its time, so a merge doesn't prefer a copy that only re-saved
  const next = { ...s, levels, levelsAt: Date.now() }
  saveStats(next)
  return next
}
