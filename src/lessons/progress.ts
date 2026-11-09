// Player progress: XP, levels, unlocks, dino stage, the session log. Saved in localStorage.
import type {
  ApplyOutcome,
  ColdAttempt,
  Cosmetic,
  DinoStage,
  HistEntry,
  JamStats,
  ChordStats,
  Lesson,
  LessonRecord,
  LessonResult,
  PainLevel,
  Progress,
  ReviewState,
  RunSample,
  SessionDay,
  SessionMin,
  SessionPlan,
  SessionStep,
  Stars,
  StepKind,
  TabLevel,
  TempoTrial,
  StageDef,
  StageId,
  WeekShape,
  XpLine,
} from './types'
import { GROWTH, LEGACY_IDS, LESSONS, ORDER, PLAN_PATH, STAGES, checkpointOf, lessonById, stageOf } from './data'
import { legacyOpen, legacyStage } from './legacyMap'
import { ACHIEVEMENTS, checkAchievements } from './achievements'
import { MIN_GRADED, RECENT_MAX, pickLines, pushRecent } from './facts/pick'
import { bpmAt, cleanSpeed, nextSpeed, snapSpeed } from './speed'
import { normalizeHeat } from './heat'
import { HIST_MAX, SESSION_GAPS, applyCold, firstReview, histEntry, isReviewItem, sessionNow, weekStatus } from './review'

const KEY = 'lessons-progress'
const BAK = 'lessons-progress-bak'
const DAY_MS = 86400000
export const RUNS_MAX = 300
export const SESSION_LOG_MAX = 400
const WEEK_XP_MAX = 20

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

/** The practice day: local date of (d − 4 h), so a late-night session still counts for the day before. */
export function dayKey(d: Date): string {
  const s = new Date(d.getTime() - 4 * 3600000)
  const mm = String(s.getMonth() + 1).padStart(2, '0')
  const dd = String(s.getDate()).padStart(2, '0')
  return `${s.getFullYear()}-${mm}-${dd}`
}

/** Whole days from day key a to day key b. */
export function daysBetween(a: string, b: string) {
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
    dinoName: 'Pebble',
    achievements: {},
    cosmetics: [],
    stats: { bendsInTune: 0 },
    recentFacts: [],
    totalSec: 0,
    plan: null,
    created: Date.now(),
    sessionMin: 30,
    weekGoal: 3,
    sessions: { log: [], before: 0 },
    weekXp: [],
    runs: [],
    seenWeekly: true,
    mapV: 2,
    keepOpen: [],
    dinoBonus: 0,
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
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const TABS: TabLevel[] = ['full', 'faded', 'hidden']
const toTab = (v: unknown): TabLevel => TABS.find((t) => t === v) ?? 'full'
const PAINS: PainLevel[] = ['none', 'mild', 'sharp']
const SHAPES: WeekShape[] = ['A', 'B', 'C', 'D']
const toMin = (v: unknown): SessionMin | undefined => (v === 20 || v === 30 ? v : undefined)
const numOrNull = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null)

/** The review calendar before sessions: days after the last pass, by box (migration only). */
const OLD_REVIEW_DAYS = [1, 3, 7, 14, 30]

function normalizeCold(raw: unknown): ColdAttempt | undefined {
  const o = obj(raw)
  if (!o || typeof o.s !== 'number' || !isDay(o.d)) return undefined
  return { s: Math.round(o.s), d: o.d, bpm: num(o.bpm, 0), speed: num(o.speed, 1), clean: o.clean === true, score: num(o.score, 0), tab: toTab(o.tab) }
}

function normalizeHist(raw: unknown): HistEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: HistEntry[] = []
  for (const x of raw) {
    const o = obj(x)
    if (!o || typeof o.s !== 'number' || !isDay(o.d)) continue
    const e: HistEntry = { s: Math.round(o.s), d: o.d }
    if (typeof o.best === 'number' && isFinite(o.best)) e.best = o.best
    const c = normalizeCold(o.cold)
    if (c) e.cold = c
    out.push(e)
  }
  return out.sort((a, b) => a.s - b.s).slice(-HIST_MAX)
}

function normalizeReview(raw: unknown): ReviewState | undefined {
  const o = obj(raw)
  if (!o || typeof o.due !== 'number') return undefined
  const r: ReviewState = {
    step: int(o.step, 0, SESSION_GAPS.length - 1, 0),
    due: Math.max(1, Math.round(o.due)),
    coldPasses: int(o.coldPasses, 0, 99, 0),
    lastColdS: int(o.lastColdS, 0, 1e6, 0),
    learned: o.learned === true,
  }
  if (typeof o.learnedAt === 'number') r.learnedAt = o.learnedAt
  const cs = cleanSpeed(o.coldSpeed)
  if (cs !== undefined) r.coldSpeed = cs
  return r
}

/**
 * A review state for a lesson passed under the old day calendar: its box becomes a review step and a due session.
 * Never learned: "learned" needs clean cold starts in 2 separate sessions, and the old calendar had no cold starts.
 */
function migrateReview(rec: LessonRecord, box: number | undefined, lastPass: number | undefined, today: string): ReviewState {
  const b = Math.max(0, Math.min(OLD_REVIEW_DAYS.length - 1, Math.round(box ?? 0)))
  const step = Math.min(SESSION_GAPS.length - 1, b)
  const at = lastPass ?? rec.passedAt ?? 0
  const wasDue = daysBetween(dayKey(new Date(at)), today) >= OLD_REVIEW_DAYS[b]
  return { step, due: wasDue ? 1 : 1 + SESSION_GAPS[step], coldPasses: 0, lastColdS: 0, learned: false }
}

function normalizeRecord(raw: unknown, lesson: Lesson | undefined, today: string): LessonRecord | null {
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
  const passedSpeed = cleanSpeed(o.passedSpeed)
  if (passedSpeed !== undefined && rec.passedAt !== undefined) rec.passedSpeed = passedSpeed
  const last = obj(o.last)
  if (last) {
    rec.last = { score: num(last.score, 0), spreadMs: typeof last.spreadMs === 'number' ? last.spreadMs : null, bpm: num(last.bpm, 0), bestChain: num(last.bestChain, 0) }
  }
  if (typeof o.flat === 'number') rec.flat = num(o.flat, 0)
  const speed = cleanSpeed(o.speed)
  if (speed !== undefined) rec.speed = speed
  const top = cleanSpeed(o.topSpeed)
  if (top !== undefined) rec.topSpeed = top
  if (o.overdrive === true) rec.overdrive = true
  const tr = obj(o.trial)
  const trSpeed = cleanSpeed(tr?.speed)
  if (tr && trSpeed !== undefined) rec.trial = { speed: trSpeed, first: tr.first === true, clean: int(tr.clean, 0, 99, 0) } satisfies TempoTrial
  if (typeof o.loops === 'number') rec.loops = Math.max(0, Math.round(num(o.loops, 0)))
  const loopTop = cleanSpeed(o.loopTop)
  if (loopTop !== undefined) rec.loopTop = loopTop
  if (isDay(o.loopDay)) rec.loopDay = o.loopDay
  const hist = normalizeHist(o.hist)
  if (hist) rec.hist = hist
  // firstS 0: played before session numbers existed (an old save), so never "new this week".
  if (typeof o.firstS === 'number' && isFinite(o.firstS)) rec.firstS = Math.max(0, Math.round(o.firstS))
  else if (rec.plays > 0) rec.firstS = 0
  if (typeof o.shuffleBest === 'number' && isFinite(o.shuffleBest)) rec.shuffleBest = o.shuffleBest
  const review = normalizeReview(o.review)
  if (review) rec.review = review
  // The old day calendar (box, lastPass) becomes a session review; miss, box and lastPass are dropped.
  else if (lesson && isReviewItem(lesson) && rec.passedAt !== undefined) {
    rec.review = migrateReview(rec, typeof o.box === 'number' ? o.box : undefined, typeof o.lastPass === 'number' ? o.lastPass : undefined, today)
  }
  return rec
}

const STEP_KINDS: StepKind[] = ['warmup', 'listenback', 'cold', 'new', 'mix', 'changes', 'ear', 'jam']
const SKILL_GAMES = ['changes', 'find', 'name', 'ear', 'clock', 'record', 'mental']
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)

function normalizeStep(raw: unknown): SessionStep | null {
  const x = obj(raw)
  const kind = STEP_KINDS.find((k) => k === x?.kind)
  if (!x || !kind) return null
  const lessonId = typeof x.lessonId === 'string' && lessonById(x.lessonId) ? x.lessonId : null
  const sk = obj(x.skill)
  const skill = sk && typeof sk.game === 'string' && SKILL_GAMES.includes(sk.game) ? (sk as unknown as SessionStep['skill']) : undefined
  if (!lessonId && !skill && kind !== 'mix') return null
  const from = obj(x.from)
  const step: SessionStep = {
    kind,
    lessonId,
    min: num(x.min, 2),
    state: x.state === 'done' || x.state === 'skipped' ? x.state : 'todo',
    why: str(x.why, ''),
    from: { best: num(from?.best, 0), stars: toStars(from?.stars), speed: num(from?.speed, 1), loops: num(from?.loops, 0) },
  }
  if (skill) step.skill = skill
  const items = strList(x.items)?.filter((id) => lessonById(id))
  if (items) step.items = items
  const played = strList(x.played)
  if (played) step.played = played
  if (kind === 'mix' && !items?.length) return null
  if (x.consolidate === true) step.consolidate = true
  if (x.brake === true) step.brake = true
  if (typeof x.score === 'number') step.score = x.score
  if (typeof x.best === 'number' && isFinite(x.best)) step.best = x.best
  if (typeof x.speed === 'number') step.speed = x.speed
  if (typeof x.drill === 'string' && /^[nct]:/.test(x.drill)) step.drill = x.drill
  return step
}

/** Only v2 session plans are read; an old day plan becomes null, so a fresh plan is made today. */
function normalizePlan(raw: unknown): SessionPlan | null {
  const o = obj(raw)
  if (!o || o.v !== 2 || !isDay(o.day) || !Array.isArray(o.steps)) return null
  const steps = o.steps.map(normalizeStep).filter((s): s is SessionStep => s !== null)
  const plan: SessionPlan = { v: 2, day: o.day, min: toMin(o.min) ?? 30, shape: SHAPES.find((s) => s === o.shape) ?? 'A', steps }
  if (typeof o.away === 'number' && isFinite(o.away) && o.away >= 0) plan.away = Math.round(o.away)
  return plan
}

function normalizeDay(raw: unknown): SessionDay | null {
  const o = obj(raw)
  if (!o || !isDay(o.day)) return null
  const d: SessionDay = { day: o.day, sec: Math.max(0, num(o.sec, 0)), set: o.set === true, counted: o.counted === true, pocket: o.pocket === true }
  const min = toMin(o.min)
  if (min) d.min = min
  const shape = SHAPES.find((s) => s === o.shape)
  if (shape) d.shape = shape
  const pain = PAINS.find((s) => s === o.pain)
  if (pain) d.pain = pain
  if (typeof o.goal === 'number' && Number.isInteger(o.goal) && o.goal >= 2 && o.goal <= 5) d.goal = o.goal
  return d
}

/** Sorted by day, one entry per day, at most SESSION_LOG_MAX: trimmed counted days move into `before`. */
export function trimLog(log: SessionDay[], before: number): { log: SessionDay[]; before: number } {
  const byDay = new Map<string, SessionDay>()
  for (const d of log) byDay.set(d.day, d)
  const sorted = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  const cut = Math.max(0, sorted.length - SESSION_LOG_MAX)
  const gone = sorted.slice(0, cut).filter((d) => d.counted).length
  return { log: sorted.slice(cut), before: before + gone }
}

function normalizeJam(raw: unknown): JamStats | undefined {
  const o = obj(raw)
  if (!o) return undefined
  return { strong: numOrNull(o.strong), restBeats: numOrNull(o.restBeats), phrases: num(o.phrases, 0), silentBars: num(o.silentBars, 0) }
}

function normalizeChordStats(raw: unknown): ChordStats | undefined {
  const o = obj(raw)
  if (!o) return undefined
  return { ok: num(o.ok, 0), wrong: num(o.wrong, 0), unsure: num(o.unsure, 0), conf: numOrNull(o.conf) }
}

function normalizeRun(raw: unknown): RunSample | null {
  const o = obj(raw)
  if (!o || typeof o.at !== 'number' || typeof o.id !== 'string') return null
  const s: RunSample = {
    at: o.at,
    id: o.id,
    bpm: num(o.bpm, 0),
    swing: o.swing === true,
    mean: numOrNull(o.mean),
    spread: numOrNull(o.spread),
    n: num(o.n, 0),
    tab: toTab(o.tab),
    quiet: o.quiet === true,
    cold: o.cold === true,
    clean: o.clean === true,
    bend: numOrNull(o.bend),
  }
  const jam = normalizeJam(o.jam)
  if (jam) s.jam = jam
  const chords = normalizeChordStats(o.chords)
  if (chords) s.chords = chords
  return s
}

/** How far from the first pass a logged run may be to count as that pass (the run is logged as it ends). */
const PASS_MATCH_MS = 5 * 60000

/**
 * Saves from before passedSpeed: the speed of the logged run nearest the first pass, when the run log still has it.
 * Nothing is guessed otherwise; the lesson then just shows "Passed". Mutates p.
 */
function fillPassedSpeed(p: Progress): void {
  for (const id of Object.keys(p.lessons)) {
    const rec = p.lessons[id]
    const lesson = lessonById(id)
    const at = rec.passedAt
    if (at === undefined || rec.passedSpeed !== undefined || !lesson || lesson.type === 'sync') continue
    const near = p.runs
      .filter((r) => r.id === id && r.bpm > 0 && Math.abs(r.at - at) <= PASS_MATCH_MS)
      .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0]
    const s = near ? cleanSpeed(near.bpm / lesson.bpm) : undefined
    if (s !== undefined) rec.passedSpeed = s
  }
}

/** Checks a parsed value and fills missing fields; null when it isn't progress at all. */
function normalize(raw: unknown, now = new Date()): Progress | null {
  const o = obj(raw)
  if (!o || o.v !== 1 || typeof o.xp !== 'number' || !obj(o.lessons)) return null
  const today = dayKey(now)
  const p = newProgress()
  p.xp = Math.max(0, num(o.xp, 0))
  const lessons = obj(o.lessons) ?? {}
  for (const raw of Object.keys(lessons)) {
    // Renamed lessons move to their new id; the record played more wins when both exist.
    const id = LEGACY_IDS[raw] ?? raw
    const rec = normalizeRecord(lessons[raw], lessonById(id), today)
    if (!rec) continue
    const had = p.lessons[id]
    if (!had || rec.plays > had.plays) p.lessons[id] = rec
  }
  p.dinoName = str(o.dinoName, '').trim() || 'Pebble'
  const ach = obj(o.achievements)
  if (ach) for (const id of Object.keys(ach)) if (typeof ach[id] === 'number') p.achievements[id] = ach[id]
  if (Array.isArray(o.cosmetics)) p.cosmetics = COSMETICS.filter((c) => (o.cosmetics as unknown[]).includes(c))
  const stats = obj(o.stats)
  if (stats) p.stats = { bendsInTune: num(stats.bendsInTune, 0) }
  if (Array.isArray(o.recentFacts)) p.recentFacts = o.recentFacts.filter((id): id is string => typeof id === 'string').slice(-RECENT_MAX)
  p.totalSec = Math.max(0, num(o.totalSec, 0))
  p.created = num(o.created, p.created)
  p.plan = normalizePlan(o.plan)
  const heat = normalizeHeat(o.heat)
  if (heat) p.heat = heat
  p.sessionMin = toMin(o.sessionMin) ?? 30
  p.weekGoal = typeof o.weekGoal === 'number' && Number.isInteger(o.weekGoal) && o.weekGoal >= 2 && o.weekGoal <= 5 ? o.weekGoal : 3
  const ses = obj(o.sessions)
  if (ses) {
    const log = Array.isArray(ses.log) ? ses.log.map(normalizeDay).filter((d): d is SessionDay => d !== null) : []
    p.sessions = trimLog(log, int(ses.before, 0, 1e6, 0))
  }
  if (Array.isArray(o.weekXp)) p.weekXp = [...new Set(o.weekXp.filter(isDay))].sort().slice(-WEEK_XP_MAX)
  if (Array.isArray(o.runs)) p.runs = o.runs.map(normalizeRun).filter((r): r is RunSample => r !== null).sort((a, b) => a.at - b.at).slice(-RUNS_MAX)
  fillPassedSpeed(p)
  // The one-time "weeks, not days" note: shown to a save from the day-streak era, and until dismissed.
  if (o.seenWeekly !== true && ('streak' in o || 'dailyGoal' in o || 'sessions' in o)) delete p.seenWeekly
  if (Array.isArray(o.keepOpen)) p.keepOpen = [...new Set(o.keepOpen.filter((id): id is string => typeof id === 'string' && !!lessonById(id)))]
  p.dinoBonus = int(o.dinoBonus, 0, 8, 0)
  // A save from the old world map: keep what it had open, and the dino's stage.
  return o.mapV === 2 ? p : migrateMap(p)
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

/** `now` decides which migrated reviews are due (tests pin it). */
export function importProgress(json: string, now = new Date()): Progress | null {
  try {
    return normalize(JSON.parse(json), now)
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

/** Checkpoints and encores passed. */
export function growthCount(p: Progress): number {
  return GROWTH.filter((id) => isPassed(p, id)).length
}

/** The dino grows with each growth lesson; dinoBonus carries an old-map stage over so it never shrinks. */
export function dinoStageFor(p: Progress): number {
  return Math.min(8, growthCount(p) + (p.dinoBonus ?? 0))
}

export function eggCracked(p: Progress): boolean {
  if (dinoStageFor(p) !== 0) return false
  const s1 = STAGES[0]
  return [...s1.core, ...s1.extra].filter((id) => isPassed(p, id)).length >= 2
}

// ---- Unlocks -------------------------------------------------------------------

const isFree = (id: string) => lessonById(id)?.free === true
const isSyncId = (id: string) => lessonById(id)?.type === 'sync'
const stageById = (id: StageId) => STAGES.find((s) => s.id === id)

/** Stars in a stage's core lessons; free jams are left out. */
export function starsInStage(p: Progress, s: StageId): { got: number; max: number } {
  const ids = (stageById(s)?.core ?? []).filter((id) => !isFree(id))
  const got = ids.reduce((a, id) => a + (p.lessons[id]?.stars ?? 0), 0)
  return { got, max: 3 * ids.length }
}

/** Stage 1 is open; a weeks stage opens when the previous stage's checkpoint is passed; Extras open with stage 2. */
export function stageOpen(p: Progress, s: StageId): boolean {
  const def = stageById(s)
  if (!def) return false
  if (!def.weeks) return stageOpen(p, 2)
  const i = STAGES.indexOf(def)
  if (i === 0) return true
  const cp = checkpointOf(STAGES[i - 1])
  return cp !== null && isPassed(p, cp)
}

/** The first stage whose checkpoint is not passed yet (the last weeks stage when all are). */
export function currentStage(p: Progress): StageDef {
  const weeks = STAGES.filter((s) => s.weeks)
  return weeks.find((s) => !isPassed(p, checkpointOf(s) ?? '')) ?? weeks[weeks.length - 1]
}

/** Played, passed or kept from the old map: never locked again. */
function everOpen(p: Progress, id: string): boolean {
  const rec = p.lessons[id]
  return isPassed(p, id) || (rec?.plays ?? 0) > 0 || (p.keepOpen ?? []).includes(id)
}

export function isUnlocked(p: Progress, lessonId: string): boolean {
  if (!lessonById(lessonId)) return false
  if (everOpen(p, lessonId)) return true
  const at = stageOf(lessonId)
  if (!at) return false
  // Free jams and extras open with their stage and never block anything.
  if (!at.core || isFree(lessonId)) return stageOpen(p, at.stage.id)
  // The plan's path opens one lesson at a time; the sync lesson only needs a try.
  const i = PLAN_PATH.indexOf(lessonId)
  if (i === 0) return true
  const prev = PLAN_PATH[i - 1]
  return isPassed(p, prev) || (isSyncId(prev) && (p.lessons[prev]?.plays ?? 0) >= 1)
}

/** The plan's next lesson ("Continue"); with the path finished, the first open extra not passed yet. */
export function nextLesson(p: Progress): string | null {
  // A sync lesson that was tried or skipped never blocks "Continue"; it stays a tap away on the map.
  const settled = (id: string) => isPassed(p, id) || (isSyncId(id) && (p.lessons[id]?.plays ?? 0) > 0)
  const path = PLAN_PATH.find((id) => isUnlocked(p, id) && !settled(id))
  if (path) return path
  if (PLAN_PATH.some((id) => !settled(id))) return null
  return ORDER.find((id) => stageOf(id)?.core === false && isUnlocked(p, id) && !isPassed(p, id)) ?? null
}

// ---- Migration from the old world map ---------------------------------------------

/**
 * Old-map saves: everything the old map had open stays open, and the dino keeps its stage.
 * A stored plan with nothing done yet was picked by the old map: dropped, so the home screen makes one that matches Continue.
 */
export function migrateMap(p: Progress): Progress {
  const started = !!p.plan?.steps.some((s) => s.state === 'done')
  const next = { ...p, mapV: 2 as const, plan: started ? p.plan : null }
  next.keepOpen = [...new Set([...(p.keepOpen ?? []), ...legacyOpen(p)])].filter((id) => lessonById(id))
  next.dinoBonus = Math.max(p.dinoBonus ?? 0, Math.max(0, legacyStage(p) - growthCount(p)))
  return next
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
  if (rec.firstS === undefined) rec.firstS = sessionNow(p, now)
  return next
}

const plus = (n: number) => `+${n}`

/** Lessons passed so far, optionally only of some types. */
function passedCount(p: Progress, types?: Lesson['type'][]): number {
  return Object.keys(p.lessons).filter((id) => p.lessons[id].passedAt !== undefined && (!types || types.includes(lessonById(id)?.type ?? 'notes'))).length
}

/** Graded hits of a run (perfect, good, early, late). */
const gradedOf = (r: LessonResult) => r.counts.perfect + r.counts.good + r.counts.early + r.counts.late

/** Days since the last practice day before today (any lesson played); null when none. */
export function daysAway(p: Progress, today: string): number | null {
  let last = ''
  for (const rec of Object.values(p.lessons)) {
    if (!rec.lastPlayed) continue
    const d = dayKey(new Date(rec.lastPlayed))
    if (d !== today && d > last) last = d
  }
  for (const d of p.sessions?.log ?? []) if (d.day !== today && d.day > last && (d.counted || d.pocket)) last = d.day
  return last ? daysBetween(last, today) : null
}

/** A run sample for the progress screen. */
function sampleOf(lesson: Lesson, r: LessonResult, cold: boolean, clean: boolean): RunSample {
  const s: RunSample = {
    at: r.at,
    id: lesson.id,
    bpm: r.bpm,
    swing: !!r.swing,
    mean: r.meanErrMs,
    spread: r.spreadMs,
    n: gradedOf(r),
    tab: r.tab ?? 'full',
    quiet: !!r.quiet,
    cold,
    clean,
    bend: r.bendCents ?? null,
  }
  if (r.improv?.jam) s.jam = r.improv.jam
  if (r.chordStats) s.chords = r.chordStats
  return s
}

const pushRun = (p: Progress, s: RunSample) => {
  p.runs = [...(p.runs ?? []), s].slice(-RUNS_MAX)
}

/**
 * One finished run. `ctx.age` is the player's optional age (it decides which fun lines may show);
 * `ctx.cold` says this run is the item's cold-start test (decided before the run by isCold).
 * XP comes only from real gains: first pass, new stars, a first clean run, an earned tempo, cold starts, learned items.
 */
export function applyResult(p: Progress, lesson: Lesson, r: LessonResult, now: Date, ctx: { age: number | null; cold: boolean }): ApplyOutcome {
  const next = clone(p)
  const today = dayKey(now)
  const s = sessionNow(p, now)
  const old = p.lessons[lesson.id]
  const firstPlayToday = !Object.values(p.lessons).some((x) => x.playsDay === today && x.playsToday > 0)
  const rec = recordFor(next, lesson.id, today)
  const playsToday = rec.playsToday
  const title = lesson.title
  const base = {
    progress: next,
    levelBefore: levelFor(p.xp).level,
    stageBefore: dinoStageFor(p),
    unlocked: [] as string[],
    stageOpened: null,
  }

  // Shuffle mode: practice only. The straight record (stars, pass, review, tempo) stays as it was.
  if (r.shuffle) {
    rec.plays++
    rec.playsToday = playsToday + 1
    rec.lastPlayed = now.getTime()
    rec.shuffleBest = Math.max(rec.shuffleBest ?? 0, r.score)
    if (rec.firstS === undefined) rec.firstS = s
    if (lesson.type !== 'sync') pushRun(next, sampleOf(lesson, r, false, false))
    return {
      ...base,
      xp: 0,
      lines: [{ label: 'Total', value: plus(0) }],
      levelAfter: base.levelBefore,
      stageAfter: base.stageBefore,
      newAchievements: [],
      competence: [`Shuffle mode: ${r.score}%. Practice only; your straight record is unchanged.`],
      cold: null,
      review: rec.review ?? null,
      factLines: [],
      speed: null,
    }
  }

  const wasPassed = rec.passedAt !== undefined
  const wasClean = rec.clean
  // Record
  rec.best = Math.max(rec.best, r.score)
  rec.stars = Math.max(rec.stars, r.stars) as Stars
  rec.plays++
  if (rec.passedAt === undefined && !r.passed) rec.fails++
  if (r.passed && rec.passedAt === undefined) rec.passedAt = now.getTime()
  // A pass at any speed unlocks the next lesson; the map shows how fast (learned needs full tempo from cold).
  if (r.passed && lesson.type !== 'sync') rec.passedSpeed = Math.max(rec.passedSpeed ?? 0, snapSpeed(r.speed))
  rec.bestChain = Math.max(rec.bestChain, r.bestChain)
  rec.clean = rec.clean || r.clean
  rec.playsToday = playsToday + 1
  rec.lastPlayed = now.getTime()
  if (rec.firstS === undefined) rec.firstS = s

  // Speed trainer: the next Auto speed for this lesson.
  let speed: ApplyOutcome['speed'] = null
  let clean = false
  let earnedXp = 0
  const competence: string[] = []
  if (lesson.type !== 'sync') {
    const st = nextSpeed(lesson, old, r)
    clean = st.clean
    // The fastest earned tempo (earnedTop: a record from before session history counts as earned at 100%).
    const topBefore = st.topBefore
    const top = st.top
    rec.speed = st.speed
    if (top > 0) rec.topSpeed = top
    if (st.overdrive) rec.overdrive = true
    if (st.trial) rec.trial = st.trial
    else delete rec.trial
    speed = { played: r.speed, next: st.speed, topBefore, topAfter: top, earned: st.earned, trial: st.trial ?? null, clean: st.clean }
    if (st.earned && top > topBefore) {
      earnedXp = 10
      competence.push(`${title}: ${bpmAt(lesson, top)} BPM earned. Next: ${bpmAt(lesson, st.speed)} BPM.`)
    }
    // Session history: the in-session best is the fastest clean run.
    const h = histEntry(rec, s, today)
    if (clean) h.best = Math.max(h.best ?? 0, r.bpm)
  }

  // Review: a first pass starts it; a cold-start test moves it.
  let cold: ColdAttempt | null = null
  const coldXp: XpLine[] = []
  if (isReviewItem(lesson)) {
    if (r.passed && !wasPassed && !rec.review) rec.review = firstReview(s)
    else if (ctx.cold && rec.review) {
      const c = applyCold(rec, lesson, r, s, today, clean)
      cold = c.cold
      competence.push(...c.lines)
      coldXp.push(...c.xp)
    }
  }
  if (r.passed && !wasPassed) competence.push(`First pass: ${title}.`)

  // XP lines (heuristic amounts, all competence-based).
  const lines: XpLine[] = []
  const add = (label: string, v: number) => {
    if (v > 0) lines.push({ label, value: plus(v) })
  }
  if (r.passed && !wasPassed) add('First pass', Math.round(0.5 * lesson.xp))
  add('New stars', Math.round(0.25 * lesson.xp) * Math.max(0, r.stars - (old?.stars ?? 0)))
  if (r.clean && !wasClean) add('First clean run', 30)
  add('Tempo earned', earnedXp)
  lines.push(...coldXp)
  const total = lines.reduce((a, l) => a + Number(l.value.slice(1)), 0)
  lines.push({ label: 'Total', value: plus(total) })

  next.xp += total
  next.stats.bendsInTune += r.bendsInTune
  next.totalSec = (p.totalSec ?? 0) + Math.max(0, r.playedSec)
  if (lesson.type !== 'sync') pushRun(next, sampleOf(lesson, r, ctx.cold, clean))

  // Fun lines, chosen once here so they are saved with progress and never change on re-render.
  const beat: Lesson['type'][] = ['rhythm', 'sync']
  const weeks = weekStatus(next, now).streak
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
    // Today's session number; milestone lines show on the first run of the day.
    sessions: { before: s - 1, after: s, counted: firstPlayToday },
    away: firstPlayToday ? daysAway(p, today) : null,
    weeks,
    totalSecBefore: p.totalSec ?? 0,
    totalSecAfter: next.totalSec,
    recent: p.recentFacts ?? [],
    age: ctx.age,
    calibrated: r.calibrated === true,
    hour: now.getHours(),
  })
  next.recentFacts = pushRecent(p.recentFacts ?? [], factLines)
  // Keep the spread only when the run had enough graded hits to compare against later.
  rec.last = { score: r.score, spreadMs: gradedOf(r) >= MIN_GRADED ? r.spreadMs : null, bpm: r.bpm, bestChain: r.bestChain }
  rec.flat = old && r.score <= old.best ? (old.flat ?? 0) + 1 : 0

  // Achievements: a newly earned cosmetic is put on right away.
  const newAchievements = checkAchievements(p, next, lesson, r, now, weeks)
  for (const id of newAchievements) {
    next.achievements[id] = now.getTime()
    const c = ACHIEVEMENTS.find((a) => a.id === id)?.cosmetic
    if (c && !next.cosmetics.includes(c)) next.cosmetics.push(c)
  }

  const unlocked = LESSONS.filter((l) => !isUnlocked(p, l.id) && isUnlocked(next, l.id)).map((l) => l.id)
  const opened = STAGES.find((st) => !stageOpen(p, st.id) && stageOpen(next, st.id))

  return {
    ...base,
    xp: total,
    lines,
    levelAfter: levelFor(next.xp).level,
    stageAfter: dinoStageFor(next),
    newAchievements,
    unlocked,
    stageOpened: opened ? opened.id : null,
    competence,
    cold,
    review: rec.review ?? null,
    factLines,
    speed,
  }
}
