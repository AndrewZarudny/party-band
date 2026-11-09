// The progress screen's numbers (research section 7): plain data for each chart, plus its threshold. Pure.
import type { ColdAttempt, LessonRecord, PainLevel, Progress } from './types'
import type { SkillStats } from '../skills/data'
import { median } from '../skills/data'
import { CORE_PAIRS, RETIRE_AT } from '../skills/chords'
import { ORDER, lessonById } from './data'
import { dayKey, daysBetween } from './progress'
import { LEARN_SESSIONS, isReviewItem, reviewBrake, retentionGap, standingOf, strugglingList, weekKey, weekStatus } from './review'

export const DRIFT_TARGET = 25 // heuristic: under a quarter of a beat (in % of a beat) after 4 silent bars
export const DRIFT_GAP = 4 // silent bars the drift target is for
export const FRET_TARGET_SEC = 3 // heuristic: under 3 s per note on the low E and A strings
export const FRET_TARGET_STRINGS = [0, 1] // low E, A
export const TIMING_MIN_HITS = 8 // a run needs this many graded hits to show on the timing chart
export const STRING_LABELS = ['Low E', 'A', 'D', 'G', 'B', 'High E']

/** A lesson's place in map order. */
const orderOf = (id: string) => {
  const i = ORDER.indexOf(id)
  return i < 0 ? ORDER.length : i
}
const titleOf = (id: string) => lessonById(id)?.title ?? id

// ---- Cold-start tempo ---------------------------------------------------------------

export interface ColdPoint {
  s: number // session number
  bpm: number
  clean: boolean
}
export interface ColdItem {
  id: string
  title: string
  target: number // the lesson's own tempo
  points: ColdPoint[] // oldest first
  learned: boolean
  due: number // session number of the next cold test
}

/** Every review item: its cold attempts over sessions. Map order. */
export function coldSeries(p: Progress): ColdItem[] {
  const out: ColdItem[] = []
  for (const [id, rec] of Object.entries(p.lessons)) {
    const lesson = lessonById(id)
    if (!lesson || !rec.review) continue
    const points = (rec.hist ?? [])
      .filter((h) => h.cold)
      .map((h) => ({ s: h.cold!.s, bpm: h.cold!.bpm, clean: h.cold!.clean }))
      .sort((a, b) => a.s - b.s)
    out.push({ id, title: lesson.title, target: lesson.bpm, points, learned: rec.review.learned, due: rec.review.due })
  }
  return out.sort((a, b) => orderOf(a.id) - orderOf(b.id))
}

/** Share of cold-start tests that were clean (research change 1: "share passing at first attempt"). */
export function coldPassRate(p: Progress): { clean: number; total: number } {
  let clean = 0
  let total = 0
  for (const rec of Object.values(p.lessons))
    for (const h of rec.hist ?? [])
      if (h.cold) {
        total++
        if (h.cold.clean) clean++
      }
  return { clean, total }
}

// ---- Retention gap --------------------------------------------------------------------

export type GapTrend = 'shrinking' | 'growing' | 'steady' | null
export interface GapRow {
  id: string
  title: string
  best: number // in-session best before the cold test
  cold: number // the clean cold tempo
  gap: number
  prevGap: number | null
  trend: GapTrend // null with only one gap so far
}

/** Items with a measured gap (a clean cold test after a session with a clean best). Map order. */
export function gapList(p: Progress): GapRow[] {
  const out: GapRow[] = []
  for (const [id, rec] of Object.entries(p.lessons)) {
    const g = retentionGap(rec)
    if (g.gap === null || g.best === null || g.cold === null) continue
    const trend: GapTrend = g.prevGap === null ? null : g.gap < g.prevGap ? 'shrinking' : g.gap > g.prevGap ? 'growing' : 'steady'
    out.push({ id, title: titleOf(id), best: g.best, cold: g.cold, gap: g.gap, prevGap: g.prevGap, trend })
  }
  return out.sort((a, b) => orderOf(a.id) - orderOf(b.id))
}

// ---- Timing vs the band ------------------------------------------------------------

export interface TimingPoint {
  at: number
  mean: number // ms, + = late
  spread: number // ms
}

/** Runs with enough graded hits, oldest first; swung and straight runs are separate series. */
export function timingTrend(p: Progress, swing: boolean): TimingPoint[] {
  return p.runs
    .filter((r) => r.n >= TIMING_MIN_HITS && r.swing === swing && r.mean !== null && r.spread !== null)
    .map((r) => ({ at: r.at, mean: r.mean!, spread: r.spread! }))
    .sort((a, b) => a.at - b.at)
}

// ---- Skill games ------------------------------------------------------------------

export interface DriftRow {
  gap: number // silent bars
  points: { at: number; pct: number }[] // % of a beat, oldest first
  last: number | null
  met: boolean | null // only for DRIFT_GAP: the last drift is under the target
}

/** Inner-clock drift after the last silent bar, by the number of silent bars. Gaps never played are left out. */
export function driftSeries(stats: SkillStats): DriftRow[] {
  const by = new Map<number, { at: number; pct: number }[]>()
  for (const e of stats.history) {
    if (e.game !== 'drift') continue
    const gap = Number(e.detail)
    if (!Number.isFinite(gap)) continue
    const list = by.get(gap) ?? []
    list.push({ at: e.at, pct: e.score })
    by.set(gap, list)
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([gap, pts]) => {
      const points = pts.sort((a, b) => a.at - b.at)
      const last = points.length ? points[points.length - 1].pct : null
      return { gap, points, last, met: gap === DRIFT_GAP && last !== null ? last < DRIFT_TARGET : null }
    })
}

export interface PairRow {
  pair: string
  best: number
  last: number[] // the last 8 scores, oldest first
  retired: boolean
  core: boolean
}

/** One-minute changes per chord pair: core pairs first, then the rest by name. */
export function changesByPair(stats: SkillStats): PairRow[] {
  const by = new Map<string, { at: number; score: number }[]>()
  for (const e of stats.history) {
    if (e.game !== 'changes' || !e.detail) continue
    const list = by.get(e.detail) ?? []
    list.push({ at: e.at, score: e.score })
    by.set(e.detail, list)
  }
  for (const k of Object.keys(stats.best)) {
    const [game, pair] = k.split(':')
    if (game === 'changes' && pair && !by.has(pair)) by.set(pair, [])
  }
  const rows = [...by.entries()].map(([pair, list]) => {
    const scores = list.sort((a, b) => a.at - b.at).map((x) => x.score)
    const best = stats.best[`changes:${pair}`] ?? (scores.length ? Math.max(...scores) : 0)
    return { pair, best, last: scores.slice(-8), retired: best >= RETIRE_AT, core: CORE_PAIRS.includes(pair) }
  })
  const rank = (r: PairRow) => (r.core ? CORE_PAIRS.indexOf(r.pair) : CORE_PAIRS.length)
  return rows.sort((a, b) => rank(a) - rank(b) || (a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : 0))
}

export interface FretRow {
  string: number // 0 = low E
  label: string
  sec: number | null // median of the last 5 rounds, seconds
  rounds: number
  target: boolean // the 3 s target applies (low E and A)
  met: boolean | null
}

/** Fretboard response time per string. */
export function fretTimes(stats: SkillStats): FretRow[] {
  return STRING_LABELS.map((label, string) => {
    const list = stats.history
      .filter((e) => e.game === 'fretTime' && e.detail === String(string))
      .sort((a, b) => a.at - b.at)
      .slice(-5)
      .map((e) => e.score)
    const m = median(list)
    const sec = m === null ? null : Math.round(m / 100) / 10
    const target = FRET_TARGET_STRINGS.includes(string)
    return { string, label, sec, rounds: list.length, target, met: target && sec !== null ? sec < FRET_TARGET_SEC : null }
  })
}

/** Ear rounds: % of phrases echoed right at the first attempt, oldest first. */
export function earFirstSeries(stats: SkillStats): { at: number; score: number }[] {
  return stats.history
    .filter((e) => e.game === 'earFirst')
    .map((e) => ({ at: e.at, score: e.score }))
    .sort((a, b) => a.at - b.at)
}

// ---- Jams and bends ------------------------------------------------------------------

export interface JamQuality {
  strong: { at: number; share: number }[] // strong-beat notes on chord tones, 0–1
  rest: { at: number; beats: number }[] // mean rest between phrases
  ratings: { at: number; score: number }[] // listen-back ratings 1–5
}

export function jamQuality(p: Progress, stats: SkillStats): JamQuality {
  const jams = p.runs.filter((r) => r.jam).sort((a, b) => a.at - b.at)
  return {
    strong: jams.filter((r) => r.jam!.strong !== null).map((r) => ({ at: r.at, share: r.jam!.strong! })),
    rest: jams.filter((r) => r.jam!.restBeats !== null).map((r) => ({ at: r.at, beats: r.jam!.restBeats! })),
    ratings: stats.history
      .filter((e) => e.game === 'rate')
      .map((e) => ({ at: e.at, score: e.score }))
      .sort((a, b) => a.at - b.at),
  }
}

/** Runs with graded bends: mean cents off the target, oldest first (closer to 0 is better). */
export function bendSeries(p: Progress): { at: number; cents: number; id: string }[] {
  return p.runs
    .filter((r) => r.bend !== null)
    .map((r) => ({ at: r.at, cents: r.bend!, id: r.id }))
    .sort((a, b) => a.at - b.at)
}

// ---- Health and adherence --------------------------------------------------------------

const DAY_MS = 86400000
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10)
/** A YYYY-MM-DD key moved by n days. */
export const addDays = (day: string, n: number) => isoOf(Date.parse(day + 'T12:00:00Z') + n * DAY_MS)

export interface WeekRow {
  week: string // Monday's key
  count: number // counted sessions
  pocket: number // pocket-only days
  met: boolean
}

/** The last 12 weeks, oldest first, this week last. */
export function weeksVsGoal(p: Progress, now: Date): { weeks: WeekRow[]; goal: number; streak: number; done: number } {
  const ws = weekStatus(p, now, 12)
  const n = ws.counts.length
  const pocket = new Map<string, number>()
  for (const d of p.sessions.log) {
    if (!d.pocket || d.counted) continue
    const k = weekKey(d.day)
    pocket.set(k, (pocket.get(k) ?? 0) + 1)
  }
  const weeks = ws.counts.map((count, i) => {
    const week = addDays(ws.week, -7 * (n - 1 - i))
    return { week, count, pocket: pocket.get(week) ?? 0, met: ws.met[i] }
  })
  return { weeks, goal: ws.goal, streak: ws.streak, done: ws.done }
}

/** Session days with mild or sharp pain in the last 12 weeks, oldest first. */
export function painFlags(p: Progress, now: Date = new Date()): { day: string; pain: PainLevel }[] {
  const today = dayKey(now)
  return p.sessions.log
    .filter((d) => (d.pain === 'mild' || d.pain === 'sharp') && daysBetween(d.day, today) < 84)
    .map((d) => ({ day: d.day, pain: d.pain as PainLevel }))
}

/** Per counted day: minutes played vs the planned session length (null when no plan was made). */
export function minutesVsPlan(p: Progress): { day: string; min: number; plan: number | null }[] {
  return p.sessions.log.filter((d) => d.counted).map((d) => ({ day: d.day, min: Math.round(d.sec / 60), plan: d.min ?? null }))
}

// ---- Summary -----------------------------------------------------------------------------

export interface SummaryLine {
  label: string
  text: string
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The newest cold test and the in-session best of the session before it (null when none). Clean or not. */
function coldVsBest(rec: LessonRecord | undefined): { cold: ColdAttempt; best: number | null } | null {
  let prevBest: number | null = null
  let out: { cold: ColdAttempt; best: number | null } | null = null
  for (const e of rec?.hist ?? []) {
    if (e.cold) out = { cold: e.cold, best: prevBest }
    if (e.best !== undefined) prevBest = e.best
  }
  return out
}

/** The item with the widest gap between its in-session best and its cold tempo, among `ids` (first wins a tie). */
function widestGap(p: Progress, ids: string[]): { id: string; best: number; cold: number; clean: boolean } | null {
  let top: { id: string; best: number; cold: number; clean: boolean; gap: number } | null = null
  for (const id of ids) {
    const g = coldVsBest(p.lessons[id])
    if (!g || g.best === null) continue
    const gap = g.best - g.cold.bpm
    if (gap > 0 && (!top || gap > top.gap)) top = { id, best: g.best, cold: g.cold.bpm, clean: g.cold.clean, gap }
  }
  return top
}

/**
 * The 2–4 lines at the top of the progress screen: what has stuck, where the biggest gap is, chord changes,
 * and what comes next. Competence feedback, not points (plan section 9). "Learned" and "struggling" are the
 * review rules' own (review.ts), so the summary always agrees with the review brake on the daily plan.
 */
export function progressSummary(p: Progress, stats: SkillStats): SummaryLine[] {
  const passed = ORDER.filter((id) => {
    const l = lessonById(id)
    return !!l && isReviewItem(l) && standingOf(p.lessons[id]) !== 'open'
  })
  const learned = passed.filter((id) => standingOf(p.lessons[id]) === 'learned').length
  const struggling = strugglingList(p)
  const lines: SummaryLine[] = []

  // What has stuck. Only lessons in review (notes, chords, rhythm) get cold starts, so the count says so:
  // the map also counts Tap In and the jams as passed.
  if (!passed.length)
    lines.push({ label: 'Sticking', text: 'Nothing to measure yet. Pass a lesson with notes, chords or rhythm, and a cold start in a later session shows what stuck.' })
  else if (learned === passed.length)
    lines.push({ label: 'Sticking', text: `${passed.length === 1 ? 'Your lesson in review is' : `All ${passed.length} lessons in review are`} learned: clean from cold at full tempo.` })
  else
    lines.push({
      label: 'Sticking',
      text: `${learned} of ${count(passed.length, 'lesson')} in review learned so far. Learned means clean from cold at full tempo in ${LEARN_SESSIONS} separate sessions.`,
    })

  // The widest gap: struggling items first, as the plan reviews them; else any item not learned yet.
  const notLearned = passed.filter((id) => standingOf(p.lessons[id]) !== 'learned')
  const gap = widestGap(p, struggling) ?? (struggling.length ? null : widestGap(p, notLearned))
  if (gap)
    lines.push({
      label: 'Biggest gap',
      text: `${titleOf(gap.id)}, ${gap.best} BPM at best in a session vs ${gap.cold} from cold${gap.clean ? '' : ', not clean yet'}.`,
    })
  else if (struggling.length) {
    const id = struggling[0]
    const c = coldVsBest(p.lessons[id])!.cold
    lines.push({ label: 'Furthest to go', text: `${titleOf(id)}: the last cold start, at ${c.bpm} BPM, scored ${c.score}.` })
  }

  // One-minute changes: the pairs still on their way to 60, best first.
  const pairs = changesByPair(stats).filter((r) => r.best > 0)
  if (pairs.length) {
    const open = pairs.filter((r) => !r.retired).sort((a, b) => b.best - a.best)
    lines.push({
      label: 'Chord changes',
      text: open.length
        ? `${open
            .slice(0, 3)
            .map((r) => `${r.pair} ${r.best}`)
            .join(', ')} a minute at best. A pair is done at ${RETIRE_AT}.`
        : `Every pair you've played is at ${RETIRE_AT} a minute or more.`,
    })
  }

  // What comes next, by the same rules as today's plan.
  if (reviewBrake(p))
    lines.push({
      label: 'Next',
      text: `Review before new lessons. ${count(struggling.length, "lesson isn't", "lessons aren't")} sticking yet; new ones come once a few pass their cold start.`,
    })
  else if (struggling.length)
    lines.push({ label: 'Next', text: `${count(struggling.length, 'lesson')} to firm up in your review steps, alongside new lessons.` })
  else if (!passed.length) lines.push({ label: 'Next', text: 'Start with the first open lesson on the map.' })
  else if (learned === passed.length) lines.push({ label: 'Next', text: 'Something new: everything you passed has stuck.' })
  else lines.push({ label: 'Next', text: 'Keep up the cold starts. Each clean one at full tempo moves a lesson closer to learned.' })

  return lines
}
