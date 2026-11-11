// The coach: a short note from Claude when the player opens Lessons and when a session is done.
// This file gathers the facts the note is written from (only numbers the app already has) and fetches the note.
// One note per practice day and moment is kept in this browser, so opening the screen again costs nothing.
import type { ApplyOutcome, Lesson, LessonResult, Progress, SessionPlan } from './types'
import { bpmAt } from './speed'
import type { SkillStats } from '../skills/data'
import { lessonById } from './data'
import { dayKey, nextLesson } from './progress'
import { strugglingList, weekStatus } from './review'
import { improvements, planDone, planPlayedSec, stepScore, stepTitle } from './session'
import { pace } from './weeks'

export type CoachMoment = 'open' | 'done'

export interface CoachNote {
  message: string
  next: string
}

const KEY = 'coach-notes'
const title = (id: string) => lessonById(id)?.title ?? id

/** What the coach is told: plain facts from the saved progress, nothing guessed. */
export function coachFacts(p: Progress, stats: SkillStats, now: Date, moment: CoachMoment, o: { name: string | null; todaySec: number; goalMin: number }) {
  const pc = pace(p, stats, now)
  const ws = weekStatus(p, now)
  const plan: SessionPlan | null = p.plan && p.plan.day === dayKey(now) ? p.plan : null
  const recent = (p.runs ?? []).slice(-12)
  const timed = recent.filter((r) => r.mean !== null && r.n >= 6)
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  const next = nextLesson(p)
  return {
    moment: moment === 'open' ? 'the player just opened the app, before practising' : 'the player just finished today\'s session',
    player: o.name,
    dino: p.dinoName,
    plan12Weeks: { headline: pc.headline, state: pc.state, advice: pc.advice.slice(0, 2) },
    week: { sessionsDone: ws.done, sessionGoal: ws.goal, weekStreak: ws.streak },
    daysSinceLastPractice: plan?.away ?? null,
    today: {
      minutesPlayed: Math.floor(o.todaySec / 60),
      minutesGoal: o.goalMin,
      sessionDone: !!plan && planDone(plan),
      sessionMinutesPlayed: plan ? Math.floor(planPlayedSec(plan) / 60) : 0,
      blocks: (plan?.steps ?? []).map((s) => {
        const sc = stepScore(p, s)
        return { kind: s.kind, what: stepTitle(s), state: s.state, minutes: s.min, scorePercent: sc ? Math.round(sc.value) : null, firstTryFromCold: sc?.label === 'cold' }
      }),
      whatGotBetter: plan ? improvements(p, plan) : [],
    },
    notStickingYet: strugglingList(p).slice(0, 5).map(title),
    nextNewLesson: next ? title(next) : null,
    lessonsPassed: Object.values(p.lessons).filter((r) => r.passedAt !== undefined).length,
    lessonsLearnedFromCold: Object.values(p.lessons).filter((r) => r.review?.learned).length,
    recentTiming: timed.length ? { averageMsLateIsPositive: avg(timed.map((r) => r.mean as number)), spreadMs: avg(timed.filter((r) => r.spread !== null).map((r) => r.spread as number)), runs: timed.length } : null,
    lastHandPain: [...(p.sessions?.log ?? [])].reverse().find((d) => d.pain)?.pain ?? null,
  }
}

/** What the coach is told after one run: the numbers on the result card, nothing guessed. */
export function runFacts(lesson: Lesson, r: LessonResult, o: ApplyOutcome, x: { name: string | null; block: { timeLeft: boolean; nextButton: string } | null }) {
  const p = o.progress
  const rec = p.lessons[lesson.id]
  const counts = Object.fromEntries(Object.entries(r.counts).filter(([, n]) => n > 0))
  return {
    moment: 'the player just finished one run of a lesson and is looking at its result',
    player: x.name,
    dino: p.dinoName,
    run: {
      lesson: lesson.title,
      kind: lesson.type,
      scorePercent: r.score,
      passMarkPercent: lesson.pass,
      passed: r.passed,
      starsOf3: r.stars,
      bpm: r.bpm,
      percentOfFullTempo: Math.round(r.speed * 100),
      secondsPlayed: Math.round(r.playedSec),
      notes: counts,
      timing: r.meanErrMs === null ? null : { averageMsLateIsPositive: Math.round(r.meanErrMs), spreadMs: r.spreadMs },
      hardestBar: r.hardestBar === null ? null : r.hardestBar + 1,
      chords: r.chordStats ? { rangTrue: r.chordStats.ok, soundedOff: r.chordStats.wrong, unclear: r.chordStats.unsure } : null,
      bendCentsOff: r.bendCents ?? null,
      jam: r.improv ? { scoresOutOf100: Object.fromEntries(Object.entries(r.improv.metrics).map(([k, v]) => [k, Math.round(v ?? 0)])), tips: r.improv.tips } : null,
      firstTryFromColdToday: o.cold ? { clean: o.cold.clean, bpm: o.cold.bpm } : null,
    },
    thisLessonSoFar: rec ? { runs: rec.plays, bestScorePercent: rec.best } : null,
    whatGotBetter: o.competence,
    nextTimeBpm: o.speed ? bpmAt(lesson, o.speed.next) : null,
    newlyOpened: o.unlocked.map(title),
    sessionBlock: x.block,
    lastHandPain: [...(p.sessions?.log ?? [])].reverse().find((d) => d.pain)?.pain ?? null,
  }
}

/** One key per run. */
export function runKey(r: LessonResult): string {
  return `${dayKey(new Date(r.at))}:run:${r.at}`
}

function read(): Record<string, CoachNote> {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, CoachNote>) ?? {}
  } catch {
    return {}
  }
}

/** The note kept for this day and moment, if any. */
export function savedCoach(key: string): CoachNote | null {
  const n = read()[key]
  return n && typeof n.message === 'string' ? n : null
}

/** One key per practice day and moment (the done note also by how much of the session was played). */
export function coachKey(p: Progress, now: Date, moment: CoachMoment): string {
  const plan = p.plan && p.plan.day === dayKey(now) ? p.plan : null
  return `${dayKey(now)}:${moment}:${moment === 'done' && plan ? plan.steps.filter((s) => s.state === 'done').length : 0}`
}

/** Asks the local server for a note. { off } with the reason when the coach can't run here (not signed in); null when the call fails (the app then shows none). */
export async function fetchCoach(key: string, facts: unknown): Promise<CoachNote | { off: string } | null> {
  try {
    const res = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts }) })
    // 503: no Anthropic API key on the server, so the coach is switched off.
    if (res.status === 503) {
      const why = ((await res.json().catch(() => ({}))) as { error?: unknown }).error
      return { off: typeof why === 'string' ? why : 'The coach is switched off on this computer.' }
    }
    if (!res.ok) return null
    const note = (await res.json()) as Partial<CoachNote>
    if (typeof note.message !== 'string' || !note.message.trim()) return null
    const out: CoachNote = { message: note.message.trim(), next: typeof note.next === 'string' ? note.next.trim() : '' }
    try {
      // Today's notes only: older days are dropped.
      const day = key.slice(0, 10)
      const kept = Object.fromEntries(Object.entries(read()).filter(([k]) => k.startsWith(day)))
      localStorage.setItem(KEY, JSON.stringify({ ...kept, [key]: out }))
    } catch {
      /* storage unavailable: the note still shows */
    }
    return out
  } catch {
    return null
  }
}
