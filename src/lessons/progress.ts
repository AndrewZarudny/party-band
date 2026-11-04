// Player progress: XP, levels, unlocks, streak, dino stage. Saved in localStorage.
import type { ApplyOutcome, Cosmetic, DinoStage, Lesson, LessonRecord, LessonResult, Progress, Stars, WorldId, XpLine } from './types'
import { LESSONS, WORLDS, lessonById } from './data'
import { ACHIEVEMENTS, checkAchievements } from './achievements'
import { MIN_GRADED, RECENT_MAX, pickLines, pushRecent } from './facts/pick'

const KEY = 'lessons-progress'
const BAK = 'lessons-progress-bak'
const DAY_MS = 86400000

export const DINO_STAGES: DinoStage[] = [
  { stage: 0, name: 'Egg', after: null },
  { stage: 1, name: 'Hatchling', after: 1 },
  { stage: 2, name: 'Nibbler', after: 2 },
  { stage: 3, name: 'Stomper', after: 3 },
  { stage: 4, name: 'Spikeback', after: 4 },
  { stage: 5, name: 'Scale-Runner', after: 5 },
  { stage: 6, name: 'Crestsinger', after: 6 },
  { stage: 7, name: 'Echo-Roarer', after: 7 },
  { stage: 8, name: 'Jam Titan', after: 8 },
]

const COSMETICS: Cosmetic[] = ['shades', 'bandana', 'pick-crown', 'star-guitar']
const GOALS: Progress['dailyGoal'][] = [100, 200, 350]

/** The practice day: local date of (d − 4 h), so a late-night session still counts for the day before. */
export function dayKey(d: Date): string {
  const s = new Date(d.getTime() - 4 * 3600000)
  const mm = String(s.getMonth() + 1).padStart(2, '0')
  const dd = String(s.getDate()).padStart(2, '0')
  return `${s.getFullYear()}-${mm}-${dd}`
}

/** Whole days from day key a to day key b. */
function daysBetween(a: string, b: string) {
  const ta = Date.parse(a + 'T00:00:00Z')
  const tb = Date.parse(b + 'T00:00:00Z')
  if (isNaN(ta) || isNaN(tb)) return Infinity
  return Math.round((tb - ta) / DAY_MS)
}

export function newProgress(): Progress {
  return {
    v: 1,
    xp: 0,
    lessons: {},
    streak: { days: 0, last: '', eggs: 0 },
    daily: { day: '', xp: 0, passes: 0 },
    dailyGoal: 100,
    dinoName: 'Pebble',
    achievements: {},
    cosmetics: [],
    stats: { bendsInTune: 0 },
    recentFacts: [],
    totalSec: 0,
    created: Date.now(),
  }
}

function emptyRecord(): LessonRecord {
  return { best: 0, stars: 0, plays: 0, fails: 0, bestChain: 0, clean: false, playsDay: '', playsToday: 0, lastPlayed: 0 }
}

const clone = (p: Progress): Progress => JSON.parse(JSON.stringify(p)) as Progress

// ---- Storage --------------------------------------------------------------------

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d)
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const toStars = (v: unknown): Stars => Math.max(0, Math.min(3, Math.round(num(v, 0)))) as Stars

function normalizeRecord(raw: unknown): LessonRecord | null {
  const o = obj(raw)
  if (!o) return null
  const rec: LessonRecord = {
    best: num(o.best, 0),
    stars: toStars(o.stars),
    plays: num(o.plays, 0),
    fails: num(o.fails, 0),
    bestChain: num(o.bestChain, 0),
    clean: o.clean === true,
    playsDay: str(o.playsDay, ''),
    playsToday: num(o.playsToday, 0),
    lastPlayed: num(o.lastPlayed, 0),
  }
  if (typeof o.passedAt === 'number') rec.passedAt = o.passedAt
  const last = obj(o.last)
  if (last) {
    rec.last = { score: num(last.score, 0), spreadMs: typeof last.spreadMs === 'number' ? last.spreadMs : null, bpm: num(last.bpm, 0), bestChain: num(last.bestChain, 0) }
  }
  if (typeof o.flat === 'number') rec.flat = num(o.flat, 0)
  return rec
}

/** Checks a parsed value and fills missing fields; null when it isn't progress at all. */
function normalize(raw: unknown): Progress | null {
  const o = obj(raw)
  if (!o || o.v !== 1 || typeof o.xp !== 'number' || !obj(o.lessons)) return null
  const p = newProgress()
  p.xp = Math.max(0, num(o.xp, 0))
  const lessons = obj(o.lessons) ?? {}
  for (const id of Object.keys(lessons)) {
    const rec = normalizeRecord(lessons[id])
    if (rec) p.lessons[id] = rec
  }
  const streak = obj(o.streak)
  if (streak) p.streak = { days: num(streak.days, 0), last: str(streak.last, ''), eggs: num(streak.eggs, 0) }
  const daily = obj(o.daily)
  if (daily) p.daily = { day: str(daily.day, ''), xp: num(daily.xp, 0), passes: num(daily.passes, 0) }
  p.dailyGoal = GOALS.find((g) => g === o.dailyGoal) ?? 100
  p.dinoName = str(o.dinoName, '').trim() || 'Pebble'
  const ach = obj(o.achievements)
  if (ach) for (const id of Object.keys(ach)) if (typeof ach[id] === 'number') p.achievements[id] = ach[id]
  if (Array.isArray(o.cosmetics)) p.cosmetics = COSMETICS.filter((c) => (o.cosmetics as unknown[]).includes(c))
  const stats = obj(o.stats)
  if (stats) p.stats = { bendsInTune: num(stats.bendsInTune, 0) }
  if (Array.isArray(o.recentFacts)) p.recentFacts = o.recentFacts.filter((id): id is string => typeof id === 'string').slice(-RECENT_MAX)
  p.totalSec = Math.max(0, num(o.totalSec, 0))
  p.created = num(o.created, p.created)
  return p
}

function readGood(): Progress | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normalize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** True when something is stored under the progress key (the welcome screen shows otherwise). */
export function hasSavedProgress(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

export function loadProgress(): Progress {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return newProgress()
  }
  if (raw === null) return newProgress()
  let p: Progress | null = null
  try {
    p = normalize(JSON.parse(raw))
  } catch {
    p = null
  }
  if (p) return p
  // Corrupt: keep the raw text so nothing is lost, start fresh.
  try {
    localStorage.setItem(BAK, raw)
  } catch {
    /* storage unavailable */
  }
  return newProgress()
}

export function saveProgress(p: Progress): void {
  try {
    const prev = readGood()
    if (prev) localStorage.setItem(BAK, JSON.stringify(prev))
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable */
  }
}

/** Fresh progress, saved; the old copy goes to the backup key first. Keeps the dino's name. */
export function resetProgress(p: Progress): Progress {
  const fresh = newProgress()
  fresh.dinoName = p.dinoName
  saveProgress(fresh)
  return fresh
}

export function exportProgress(p: Progress): string {
  return JSON.stringify(p, null, 2)
}

export function importProgress(json: string): Progress | null {
  try {
    return normalize(JSON.parse(json))
  } catch {
    return null
  }
}

// ---- Levels and stages ------------------------------------------------------------

export function xpToNext(level: number): number {
  const n = level - 1
  return 100 + 40 * n + 6 * n * n
}

export function levelFor(xp: number): { level: number; into: number; need: number } {
  let level = 1
  let into = Math.max(0, xp)
  while (into >= xpToNext(level)) {
    into -= xpToNext(level)
    level++
  }
  return { level, into, need: xpToNext(level) }
}

export function isPassed(p: Progress, lessonId: string): boolean {
  return p.lessons[lessonId]?.passedAt !== undefined
}

function worldDef(w: WorldId) {
  return WORLDS.find((x) => x.id === w)
}

function bossOf(w: WorldId): string | undefined {
  const def = worldDef(w)
  if (!def) return undefined
  return def.lessons.find((id) => lessonById(id)?.boss) ?? def.lessons[def.lessons.length - 1]
}

export function dinoStageFor(p: Progress): number {
  let n = 0
  for (const w of WORLDS) {
    const boss = bossOf(w.id)
    if (boss && isPassed(p, boss)) n++
  }
  return Math.min(8, n)
}

export function eggCracked(p: Progress): boolean {
  if (dinoStageFor(p) !== 0) return false
  const w1 = worldDef(1)
  return (w1?.lessons.filter((id) => isPassed(p, id)).length ?? 0) >= 2
}

// ---- Unlocks -------------------------------------------------------------------

export function starsInWorld(p: Progress, w: WorldId): { got: number; max: number } {
  const ids = worldDef(w)?.lessons ?? []
  const got = ids.reduce((a, id) => a + (p.lessons[id]?.stars ?? 0), 0)
  return { got, max: 3 * ids.length }
}

export function worldUnlocked(p: Progress, w: WorldId): boolean {
  if (w === 1) return true
  const prev = (w - 1) as WorldId
  const boss = bossOf(prev)
  if (boss && isPassed(p, boss)) return true
  const s = starsInWorld(p, prev)
  return s.max > 0 && s.got >= Math.ceil(0.7 * s.max)
}

export function isUnlocked(p: Progress, lessonId: string): boolean {
  const lesson = lessonById(lessonId)
  if (!lesson || !worldUnlocked(p, lesson.world)) return false
  const ids = worldDef(lesson.world)?.lessons ?? []
  const i = ids.indexOf(lessonId)
  if (i <= 0 || lesson.boss || isPassed(p, lessonId)) return true
  const prevId = ids[i - 1]
  if (isPassed(p, prevId)) return true
  // The sync lesson never blocks: trying or skipping it is enough.
  return lessonById(prevId)?.type === 'sync' && (p.lessons[prevId]?.plays ?? 0) >= 1
}

export function nextLesson(p: Progress): string | null {
  for (const w of WORLDS) {
    for (const id of w.lessons) if (isUnlocked(p, id) && !isPassed(p, id)) return id
  }
  return null
}

// ---- Streak --------------------------------------------------------------------

export function streakStatus(p: Progress, now: Date): { days: number; alive: boolean; away: number } {
  const { days, last, eggs } = p.streak
  if (!last || days <= 0) return { days: 0, alive: false, away: 0 }
  const away = Math.max(0, daysBetween(last, dayKey(now)))
  const alive = away <= 1 + eggs
  return { days: alive ? days : 0, alive, away }
}

/** Counts today for the streak. Returns the note to show, if any. */
function updateStreak(p: Progress, today: string): string | null {
  const s = p.streak
  if (s.last === today) return null
  let note: string | null = null
  const gap = s.last ? daysBetween(s.last, today) : Infinity
  if (gap === 1) {
    s.days++
  } else if (gap > 1 && gap <= 1 + s.eggs) {
    s.eggs -= gap - 1
    s.days++
    note = 'Your nest egg kept the streak warm.'
  } else {
    if (s.days > 1) note = `${p.dinoName} missed you. New streak starts today.`
    s.days = 1
  }
  if (s.days % 7 === 0) s.eggs = Math.min(2, s.eggs + 1)
  s.last = today
  return note
}

// ---- Runs ----------------------------------------------------------------------

function recordFor(p: Progress, lessonId: string, today: string): LessonRecord {
  const rec = p.lessons[lessonId] ?? emptyRecord()
  if (rec.playsDay !== today) {
    rec.playsDay = today
    rec.playsToday = 0
  }
  p.lessons[lessonId] = rec
  return rec
}

export function recordSkip(p: Progress, lessonId: string, now: Date): Progress {
  const next = clone(p)
  const rec = recordFor(next, lessonId, dayKey(now))
  rec.plays++
  if (rec.passedAt === undefined) rec.fails++
  rec.playsToday++
  rec.lastPlayed = now.getTime()
  return next
}

const plus = (n: number) => `+${n}`
const times = (m: number) => `x${m.toFixed(2)}`

/** Lessons passed so far, optionally only of some types. */
function passedCount(p: Progress, types?: Lesson['type'][]): number {
  return Object.keys(p.lessons).filter((id) => p.lessons[id].passedAt !== undefined && (!types || types.includes(lessonById(id)?.type ?? 'notes'))).length
}

/** `ctx.age` is the player's optional age (it decides which fun lines may show). */
export function applyResult(p: Progress, lesson: Lesson, r: LessonResult, now: Date, ctx: { age: number | null }): ApplyOutcome {
  const next = clone(p)
  const today = dayKey(now)
  if (next.daily.day !== today) next.daily = { day: today, xp: 0, passes: 0 }
  const rec = recordFor(next, lesson.id, today)
  const playsToday = rec.playsToday

  // Passed runs and honest practice (20 s or more) count for the streak.
  let streakNote: string | null = null
  if (r.passed || r.playedSec >= 20) streakNote = updateStreak(next, today)

  const acc = Math.max(0, Math.min(1, r.score / 100))
  const base = lesson.xp
  const skill = Math.round(base * (0.4 + 0.6 * acc))
  const lines: XpLine[] = []
  let total: number

  if (r.passed) {
    const replayMult = [1, 0.6, 0.35, 0.2][Math.min(playsToday, 3)]
    const firstClear = rec.passedAt !== undefined ? 0 : Math.round(0.5 * base)
    const starXP = Math.round(0.25 * base) * Math.max(0, r.stars - rec.stars)
    const cleanBonus = r.clean && !rec.clean ? 30 : 0
    const chainBonus = Math.min(50, 5 * Math.floor(r.bestChain / 10))
    const dailyBonus = next.daily.passes === 0 ? 40 : 0
    const streakMult = 1 + 0.05 * Math.min(next.streak.days, 7)
    const easyMult = r.easyTiming ? 0.8 : 1
    const speedMult = r.speed < 1 ? 0.75 : 1
    total = Math.round(((skill + chainBonus) * replayMult + firstClear + starXP + cleanBonus + dailyBonus) * streakMult * easyMult * speedMult)

    const add = (label: string, v: number) => {
      if (v !== 0) lines.push({ label, value: plus(v) })
    }
    add('Play', Math.round(skill * replayMult))
    add('New stars', starXP)
    add('First clear', firstClear)
    add('Clean run', cleanBonus)
    add('Chain bonus', Math.round(chainBonus * replayMult))
    add('First win today', dailyBonus)
    if (streakMult !== 1) lines.push({ label: 'Streak', value: times(streakMult) })
    if (easyMult !== 1) lines.push({ label: 'Easy timing', value: times(easyMult) })
    if (speedMult !== 1) lines.push({ label: 'Slower practice', value: times(speedMult) })
    next.daily.passes++
  } else {
    total = Math.max(10, Math.round(skill * 0.25))
    lines.push({ label: 'Practice', value: plus(total) })
  }
  lines.push({ label: 'Total', value: plus(total) })

  // Record
  rec.best = Math.max(rec.best, r.score)
  rec.stars = Math.max(rec.stars, r.stars) as Stars
  rec.plays++
  if (rec.passedAt === undefined && !r.passed) rec.fails++
  if (r.passed && rec.passedAt === undefined) rec.passedAt = now.getTime()
  rec.bestChain = Math.max(rec.bestChain, r.bestChain)
  rec.clean = rec.clean || r.clean
  rec.playsToday = playsToday + 1
  rec.lastPlayed = now.getTime()
  next.xp += total
  next.daily.xp += total
  next.stats.bendsInTune += r.bendsInTune
  next.totalSec = (p.totalSec ?? 0) + Math.max(0, r.playedSec)

  // Fun lines, chosen once here so they are saved with progress and never change on re-render.
  const old = p.lessons[lesson.id]
  const beat: Lesson['type'][] = ['rhythm', 'sync']
  const factLines = pickLines({
    result: r,
    lessonType: lesson.type,
    boss: !!lesson.boss,
    step: lesson.type === 'notes' ? (lesson.step ?? null) : null,
    prev: old?.last ?? null,
    bestBefore: old && old.plays > 0 ? old.best : null,
    bestChainBefore: old?.bestChain ?? 0,
    flat: old?.flat ?? 0,
    failedBefore: !!old && old.passedAt === undefined && old.fails > 0,
    firstBeatPass: r.passed && beat.includes(lesson.type) && passedCount(p, beat) === 0,
    passedBefore: passedCount(p),
    passedAfter: passedCount(next),
    streak: { before: p.streak.days, after: next.streak.days, counted: next.streak.last !== p.streak.last },
    totalSecBefore: p.totalSec ?? 0,
    totalSecAfter: next.totalSec,
    recent: p.recentFacts ?? [],
    age: ctx.age,
    calibrated: r.calibrated === true,
    hour: now.getHours(),
  })
  next.recentFacts = pushRecent(p.recentFacts ?? [], factLines)
  // Keep the spread only when the run had enough graded hits to compare against later.
  const graded = r.counts.perfect + r.counts.good + r.counts.early + r.counts.late
  rec.last = { score: r.score, spreadMs: graded >= MIN_GRADED ? r.spreadMs : null, bpm: r.bpm, bestChain: r.bestChain }
  rec.flat = old && r.score <= old.best ? (old.flat ?? 0) + 1 : 0

  // Achievements: a newly earned cosmetic is put on right away.
  const newAchievements = checkAchievements(p, next, lesson, r, now)
  for (const id of newAchievements) {
    next.achievements[id] = now.getTime()
    const c = ACHIEVEMENTS.find((a) => a.id === id)?.cosmetic
    if (c && !next.cosmetics.includes(c)) next.cosmetics.push(c)
  }

  const unlocked = LESSONS.filter((l) => !isUnlocked(p, l.id) && isUnlocked(next, l.id)).map((l) => l.id)
  const newWorld = WORLDS.find((w) => !worldUnlocked(p, w.id) && worldUnlocked(next, w.id))

  return {
    progress: next,
    xp: total,
    lines,
    levelBefore: levelFor(p.xp).level,
    levelAfter: levelFor(next.xp).level,
    stageBefore: dinoStageFor(p),
    stageAfter: dinoStageFor(next),
    newAchievements,
    unlocked,
    worldUnlocked: newWorld ? newWorld.id : null,
    streakNote,
    factLines,
  }
}
