// Reading and saving the skill stats, and the small XP they give to the lessons progress.
import { dayKey, loadProgress, saveProgress } from '../lessons/progress'
import type { GameId, SkillStats } from './data'
import { SKILLS_KEY, emptyStats, parseStats, record } from './data'

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

/**
 * A little XP into the lessons progress (at most 60 a day from skills). Returns the XP given.
 * Only touches xp and today's XP, so lesson records, streaks and the plan are left alone.
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
  const daily = p.daily.day === today ? { ...p.daily, xp: p.daily.xp + xp } : { day: today, xp, passes: 0 }
  saveProgress({ ...p, xp: p.xp + xp, daily })
  return { stats: { ...s, xp: { day: today, got: got + xp } }, xp }
}

/** Saves a round: history, best, optional XP. */
export function finishRound(game: GameId, score: number, xp: number, detail?: string): { best: boolean; xp: number; stats: SkillStats } {
  const r = record(loadStats(), game, score, detail)
  const g = giveXp(r.stats, xp)
  saveStats(g.stats)
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

