// Today's session (research section 4): a 20 or 30 minute template shaped by the week (A/B/C/D),
// cold-start tests first, new material blocked, then mixed in once it has an earned tempo, and a jam to finish.
// Each step is a block that runs until its minutes are played, on the same clock as the daily practice goal.
// One plan per practice day in progress.plan. Every function is pure and returns new objects.
import type { Lesson, LessonResult, LoopSummary, PainLevel, Progress, SessionDay, SessionMin, SessionPlan, SessionStep, StepKind, WeekShape } from './types'
import type { SkillEntry, SkillStats } from '../skills/data'
import { bestKey, emptyStats } from '../skills/data'
import { CHANGE_CHORDS, weakestPair } from '../skills/chords'
import { ORDER, PLAN_PATH, lessonById, stageOf, weeksLabel } from './data'
import { dayKey, daysAway, isPassed, isUnlocked, nextLesson, resting, timingHabit, trimLog } from './progress'
import { weekFocus } from './weekly'
import { noteName } from '../music/theory'
import { FULL_SPEED, autoSpeed, bpmAt, earnedTop } from './speed'
import { drillTitle, heatReady, spotLabel, topSpots } from './heat'
import { SESSION_MIN_SEC, coldSpeedFor, isCold, isReviewItem, reviewBrake, sessionNow, sessionOf, strugglingList, weekKey, weekStatus } from './review'

export const WARMUPS = ['w1-02', 'w2-01', 'w5-01', 'w5-03']
export const SHAPE_LABEL: Record<WeekShape, string> = { A: 'New material', B: 'Review and ear', C: 'Consolidate, longer jam', D: 'Mostly jam and recording' }
export const KIND_LABEL: Record<StepKind, string> = {
  warmup: 'Warm-up',
  listenback: 'Listen back',
  cold: 'Cold start',
  new: 'New',
  mix: 'Mixed',
  changes: 'Changes',
  ear: 'By ear',
  song: 'Song',
  jam: 'Jam',
}
export const REST_SEC = 25 // heuristic (research 20–30 s): rest between runs of a new item
/** A block is done once it is within this of its minutes: a run never ends on the second. Heuristic. */
export const BLOCK_SLACK_SEC = 20
/** The longest single jam run; a longer jam block is split into runs of equal length. Heuristic: about one song. */
export const JAM_RUN_SEC = 300
/** After a run or a round, this much of the pause still counts as practice: the rest between reps (section 4 puts it inside the block). */
export const GAP_SEC = 30
/** Minutes of the Song block, on top of the session's own minutes. Heuristic. */
export const SONG_MIN = 5

export interface PlanCtx {
  unratedTake: boolean
  stats: SkillStats
  /** Lesson ids of the player's song parts whose week is open, in map order: with any, the session gets a Song block on top of its plan. */
  songParts?: string[]
  /** Songs whose parts are learned and whose path goes on in Learn a song: the Song block opens one of them. */
  songsToPlay?: { id: string; title: string }[]
}

/** Minutes per step (research section 4). Every list sums to the session length. */
export const TEMPLATES: Record<SessionMin, Record<WeekShape, [StepKind, number][]>> = {
  30: {
    A: [['warmup', 2], ['cold', 3], ['new', 8], ['changes', 4], ['ear', 3], ['jam', 10]],
    B: [['warmup', 2], ['cold', 3], ['cold', 3], ['mix', 5], ['changes', 4], ['ear', 5], ['jam', 8]],
    C: [['warmup', 2], ['cold', 3], ['new', 8], ['mix', 4], ['jam', 13]],
    D: [['warmup', 2], ['cold', 3], ['changes', 3], ['jam', 22]],
  },
  // 20 minutes: changes and ear take turns (A has changes, B has ear); C and D give that block to the jam.
  20: {
    A: [['warmup', 2], ['cold', 3], ['new', 6], ['changes', 3], ['jam', 6]],
    B: [['warmup', 2], ['cold', 3], ['mix', 4], ['ear', 5], ['jam', 6]],
    C: [['warmup', 2], ['cold', 3], ['new', 5], ['jam', 10]],
    D: [['warmup', 2], ['cold', 3], ['jam', 15]],
  },
}

const DRILL_MIN_SCORE = 0.2
const SYNC_ID = 'w1-01'
/** First Jam and Two-Note Jam: the early jams, which keep their own minutes. */
const TASTE_IDS = ['w2-05', 'w8-01']

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

const isSync = (id: string) => lessonById(id)?.type === 'sync'
const isImprov = (id: string) => lessonById(id)?.type === 'improv'
/** Tap In was played or skipped: the real plan can start. */
const syncDone = (p: Progress) => (p.lessons[SYNC_ID]?.plays ?? 0) >= 1
/** The plan made before Tap In: one Tap In step, replaced once Tap In is done. */
const setupOnly = (plan: SessionPlan) => plan.steps.length > 0 && plan.steps.every((s) => s.lessonId !== null && isSync(s.lessonId))

/** A plan context with no skill data (tests, and before the skill stats load). */
export const ctxDefault = (): PlanCtx => ({ unratedTake: false, stats: emptyStats() })

// ---- chords you know ----

const CHORDS_BY: [string[], string[]][] = [
  [['w3-02'], ['E5']],
  [['w3-06', 'w4-01'], ['A5', 'E5']],
  [['w3-05'], ['G', 'C', 'Em']],
  [['w3-04'], ['G', 'D', 'C', 'Em']],
  [['w3-09'], ['A', 'D', 'E']],
  [['w3-10'], ['A7', 'D7', 'E7']],
  [['w4-02'], ['G5']],
  [['w3-06', 'w4-05'], ['D5']],
]

/** Chords taught by passed lessons, in CHANGE_CHORDS order. */
export function knownChords(p: Progress): string[] {
  const got = new Set<string>()
  for (const [ids, chords] of CHORDS_BY) if (ids.some((id) => isPassed(p, id))) for (const c of chords) got.add(c)
  return CHANGE_CHORDS.filter((c) => got.has(c))
}

// ---- the week ----

const counted = (p: Progress) => (p.sessions?.log ?? []).filter((d) => d.counted)

/** Counted sessions this week before today: 0 → A, 1 → B, 2 → C, 3 or more → D. */
export function shapeFor(p: Progress, now: Date): WeekShape {
  const today = dayKey(now)
  const wk = weekKey(today)
  const n = counted(p).filter((d) => d.day < today && weekKey(d.day) === wk).length
  return (['A', 'B', 'C', 'D'] as const)[Math.min(3, n)]
}

/** Session numbers of this week's counted sessions before today. */
function weekSessionsBefore(p: Progress, now: Date): Set<number> {
  const today = dayKey(now)
  const wk = weekKey(today)
  return new Set(counted(p).filter((d) => d.day < today && weekKey(d.day) === wk).map((d) => sessionOf(p, d.day)))
}

// ---- step choice ----

interface Pick {
  id: string
  why: string
  drill?: string
  consolidate?: boolean
  brake?: boolean
}

/** Today's drill warm-up: the top trouble spot, once there is enough data and its lesson still exists. */
function drillPick(p: Progress, now: Date): Pick | null {
  if (!heatReady(p.heat, now)) return null
  const s = topSpots(p.heat, now, 1)[0]
  if (!s || s.score < DRILL_MIN_SCORE || !lessonById(s.lessonId)) return null
  return { id: s.lessonId, drill: s.key, why: `Your top trouble spot: ${spotLabel(s.key)}.` }
}

/**
 * A warm-up aimed at a timing habit: the passed lesson, played in the last two weeks, with the biggest steady lean
 * early or late (not one due a cold start, which must stay a first try). Null when no lesson has a habit.
 */
export function habitWarmup(p: Progress, now: Date): Pick | null {
  let best: { id: string; dir: 'early' | 'late'; ms: number } | null = null
  for (const [id, rec] of Object.entries(p.lessons)) {
    const l = lessonById(id)
    if (!l || !isPassed(p, id) || isCold(p, id, now) || now.getTime() - rec.lastPlayed > 14 * 86_400_000) continue
    const h = timingHabit(p.runs, id)
    if (h && (!best || h.ms > best.ms)) best = { id, dir: h.dir, ms: h.ms }
  }
  if (!best) return null
  const title = lessonById(best.id)?.title ?? best.id
  const why =
    best.dir === 'early'
      ? `Timing warm-up: you usually rush ${title} by about ${best.ms} ms. Play it relaxed and let every note wait for its click.`
      : `Timing warm-up: you usually drag ${title} by about ${best.ms} ms. Have each fret ready early and pick right on the click.`
  return { id: best.id, why }
}

/** Warm-ups never use an item due for a cold start: its first try today must be the cold test. */
function warmupList(p: Progress, now: Date): string[] {
  const passed = WARMUPS.filter((id) => isPassed(p, id)).reverse()
  return (passed.length ? passed : WARMUPS.filter((id) => isUnlocked(p, id))).filter((id) => !isCold(p, id, now))
}

/** The plan's lessons in map order, then the player's song parts (made at run time, so only those built now). */
const withSongParts = (p: Progress) => [...ORDER, ...Object.keys(p.lessons).filter((id) => id.startsWith('song:') && !!lessonById(id))]

/** Due cold-start items: soonest due first, then fewest cold passes, then map order. */
export function coldList(p: Progress, now: Date): string[] {
  return withSongParts(p)
    .map((id, i) => ({ id, i, r: p.lessons[id]?.review }))
    .filter((x) => x.r && isCold(p, x.id, now))
    .sort((a, b) => (a.r?.due ?? 0) - (b.r?.due ?? 0) || (a.r?.coldPasses ?? 0) - (b.r?.coldPasses ?? 0) || a.i - b.i)
    .map((x) => x.id)
}

function coldWhy(p: Progress, id: string): string {
  const lesson = lessonById(id)
  const rec = p.lessons[id]
  if (!lesson) return ''
  if (rec?.review?.learned) return 'Learned. A quick check that it still sticks.'
  return `First try, no warm-up, no tab. ${bpmAt(lesson, coldSpeedFor(lesson, rec))} BPM.`
}

const NEW_WHY = 'Practise it on its own. Rest 20–30 s between runs.'
const BRAKE_WHY = "Review first: this one isn't sticking yet. Its cold start first if it's due, then slow and clean, on its own. Rest 20–30 s between runs."

/**
 * Under the review brake: struggling items for the New slot, lowest cold score first. Items not due a cold start today
 * come first; most struggling items are due next session though, and those open with their cold test (stepOpensCold).
 */
function brakeList(p: Progress, now: Date): string[] {
  const all = strugglingList(p)
  return [...all.filter((id) => !isCold(p, id, now)), ...all.filter((id) => isCold(p, id, now))]
}

/**
 * New lessons: the plan's path first (the same list as the map's Continue), then the open extras in map order
 * (open, not passed, not free, not sync); else passed ones to polish, fewest stars first.
 */
export function newList(p: Progress): { ids: string[]; polish: boolean } {
  const fresh = (id: string) => !isSync(id) && !lessonById(id)?.free && isUnlocked(p, id) && !isPassed(p, id)
  const path = PLAN_PATH.filter(fresh)
  const open = [...path, ...ORDER.filter((id) => stageOf(id)?.core === false && fresh(id))]
  if (open.length) return { ids: open, polish: false }
  const ids = ORDER.filter((id) => !isSync(id) && isPassed(p, id) && p.lessons[id].stars < 3)
    .map((id, i) => ({ id, i, stars: p.lessons[id].stars }))
    .sort((a, b) => a.stars - b.stars || a.i - b.i)
    .map((x) => x.id)
  return { ids, polish: true }
}

/** Has an earned tempo: set by the clean-run trainer, or passed before it existed (no session history). */
const hasEarned = (p: Progress, id: string) => earnedTop(p.lessons[id]) > 0

/**
 * The C-session rule: new material only when this week brought fewer than 2 new items (jams aren't new material)
 * and the newest one has an earned tempo (nothing left to consolidate).
 */
/** Lessons that count as new material: not Tap In, not jams, not the easy warm-ups. */
const isMaterial = (id: string) => !isSync(id) && !isImprov(id) && !WARMUPS.includes(id)

function newAllowedInC(p: Progress, now: Date, s: number): boolean {
  const earlier = weekSessionsBefore(p, now)
  const ids = Object.keys(p.lessons).filter(isMaterial)
  const newThisWeek = ids.filter((id) => earlier.has(p.lessons[id].firstS ?? -1)).length
  return newThisWeek < 2 && consolidatePick(p, s) === null
}

/** The newest item first played in the last 2 sessions that has no earned tempo yet (firstS 0: an old save, never). */
function consolidatePick(p: Progress, s: number): string | null {
  const ids = Object.keys(p.lessons).filter((id) => {
    const rec = p.lessons[id]
    const l = lessonById(id)
    return !!l && isMaterial(id) && rec.firstS !== undefined && rec.firstS >= 1 && rec.firstS >= s - 2 && rec.firstS < s && rec.topSpeed === undefined
  })
  ids.sort((a, b) => (p.lessons[b].firstS ?? 0) - (p.lessons[a].firstS ?? 0) || (p.lessons[b].lastPlayed ?? 0) - (p.lessons[a].lastPlayed ?? 0))
  return ids[0] ?? null
}

/** Mix items: review items with an earned tempo, not first played this session, not due a cold start, newest first. */
function mixList(p: Progress, s: number, used: Set<string>, now: Date): string[] {
  // Song parts too, once passed with an earned tempo: a riff learned last week comes back like any lesson.
  // This week's focus (the weekly review's) goes first.
  const focus = weekFocus(p, now).map((f) => f.id)
  const rank = (id: string) => (focus.includes(id) ? 0 : 1)
  return withSongParts(p).filter((id) => {
    const l = lessonById(id)
    const rec = p.lessons[id]
    return !!l && !!rec && isReviewItem(l) && isPassed(p, id) && hasEarned(p, id) && rec.firstS !== s && !used.has(id) && !isCold(p, id, now) && !resting(rec, now)
  }).sort((a, b) => rank(a) - rank(b) || (p.lessons[b].firstS ?? -1) - (p.lessons[a].firstS ?? -1) || (p.lessons[b].passedAt ?? 0) - (p.lessons[a].passedAt ?? 0))
}

/** Different items a mix step needs before its minutes can end it: one item alone is not a mix. */
const mixNeed = (step: SessionStep) => Math.min(step.items?.length ?? 0, 2)

/** The mix item to play next: in turn, round and round. */
export function mixNext(step: SessionStep): string | null {
  const items = step.items ?? []
  return items.length ? items[(step.played?.length ?? 0) % items.length] : null
}

function mixWhy(items: string[]): string {
  const [a, b, c] = items.map((id) => lessonById(id)?.title ?? id)
  return `${a}, ${b}${c ? `, ${c}` : ''}. One run each, in turn, then round again.`
}

/** Jams: free jams not played last session (least recently played first), else the furthest open jam, else First Jam. */
function jamList(p: Progress, s: number): string[] {
  const open = ORDER.filter((id) => isImprov(id) && isUnlocked(p, id))
  const free = open
    .filter((id) => lessonById(id)?.free && !(p.lessons[id]?.hist ?? []).some((h) => h.s === s - 1))
    .sort((a, b) => (p.lessons[a]?.lastPlayed ?? 0) - (p.lessons[b]?.lastPlayed ?? 0))
  const rest = open.filter((id) => !free.includes(id)).reverse()
  const all = [...free, ...rest]
  return all.length ? all : [TASTE_IDS[0]]
}

const JAM_WHY = 'Wind down: jam in listen mode, band loud, no tab. Record the last 2 minutes if you like.'
const jamWhy = (p: Progress, id: string) =>
  isUnlocked(p, id) ? JAM_WHY : 'A first jam: free play with the band. A is the open A string, C is G string fret 5.'

function changesStep(p: Progress, ctx: PlanCtx): Pick & { skill: SessionStep['skill'] } {
  const pair = weakestPair(ctx.stats, knownChords(p))
  if (!pair) return { id: '', skill: { game: 'find' }, why: 'Fretboard notes: find each note fast.' }
  const best = ctx.stats.best[bestKey('changes', pair)]
  return { id: '', skill: { game: 'changes', pair }, why: best === undefined ? `One-minute changes: ${pair}. Your first try sets the baseline. Retire it at 60.` : `One-minute changes: ${pair}. Your best: ${best}. Retire it at 60.` }
}

function lessonStep(p: Progress, kind: StepKind, pick: Pick, min: number): SessionStep {
  const rec = p.lessons[pick.id]
  const lesson = lessonById(pick.id)
  const step: SessionStep = {
    kind,
    lessonId: pick.id,
    min,
    state: 'todo',
    why: pick.why,
    from: { best: rec?.best ?? 0, stars: rec?.stars ?? 0, speed: lesson ? autoSpeed(lesson, rec) : 1, loops: rec?.loops ?? 0 },
  }
  if (pick.drill) step.drill = pick.drill
  if (pick.consolidate) step.consolidate = true
  if (pick.brake) step.brake = true
  return step
}

const LOOP_JAM_FROM = 15 // jam minutes from which a session has a loop jam too
const LOOP_JAM_MIN = 8
const LOOP_JAM_WHY = 'Record two bars of chords on the looper, then solo over your own loop: rhythm and lead together, like a band of one.'

/** The loop jam's setup: two chords you know (A and D first, the blues pair) and the jam lesson's key, box and tempo. */
export function loopJam(p: Progress, jamId: string): Extract<SessionStep['skill'], { game: 'loop' }> | null {
  const known = knownChords(p)
  if (known.length < 2) return null
  const pick = ['A', 'D'].every((c) => known.includes(c)) ? ['A', 'D'] : known.slice(0, 2)
  const l = lessonById(jamId)
  const imp = l?.improv
  return { game: 'loop', chords: pick, bpm: l?.bpm ?? 90, ...(imp ? { key: noteName(imp.key), boxFret: imp.boxFret } : {}) }
}

function skillStep(kind: StepKind, skill: SessionStep['skill'], why: string, min: number): SessionStep {
  return { kind, lessonId: null, skill, min, state: 'todo', why, from: { best: 0, stars: 0, speed: 1, loops: 0 } }
}

/** A fresh session plan for `now`'s practice day. */
export function makeSessionPlan(p: Progress, now: Date, ctx: PlanCtx): SessionPlan {
  const today = dayKey(now)
  const min = p.sessionMin ?? 30
  const shape = shapeFor(p, now)
  const away = daysAway(p, today)
  const plan = (steps: SessionStep[]): SessionPlan => (away === null ? { v: 2, day: today, min, shape, steps } : { v: 2, day: today, min, shape, steps, away })

  // A brand-new player: Tap In first, nothing else.
  if (!syncDone(p)) return plan([lessonStep(p, 'new', { id: SYNC_ID, why: 'Set up your timing first.' }, 5)])

  const s = sessionNow(p, now)
  const used = new Set<string>()
  const colds = coldList(p, now)
  // Plan section 4: with REVIEW_BRAKE or more items failing their cold start, no new lesson today.
  const brake = reviewBrake(p)
  let extraJam = 0
  let spare = 0
  const steps: SessionStep[] = []
  const kinds = TEMPLATES[min][shape].map(([k]) => k)

  for (const [kind, m] of TEMPLATES[min][shape]) {
    if (kind === 'warmup') {
      // A drill on an item due for a cold start would warm it up: then the plain warm-up instead.
      // A timing habit first (the warm-up aimed at how you play), then the top trouble spot.
      const hp = habitWarmup(p, now)
      const dp = hp && !colds.includes(hp.id) ? hp : drillPick(p, now)
      const d = dp && !colds.includes(dp.id) ? dp : null
      const id = d ? null : (warmupList(p, now).find((x) => !used.has(x)) ?? null)
      if (d) {
        // Cold, new and mix steps skip the drilled lesson, except New keeps the Continue lesson so both name the same one.
        if (d.id !== nextLesson(p)) used.add(d.id)
        steps.push(lessonStep(p, 'warmup', d, m))
      } else if (id) {
        used.add(id)
        steps.push(lessonStep(p, 'warmup', { id, why: 'Easy start. Shake off the day.' }, m))
      } else extraJam += m
      if (ctx.unratedTake) {
        steps.push(skillStep('listenback', { game: 'record' }, "Listen to last session's jam take and rate it.", 1))
        extraJam -= 1
      }
    } else if (kind === 'cold') {
      const id = colds.find((x) => !used.has(x))
      if (!id) {
        extraJam += m
        continue
      }
      used.add(id)
      steps.push(lessonStep(p, 'cold', { id, why: coldWhy(p, id) }, m))
    } else if (kind === 'new') {
      if (brake) {
        // The New minutes go to a struggling item, blocked; with none free, to the mix (or changes and ear).
        const id = brakeList(p, now).find((x) => !used.has(x))
        if (id) {
          used.add(id)
          steps.push(lessonStep(p, 'new', { id, consolidate: true, brake: true, why: BRAKE_WHY }, m))
        } else steps.push({ ...skillStep('mix', undefined, '', m), lessonId: null })
        continue
      }
      const allowed = shape === 'A' || (shape === 'C' && newAllowedInC(p, now, s))
      const cons = allowed ? null : consolidatePick(p, s)
      if (cons && !used.has(cons)) {
        used.add(cons)
        steps.push(lessonStep(p, 'new', { id: cons, consolidate: true, why: "Last session's new one again, on its own, until it's slow and clean." }, m))
        continue
      }
      if (allowed) {
        const { ids, polish } = newList(p)
        const id = ids.find((x) => !used.has(x))
        if (id) {
          used.add(id)
          steps.push(lessonStep(p, 'new', { id, why: polish ? 'Go for 3 stars.' : NEW_WHY }, m))
          continue
        }
        extraJam += m
        continue
      }
      // Nothing to consolidate: interleave instead.
      steps.push({ ...skillStep('mix', undefined, '', m), lessonId: null })
    } else if (kind === 'mix') {
      steps.push({ ...skillStep('mix', undefined, '', m), lessonId: null })
    } else if (kind === 'changes') {
      const c = changesStep(p, ctx)
      steps.push(skillStep('changes', c.skill, c.why, m))
    } else if (kind === 'ear') {
      steps.push(skillStep('ear', { game: 'ear' }, 'Call and response: copy short phrases by ear.', m))
    } else if (kind === 'jam') {
      const id = jamList(p, s)[0]
      // Only an early jam so far: the jam keeps its own minutes, the rest goes to guided work below.
      const extra = TASTE_IDS.includes(id) ? Math.min(0, extraJam) : extraJam
      spare = extraJam - extra
      const total = m + extra
      // A long jam (a D session) gives 8 of its minutes to jamming over your own loop, once two chords are known.
      const loop = total >= LOOP_JAM_FROM ? loopJam(p, id) : null
      if (loop) {
        steps.push(lessonStep(p, 'jam', { id, why: jamWhy(p, id) }, total - LOOP_JAM_MIN))
        steps.push(skillStep('jam', loop, LOOP_JAM_WHY, LOOP_JAM_MIN))
      } else steps.push(lessonStep(p, 'jam', { id, why: jamWhy(p, id) }, total))
    }
  }

  // Mix steps are filled last, so they skip today's new and cold items. Under the brake, struggling items go first
  // (only those not due a cold test today, so mostly ones with two clean cold tests behind them).
  const stuck = brake ? strugglingList(p) : []
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]
    if (st.kind !== 'mix') continue
    const pool = mixList(p, s, used, now)
    const items = [...stuck.filter((id) => pool.includes(id)), ...pool.filter((id) => !stuck.includes(id))].slice(0, 3)
    if (items.length >= 2) {
      for (const id of items) used.add(id)
      steps[i] = { ...st, items, played: [], why: mixWhy(items) }
      continue
    }
    // Fewer than 2 items with an earned tempo: changes, or ear when changes is already in the plan.
    const hasChanges = steps.some((x) => x.kind === 'changes') || kinds.includes('changes')
    if (hasChanges) steps[i] = skillStep('ear', { game: 'ear' }, 'Call and response: copy short phrases by ear.', st.min)
    else {
      const c = changesStep(p, ctx)
      steps[i] = skillStep('changes', c.skill, c.why, st.min)
    }
  }
  // A real song before the jam, when the player has any: added on top of the plan (nothing gives up its minutes),
  // a different song each session.
  const songPick = pickSongPart(p, (ctx.songParts ?? []).filter((id) => !used.has(id)))
  const ji = steps.findIndex((x) => x.kind === 'jam')
  if (ji >= 0) {
    // A part not learned yet first; else a song whose path goes on in Learn a song; else a known part, kept fresh.
    const fresh = songPick && !isPassed(p, songPick.id)
    const song = !fresh ? songToPlay(ctx.songsToPlay ?? [], now) : null
    if (song) steps.splice(ji, 0, songStep(song, SONG_MIN))
    else if (songPick) steps.splice(ji, 0, lessonStep(p, 'song', songPick, SONG_MIN))
  }
  // Spare minutes (no cold item, no warm-up) go to blocked reps of the new item, else changes or ear;
  // with none of those the session is simply shorter.
  if (spare > 0) {
    const to = ['new', 'changes', 'ear', 'mix'].map((k) => steps.find((x) => x.kind === k)).find((x) => x !== undefined)
    if (to) to.min += spare
  }
  return plan(steps)
}

// ---- blocks on the clock ----
// A step is a block: it runs until its minutes are played (plan section 4), not until one run is over.
// The seconds are the practice log's (the clock behind the top bar's goal ring); LessonsMode hands them in.

export const stepSec = (s: SessionStep): number => s.sec ?? 0
/** Seconds left in the block: 0 once its minutes are played. */
export const stepLeftSec = (s: SessionStep): number => Math.max(0, s.min * 60 - stepSec(s))
/** Played, not done yet: the block is running. */
export const stepStarted = (s: SessionStep): boolean => s.state === 'todo' && ((s.runs ?? 0) > 0 || stepSec(s) > 0)
/** Listen back ends with the rating and Tap In with its one run; every other step runs on the clock. */
const timed = (s: SessionStep) => s.kind !== 'listenback' && !(s.lessonId !== null && isSync(s.lessonId))
const timeUp = (s: SessionStep) => stepSec(s) >= s.min * 60 - BLOCK_SLACK_SEC
const addSec = (s: SessionStep, sec: number) => {
  const add = Math.max(0, Math.round(sec))
  if (add) s.sec = stepSec(s) + add
}

/** Seconds of one pass through a lesson at `speed`, the count-in left out. */
export const passSec = (lesson: Lesson, speed: number): number => (lesson.bars * 4 * 60) / Math.max(1, bpmAt(lesson, speed))

/**
 * How many times through a jam plays in one run of a block with `leftSec` to go: the block is split into
 * runs of equal length, none over JAM_RUN_SEC, and a run is never under one pass.
 */
export function jamPasses(lesson: Lesson, speed: number, leftSec: number): number {
  const runs = Math.max(1, Math.ceil(leftSec / JAM_RUN_SEC))
  return Math.max(1, Math.min(64, Math.round(leftSec / runs / passSec(lesson, speed))))
}

/** "1:05" */
export function clockText(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What a step is called on the session card and on buttons. */
export function stepTitle(s: SessionStep): string {
  if (s.drill) return drillTitle(s.drill)
  if (s.lessonId) return lessonById(s.lessonId)?.title ?? (s.lessonId.startsWith('song:') ? 'A part of your song' : s.lessonId)
  if (s.kind === 'mix') return `${s.items?.length ?? 0} lessons in turn`
  if (s.song) return s.song.title
  if (s.kind === 'listenback') return 'Your last jam take'
  if (s.skill?.game === 'changes') return s.skill.pair ? `One-minute changes: ${s.skill.pair}` : 'One-minute changes'
  if (s.skill?.game === 'find') return 'Fretboard notes'
  if (s.skill?.game === 'ear') return 'Call and response'
  if (s.skill?.game === 'loop') return 'Jam over your own loop'
  return KIND_LABEL[s.kind]
}

/** While a block runs: what to do with the rest of its minutes. */
const BLOCK_HINT: Record<StepKind, string> = {
  warmup: 'Play it again until the time is up.',
  listenback: '',
  cold: 'Now with the tab: play it again and fix what slipped.',
  new: 'Rest, then play it again.',
  mix: 'On to the next one in the mix.',
  changes: 'Another round.',
  ear: 'Another round.',
  song: 'Play it again until the time is up.',
  jam: 'Jam on.',
}

/** A block's clock in words: "Warm-up: 1:20 of 2 min. Play it again until the time is up." or "Warm-up done." */
export function blockLine(s: SessionStep): string {
  // A skill block by its game (Fretboard notes, Call and response), not its slot in the plan.
  const kind = s.skill ? stepTitle(s) : KIND_LABEL[s.kind]
  if (s.state === 'done') return `${kind} done.`
  if (s.state === 'skipped') return `${kind} skipped.`
  return `${kind}: ${clockText(stepSec(s))} of ${s.min} min. ${BLOCK_HINT[s.kind]}`.trim()
}

/** A plan made before the brake came on, with a new lesson in it and nothing played yet: made again. */
const brakeStale = (p: Progress, plan: SessionPlan) =>
  !plan.steps.some((s) => s.state === 'done' || stepStarted(s)) &&
  plan.steps.some((s) => s.kind === 'new' && !s.consolidate && s.lessonId !== null && !isSync(s.lessonId)) &&
  reviewBrake(p)

/** Progress with today's plan, or null when today's v2 plan is already stored (no save needed). */
export function withTodayPlan(p: Progress, now: Date, ctx: PlanCtx): Progress | null {
  const plan = p.plan
  if (plan && plan.v === 2 && plan.day === dayKey(now) && !(setupOnly(plan) && syncDone(p)) && !brakeStale(p, plan)) return null
  return { ...p, plan: makeSessionPlan(p, now, ctx) }
}

/** A different song each day, in turn (by day number), from the songs whose path goes on in Learn a song. */
function songToPlay(songs: { id: string; title: string }[], now: Date): { id: string; title: string } | null {
  if (!songs.length) return null
  const dayNo = Math.floor(new Date(dayKey(now)).getTime() / 86_400_000)
  return songs[dayNo % songs.length]
}

/** A Song block played in Learn a song: the song's next level on its path. */
function songStep(song: { id: string; title: string }, min: number): SessionStep {
  return { kind: 'song', lessonId: null, song, min, state: 'todo', why: 'Its parts are learned: play it with the song in Learn a song, the next level on its path.', from: { best: 0, stars: 0, speed: 1 } }
}

/** The song part to play: the next one not passed yet; with all passed, the one played longest ago. */
function pickSongPart(p: Progress, parts: string[]): { id: string; why: string } | null {
  const ok = parts.filter((id) => !!lessonById(id))
  if (!ok.length) return null
  const fresh = ok.find((id) => !isPassed(p, id))
  if (fresh) return { id: fresh, why: 'A part of one of your songs. It starts slow; clean runs earn the tempo.' }
  const id = [...ok].sort((a, b) => (p.lessons[a]?.lastPlayed ?? 0) - (p.lessons[b]?.lastPlayed ?? 0))[0]
  return { id, why: 'A song part you know: keep it fresh.' }
}

/**
 * Today's song steps whose part can't be played any more (its song was deleted, or its tab no longer makes that
 * part) take another of the player's song parts, or are skipped when there is none. `songParts`: the parts there
 * are now. Null when nothing changed. Steps keep their place, so a block in progress keeps its index.
 */
export function withSongStepsFixed(p: Progress, songParts: string[]): Progress | null {
  const plan = p.plan
  if (!plan) return null
  const there = new Set(songParts.filter((id) => !!lessonById(id)))
  const gone = (st: SessionStep) => st.kind === 'song' && st.state === 'todo' && !!st.lessonId && !there.has(st.lessonId)
  if (!plan.steps.some(gone)) return null
  const inPlan = new Set(plan.steps.map((st) => st.lessonId).filter((id): id is string => !!id))
  const steps = plan.steps.map((st) => {
    if (!gone(st)) return st
    const pick = pickSongPart(p, [...there].filter((id) => !inPlan.has(id)))
    if (!pick) return { ...st, state: 'skipped' as const, why: 'That song is no longer in your library.' }
    inPlan.add(pick.id)
    const made = lessonStep(p, 'song', pick, st.min)
    // Time already played in this block still counts.
    return { ...made, sec: st.sec }
  })
  return { ...p, plan: { ...plan, steps } }
}

export function planDone(plan: SessionPlan): boolean {
  const done = plan.steps.filter((s) => s.state === 'done').length
  return plan.steps.length > 0 && !plan.steps.some((s) => s.state === 'todo') && done >= Math.min(2, plan.steps.length)
}

/**
 * The step opens the Cold start card: a cold step, or a review-first step whose item is still due its cold test.
 * As an ordinary run, its first try today would not be scored as the cold test, and the test would wait for a later session.
 */
export function stepOpensCold(p: Progress, step: SessionStep, now: Date): boolean {
  return !!step.lessonId && (step.kind === 'cold' || !!step.brake) && isCold(p, step.lessonId, now)
}

/** First todo step, -1 when none. */
export function nextStepIndex(plan: SessionPlan): number {
  return plan.steps.findIndex((s) => s.state === 'todo')
}

/** Minutes of the steps still in the plan (todo and done, not skipped). */
export function planMinutes(plan: SessionPlan): number {
  return plan.steps.reduce((a, s) => a + (s.state === 'skipped' ? 0 : s.min), 0)
}

/** Practice seconds played in the plan's blocks so far (skipped steps left out). */
export function planPlayedSec(plan: SessionPlan): number {
  return plan.steps.reduce((a, s) => a + (s.state === 'skipped' ? 0 : stepSec(s)), 0)
}

export interface Ticked {
  progress: Progress
  finished: boolean // this tick finished the session
  step: number | null // the plan step it counted for
}

/** What a finished run brings to its block, beyond its score. */
export interface RunCredit {
  sec?: number // practice seconds the run adds to the block
  coldClean?: boolean // it was the item's cold-start test, and clean: nothing to fix, so the block is over
  mastered?: boolean // it earned the lesson's full tempo: more reps today would only pad the minutes
}

/** Closes step i (inside `next`) when `done`, and says whether that finished the session. */
function tick(next: Progress, i: number, done: boolean): Ticked {
  const plan = next.plan as SessionPlan
  const wasDone = planDone(plan)
  if (done) plan.steps[i].state = 'done'
  return { progress: next, finished: done && !wasDone && planDone(plan), step: i }
}

const todayPlan = (p: Progress, now: Date) => (p.plan && p.plan.v === 2 && p.plan.day === dayKey(now) ? p.plan : null)

/**
 * Counts a run for its block: a lesson step of that lesson, or the mix step that holds it. The block keeps
 * going, run after run, until its minutes are played. Two things end it sooner, so minutes are never padded:
 * a clean cold-start test (a cold block), and a full tempo earned (a new block).
 */
export function planAfterRun(p: Progress, lessonId: string, r: LessonResult, now: Date, c: RunCredit = {}): Ticked {
  const same: Ticked = { progress: p, finished: false, step: null }
  const plan = todayPlan(p, now)
  if (!plan) return same
  // Tap In done: drop the setup plan, the home screen makes the real one.
  if (setupOnly(plan) && syncDone(p)) return { progress: { ...p, plan: null }, finished: false, step: null }
  const next = clone(p)
  const steps = (next.plan as SessionPlan).steps
  // A later run of a done step's lesson raises today's best; the first score and a cold score never change.
  let raised = false
  for (const s of steps) {
    if (s.state !== 'done' || s.lessonId !== lessonId || s.drill || s.kind === 'cold' || s.score === undefined) continue
    const best = Math.max(s.best ?? s.score, r.score)
    if (best !== s.best) {
      s.best = best
      raised = true
    }
  }
  const i = steps.findIndex((s) => s.state === 'todo' && s.lessonId === lessonId && !s.drill)
  if (i >= 0) {
    const step = steps[i]
    step.runs = (step.runs ?? 0) + 1
    addSec(step, c.sec ?? 0)
    if (step.score === undefined) {
      step.score = r.score
      step.speed = r.speed
    } else if (step.kind !== 'cold') step.best = Math.max(step.best ?? step.score, r.score)
    const done = !timed(step) || timeUp(step) || (step.kind === 'cold' && !!c.coldClean) || (step.kind === 'new' && !!c.mastered)
    return tick(next, i, done)
  }
  const m = steps.findIndex((s) => s.state === 'todo' && s.kind === 'mix' && !!s.items?.includes(lessonId))
  if (m < 0) return raised ? { progress: next, finished: false, step: null } : same
  const mix = steps[m]
  mix.played = [...(mix.played ?? []), lessonId]
  mix.runs = (mix.runs ?? 0) + 1
  addSec(mix, c.sec ?? 0)
  if (mix.score === undefined || r.score >= mix.score) {
    mix.score = r.score
    mix.speed = r.speed
  }
  return tick(next, m, timeUp(mix) && new Set(mix.played).size >= mixNeed(mix))
}

/** A drill loop counts for today's drill step: score = its best pass, and the loop's seconds go to the block. */
export function planAfterLoop(p: Progress, drillKey: string, s: LoopSummary, now: Date, sec = 0): Ticked {
  const same: Ticked = { progress: p, finished: false, step: null }
  if (!todayPlan(p, now) || !s.passes.length) return same
  const next = clone(p)
  const steps = (next.plan as SessionPlan).steps
  const score = Math.round(100 * Math.max(...s.passes.map((x) => x.acc)))
  const speed = s.topSpeed || s.passes[s.passes.length - 1].speed
  const i = steps.findIndex((x) => x.drill === drillKey && x.state === 'todo')
  if (i >= 0) {
    const step = steps[i]
    step.runs = (step.runs ?? 0) + 1
    addSec(step, sec)
    if (step.score === undefined) {
      step.score = score
      step.speed = speed
    } else if (score > Math.max(step.score, step.best ?? 0)) step.best = score
    return tick(next, i, timeUp(step))
  }
  // A later loop of a done drill raises today's best, like a later run of a lesson.
  const done = steps.find((x) => x.drill === drillKey && x.state === 'done' && x.score !== undefined)
  if (!done || score <= Math.max(done.score ?? 0, done.best ?? 0)) return same
  done.best = score
  return { progress: next, finished: false, step: null }
}

/**
 * A skill round counts for the first todo skill step of its game (a rating ends Listen back).
 * A changes block starts on its pair; later rounds in the same block may move on to another pair.
 */
export function planAfterSkill(p: Progress, e: SkillEntry, now: Date, sec = 0): Ticked {
  const same: Ticked = { progress: p, finished: false, step: null }
  if (!todayPlan(p, now)) return same
  const next = clone(p)
  const steps = (next.plan as SessionPlan).steps
  const i = steps.findIndex((s) => {
    if (s.state !== 'todo' || !s.skill) return false
    if (e.game === 'rate') return s.kind === 'listenback'
    if (s.kind === 'listenback') return false
    if (s.skill.game !== e.game) return false
    return s.skill.game !== 'changes' || !s.skill.pair || s.skill.pair === e.detail || (s.runs ?? 0) > 0
  })
  if (i < 0) return same
  const step = steps[i]
  step.runs = (step.runs ?? 0) + 1
  addSec(step, sec)
  if (step.score === undefined || e.score >= step.score) {
    step.score = e.score
    step.speed = 1
  }
  return tick(next, i, !timed(step) || timeUp(step))
}

/** Back from Learn a song: the seconds played there count for the Song block at step i. */
export function planAfterSong(p: Progress, i: number, sec: number, now: Date): Ticked {
  const same: Ticked = { progress: p, finished: false, step: null }
  const step = todayPlan(p, now)?.steps[i]
  if (!step || step.state !== 'todo' || step.kind !== 'song' || Math.round(sec) <= 0) return same
  const next = clone(p)
  const s = (next.plan as SessionPlan).steps[i]
  s.runs = (s.runs ?? 0) + 1
  addSec(s, sec)
  return tick(next, i, timeUp(s))
}

/**
 * Practice seconds that belong to block i without a finished run: the rest between reps, a run that was stopped,
 * a loop of the block's hard bars. Time alone ends a block only once something in it was played to the end.
 */
export function planAddTime(p: Progress, i: number, sec: number, now: Date): Ticked {
  const same: Ticked = { progress: p, finished: false, step: null }
  const step = todayPlan(p, now)?.steps[i]
  if (!step || step.state !== 'todo' || !timed(step) || Math.round(sec) <= 0) return same
  const next = clone(p)
  const s = (next.plan as SessionPlan).steps[i]
  addSec(s, sec)
  // A loop jam has no runs to count: its minutes are enough.
  const played = (s.runs ?? 0) > 0 || s.skill?.game === 'loop'
  return tick(next, i, played && timeUp(s) && (s.kind !== 'mix' || new Set(s.played ?? []).size >= mixNeed(s)))
}

export interface StepScore {
  label: 'cold' | 'today' // cold: the first try today; today: the best run today
  value: number
  ever: number | null // the lesson's best ever, when higher than value
}

/** The score a done lesson step shows, labelled; null for todo, skill and mix steps. */
export function stepScore(p: Progress, step: SessionStep): StepScore | null {
  if (step.state !== 'done' || !step.lessonId || step.score === undefined || step.kind === 'mix') return null
  const cold = step.kind === 'cold'
  const value = cold ? step.score : Math.max(step.score, step.best ?? step.score)
  const best = step.drill ? undefined : p.lessons[step.lessonId]?.best
  return { label: cold ? 'cold' : 'today', value, ever: best !== undefined && best > value ? best : null }
}

/**
 * Why this lesson is in today's session, in a few words: for cold and new steps only.
 * Warm-ups, drills and jams come every session, so their place on the map is no reason.
 */
export function stepSource(step: SessionStep): string | null {
  if (step.extra) return 'Extra time'
  if (!step.lessonId) return null
  if (step.kind === 'cold') return 'Review, due today'
  if (step.kind !== 'new') return null
  if (step.brake) return 'Review first'
  // A new step on a lesson passed before the plan was made: polishing it.
  if (!step.consolidate && step.from.stars > 0) return 'Going for 3 stars'
  const at = stageOf(step.lessonId)
  if (!at) return null
  const weeks = at.stage.weeks ? weeksLabel(at.stage).toLowerCase() : null
  if (at.core) return weeks ? `From your plan, ${weeks}` : null
  return weeks ? `Optional extra, ${weeks}` : 'Optional extra'
}

/** Ids of the lesson steps other than i (mix items included). */
const otherIds = (plan: SessionPlan, i: number) => new Set(plan.steps.filter((_, j) => j !== i).flatMap((s) => [...(s.lessonId ? [s.lessonId] : []), ...(s.items ?? [])]))

function candidates(p: Progress, step: SessionStep, now: Date): string[] {
  const s = sessionNow(p, now)
  if (step.kind === 'warmup') return warmupList(p, now)
  if (step.kind === 'cold') return coldList(p, now)
  if (step.kind === 'new') return step.brake ? brakeList(p, now) : step.consolidate ? [] : newList(p).ids
  if (step.kind === 'jam') return jamList(p, s).filter((id) => isUnlocked(p, id))
  return []
}

function whyFor(p: Progress, step: SessionStep, id: string): string {
  if (step.kind === 'cold') return coldWhy(p, id)
  if (step.kind === 'warmup') return 'Easy start. Shake off the day.'
  if (step.kind === 'jam') return jamWhy(p, id)
  if (step.brake) return BRAKE_WHY
  return isPassed(p, id) ? 'Go for 3 stars.' : NEW_WHY
}

/** A block that is running keeps its lesson. The jam is the exception: another jam for the rest of its minutes is fine. */
const swappable = (step: SessionStep) => !!step.lessonId && !step.drill && (!stepStarted(step) || step.kind === 'jam')

/** Other lesson ids for step i (never one another step already uses). Drill, mix and skill steps have none. */
export function swapOptions(p: Progress, i: number, now = new Date()): string[] {
  const plan = p.plan
  const step = plan?.steps[i]
  if (!plan || !step || !swappable(step)) return []
  const others = otherIds(plan, i)
  return candidates(p, step, now).filter((id) => id !== step.lessonId && !others.has(id))
}

/** Step i with the next option of its kind, cycling; why and from are refreshed. A running jam keeps its minutes played. */
export function swapStep(p: Progress, i: number, now: Date): Progress {
  const plan = p.plan
  const step = plan?.steps[i]
  if (!plan || !step || !step.lessonId || !swappable(step)) return p
  const others = otherIds(plan, i)
  const list = candidates(p, step, now).filter((id) => !others.has(id))
  const at = list.indexOf(step.lessonId)
  const id = list[(at + 1) % list.length]
  if (!id || id === step.lessonId) return p
  const next = clone(p)
  const fresh = lessonStep(next, step.kind, { id, why: whyFor(next, step, id), consolidate: step.brake, brake: step.brake }, step.min)
  if (step.sec) fresh.sec = step.sec
  if (step.runs) fresh.runs = step.runs
  if (step.extra) fresh.extra = true
  ;(next.plan as SessionPlan).steps[i] = fresh
  return next
}

/** Todo <-> skipped. A block that was started is closed instead: it was played, so it is done. Done steps stay done. */
export function skipStep(p: Progress, i: number): Progress {
  const step = p.plan?.steps[i]
  if (!step || step.state === 'done') return p
  const next = clone(p)
  const s = (next.plan as SessionPlan).steps[i]
  s.state = s.state === 'skipped' ? 'todo' : stepStarted(s) ? 'done' : 'skipped'
  return next
}

// ---- keep going: extra blocks once the session is done ----

export type ExtraKind = 'jam' | 'reps' | 'changes'
export interface ExtraOption {
  kind: ExtraKind
  label: string // the button: "Jam: Shuffle in E"
  min: number
}

const EXTRA_MIN = 2
const EXTRA_MAX = 10
/** Minutes of an extra block when `leftSec` of the day's goal is still to play. */
const extraMin = (leftSec: number) => Math.max(EXTRA_MIN, Math.min(EXTRA_MAX, Math.round(leftSec / 60)))

/** Today's piece that is worth more reps: the new (or review-first) lesson without its full tempo, else a cold start that slipped today. */
function repsPick(p: Progress, plan: SessionPlan): string | null {
  const played = (s: SessionStep) => s.state !== 'skipped' && s.lessonId !== null && !isSync(s.lessonId) && !isImprov(s.lessonId)
  const fresh = plan.steps.find((s) => s.kind === 'new' && played(s) && earnedTop(p.lessons[s.lessonId as string]) < FULL_SPEED)
  if (fresh) return fresh.lessonId
  const slipped = plan.steps.find((s) => s.kind === 'cold' && played(s) && (p.lessons[s.lessonId as string]?.hist ?? []).some((h) => h.cold?.d === plan.day && !h.cold.clean))
  return slipped?.lessonId ?? null
}

/** The extra block of one kind, or null when there is nothing of that kind to play. */
function extraStep(p: Progress, plan: SessionPlan, now: Date, ctx: PlanCtx, kind: ExtraKind, min: number): SessionStep | null {
  let step: SessionStep | null = null
  if (kind === 'jam') {
    // A jam the session hasn't had yet, when there is one.
    const used = otherIds(plan, -1)
    const list = jamList(p, sessionNow(p, now))
    const id = list.find((x) => !used.has(x)) ?? list[0]
    if (id) step = lessonStep(p, 'jam', { id, why: jamWhy(p, id) }, min)
  } else if (kind === 'reps') {
    const id = repsPick(p, plan)
    if (id) step = lessonStep(p, 'new', { id, consolidate: true, why: "More of today's piece, on its own. Rest 20–30 s between runs." }, min)
  } else {
    const c = changesStep(p, ctx)
    step = skillStep('changes', c.skill, c.why, min)
  }
  if (step) step.extra = true
  return step
}

function extraLabel(step: SessionStep): string {
  if (step.lessonId) {
    const title = lessonById(step.lessonId)?.title ?? step.lessonId
    return step.kind === 'jam' ? `Jam: ${title}` : `More of ${title}`
  }
  if (step.skill?.game === 'changes') return step.skill.pair ? `One-minute changes: ${step.skill.pair}` : 'One-minute changes'
  return 'Fretboard notes'
}

/**
 * What to play once the session is done and the day's minutes are not: a jam first (it stays the wind-down),
 * then more of today's piece, then one-minute changes. Each is one more block of the session.
 */
export function extraOptions(p: Progress, now: Date, ctx: PlanCtx, leftSec: number): ExtraOption[] {
  const plan = todayPlan(p, now)
  if (!plan) return []
  const min = extraMin(leftSec)
  return (['jam', 'reps', 'changes'] as const).flatMap((kind) => {
    const step = extraStep(p, plan, now, ctx, kind, min)
    return step ? [{ kind, label: extraLabel(step), min }] : []
  })
}

/** Today's plan with one more block at its end; unchanged when there is no plan or nothing of that kind. */
export function withExtraStep(p: Progress, now: Date, ctx: PlanCtx, kind: ExtraKind, leftSec: number): Progress {
  const plan = todayPlan(p, now)
  const step = plan ? extraStep(p, plan, now, ctx, kind, extraMin(leftSec)) : null
  if (!plan || !step) return p
  return { ...p, plan: { ...plan, steps: [...plan.steps, step] } }
}

/** What got better in today's done steps: best score, stars, earned tempo, loops, cold passes. Only real gains. */
export function improvements(p: Progress, plan: SessionPlan): string[] {
  const lines: string[] = []
  for (const s of plan.steps) {
    const ids = s.kind === 'mix' ? (s.played ?? []) : s.lessonId ? [s.lessonId] : []
    if (s.state !== 'done' && !(s.kind === 'mix' && ids.length)) continue
    for (const id of ids) {
      const rec = p.lessons[id]
      const lesson = lessonById(id)
      const title = lesson?.title
      if (!rec || !lesson || !title || isSync(id)) continue
      if (s.kind !== 'mix') {
        if (rec.best > s.from.best) lines.push(s.from.best > 0 ? `${title}: best ${s.from.best}% → ${rec.best}%` : `${title}: first score ${rec.best}%`)
        if (rec.stars > s.from.stars) {
          const d = rec.stars - s.from.stars
          lines.push(`${title}: +${d} star${d === 1 ? '' : 's'}`)
        }
        const dl = (rec.loops ?? 0) - (s.from.loops ?? 0)
        if (dl > 0) lines.push(`${title}: ${dl} loop${dl === 1 ? '' : 's'} locked in`)
        if (autoSpeed(lesson, rec) > s.from.speed && rec.topSpeed !== undefined) lines.push(`${title}: ${bpmAt(lesson, rec.topSpeed)} BPM earned`)
      }
      const cold = (rec.hist ?? []).find((h) => h.cold?.d === plan.day)?.cold
      if (cold?.clean) lines.push(`${title}: clean from cold at ${cold.bpm} BPM`)
    }
  }
  // A drill step shares its lesson with another step at times: say each line once.
  return [...new Set(lines)]
}

// ---- the session log ----

function upsertDay(p: Progress, day: string, fn: (d: SessionDay) => SessionDay): Progress {
  const log = p.sessions?.log ?? []
  const old = log.find((d) => d.day === day) ?? { day, sec: 0, set: false, counted: false, pocket: false }
  const nd = fn({ ...old })
  const t = trimLog([...log.filter((d) => d.day !== day), nd], p.sessions?.before ?? 0)
  return { ...p, sessions: t }
}

/**
 * Today's session day from the practice log and the plan. A day counts with a finished plan or 10 minutes of playing.
 * When the day that meets the week goal turns counted, the week is recorded as met (no XP: XP is for competence).
 */
export function withSessionDay(p: Progress, now: Date, practiceSec: number): { progress: Progress; changed: boolean; counted: boolean; weekMet: boolean } {
  const today = dayKey(now)
  const old = (p.sessions?.log ?? []).find((d) => d.day === today)
  const plan = todayPlan(p, now)
  const nd: SessionDay = { day: today, sec: Math.max(old?.sec ?? 0, Math.round(practiceSec)), set: !!old?.set || (!!plan && planDone(plan)), counted: false, pocket: !!old?.pocket }
  nd.counted = !!old?.counted || nd.set || nd.sec >= SESSION_MIN_SEC
  const min = plan?.min ?? old?.min
  if (min) nd.min = min
  const shape = plan?.shape ?? old?.shape
  if (shape) nd.shape = shape
  if (old?.pain) nd.pain = old.pain
  // The goal this week is judged by, kept with the day so a later change of goal never rewrites past weeks.
  const goal = old?.goal ?? (nd.counted ? (p.weekGoal ?? 3) : undefined)
  if (goal !== undefined) nd.goal = goal
  if (old && JSON.stringify(old) === JSON.stringify(nd)) return { progress: p, changed: false, counted: nd.counted, weekMet: false }
  let next = upsertDay(p, today, () => nd)
  let weekMet = false
  if (nd.counted && !old?.counted) {
    const ws = weekStatus(next, now)
    const wk = weekKey(today)
    if (ws.done >= ws.goal && !(next.weekXp ?? []).includes(wk)) {
      weekMet = true
      next = { ...next, weekXp: [...(next.weekXp ?? []), wk].slice(-20) }
    }
  }
  return { progress: next, changed: true, counted: nd.counted, weekMet }
}

/** Today's plan was started: some step is done, or its block is running. */
export function planStarted(p: Progress, now: Date): boolean {
  return !!todayPlan(p, now)?.steps.some((s) => s.state === 'done' || stepStarted(s))
}

/** A new session length. Today's plan is dropped (the home screen remakes it) unless a step of it is done already. */
export function withSessionMin(p: Progress, min: SessionMin, now: Date): Progress {
  if (p.sessionMin === min) return p
  const plan = todayPlan(p, now)
  return { ...p, sessionMin: min, plan: plan && !planStarted(p, now) ? null : p.plan }
}

/** A pocket session was played today (it never makes the day count). */
export function markPocket(p: Progress, now: Date): Progress {
  return upsertDay(p, dayKey(now), (d) => ({ ...d, pocket: true }))
}

/** The hand-health check-in for today. */
export function setPain(p: Progress, now: Date, pain: PainLevel): Progress {
  return upsertDay(p, dayKey(now), (d) => ({ ...d, pain }))
}

/** Pain flagged on the last counted session before today, if any. */
export function lastPain(p: Progress, now: Date): PainLevel | null {
  const today = dayKey(now)
  const prev = counted(p).filter((d) => d.day < today)
  return prev[prev.length - 1]?.pain ?? null
}

/** Today's session day, if any. */
export function todayDay(p: Progress, now: Date): SessionDay | null {
  const today = dayKey(now)
  return (p.sessions?.log ?? []).find((d) => d.day === today) ?? null
}

/** The pocket card opens by itself when the week goal is met or yesterday was a session. */
export function pocketOpen(p: Progress, now: Date): boolean {
  if (weekStatus(p, now).done >= (p.weekGoal ?? 3)) return true
  const y = dayKey(new Date(now.getTime() - 86400000))
  return counted(p).some((d) => d.day === y)
}
