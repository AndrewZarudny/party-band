// Chain and points during a run, and the final score, stars and coach tip. Pure.
import type { Chart, ImprovReport, JudgeResult, JudgeSummary, Lesson, LessonResult, NoteEv, Speed, Stars, SyncOutcome, Verdict } from './types'
import { improvScore } from './improv'

const ROAR_CHAIN = 16
const ROAR_MULT = 1.5
const MILESTONES: [number, string][] = [
  [8, 'Hot!'],
  [16, 'Roar!'],
  [32, 'Rolling!'],
  [64, 'Unstoppable!'],
]
const COACH_MS = 40
const COACH_MIN_GRADED = 12
const CLEAN_MIN_EVENTS = 8

export const VERDICT_LABEL: Record<Verdict, string> = {
  perfect: 'Nailed it!',
  good: 'Good',
  early: 'Early',
  late: 'Late',
  miss: 'Missed',
  wrong: 'Wrong note',
  'clean-stop': 'Clean stop',
  ringing: 'Still ringing',
}

export function emptyCounts(): Record<Verdict, number> {
  return { perfect: 0, good: 0, early: 0, late: 0, miss: 0, wrong: 0, 'clean-stop': 0, ringing: 0 }
}

export class ChainMeter {
  chain = 0
  best = 0
  roar = false
  roarMs = 0
  points = 0
  perfectRun = 0
  private run = 0
  private roarFrom = 0
  private hit = new Set<number>()

  push(r: JudgeResult, t: number): string | null {
    const v = r.verdict
    if (v === 'perfect' || v === 'good' || v === 'clean-stop') this.chain++
    else if (v === 'miss' || v === 'wrong' || v === 'ringing') this.chain = 0
    this.best = Math.max(this.best, this.chain)
    const roar = this.chain >= ROAR_CHAIN
    if (roar && !this.roar) this.roarFrom = t
    if (!roar && this.roar) this.roarMs += Math.max(0, t - this.roarFrom) * 1000
    this.roar = roar
    this.points += Math.round(r.credit * 100 * (roar ? ROAR_MULT : 1))
    // Rests neither extend nor break a run of perfects.
    if (v === 'perfect') this.run++
    else if (v !== 'clean-stop') this.run = 0
    this.perfectRun = Math.max(this.perfectRun, this.run)
    for (const [n, word] of MILESTONES) {
      if (this.chain === n && !this.hit.has(n)) {
        this.hit.add(n)
        return word
      }
    }
    return null
  }

  end(t: number) {
    if (this.roar) this.roarMs += Math.max(0, t - this.roarFrom) * 1000
    this.roar = false
  }
}

/** Good enough for a clean loop pass: perfect, good or a clean stop, with no failed chord or technique check. */
export function goodOrBetter(r: JudgeResult): boolean {
  const v = r.verdict
  return (v === 'perfect' || v === 'good' || v === 'clean-stop') && r.chordOk !== false && r.techOk !== false
}

/** Per bar: share of the bar's events played good or better; null for a bar with nothing to play. */
export function barAccuracy(chart: Chart, results: JudgeResult[]): (number | null)[] {
  const good = new Array<number>(chart.bars).fill(0)
  const all = new Array<number>(chart.bars).fill(0)
  const byId = new Map(chart.events.map((e) => [e.id, e]))
  for (const r of results) {
    const ev = byId.get(r.eventId)
    if (!ev) continue
    const bar = Math.min(chart.bars - 1, Math.floor(ev.beat / 4))
    all[bar]++
    if (goodOrBetter(r)) good[bar]++
  }
  return all.map((n, i) => (n ? good[i] / n : null))
}

export function noteScore(lesson: Lesson, s: JudgeSummary): number {
  const n = s.results.length
  const raw = n ? (100 * s.results.reduce((a, r) => a + r.credit, 0)) / n : 0
  const pen = (lesson.timing !== 'easy' ? Math.min(10, s.extras) : 0) + Math.min(10, 2 * s.listenViolations)
  return Math.max(0, Math.min(100, Math.round(raw - pen)))
}

export function starsFor(lesson: Lesson, score: number, passed: boolean, speed: Speed, extraMet: boolean): Stars {
  let n = passed ? lesson.stars.filter((s) => score >= s).length : 0
  if (n === 3 && !extraMet) n = 2
  if (speed < 1) n = Math.min(n, 2)
  return n as Stars
}

/** Whether the lesson's 3rd-star extra (palm mutes, legato, glides) was met. */
function extraMet(lesson: Lesson, chart: Chart, results: JudgeResult[]): boolean {
  const x = lesson.starExtra
  if (!x) return true
  const byId = new Map(results.map((r) => [r.eventId, r]))
  const notes = chart.events.filter((e): e is NoteEv => e.kind === 'note')
  let rel: NoteEv[]
  let good: (r: JudgeResult) => boolean
  if (x.kind === 'palmMute') {
    rel = notes.filter((e) => e.tech === 'pm')
    good = (r) => r.pmOk === true
  } else if (x.kind === 'legato') {
    rel = notes.filter((e) => e.tech === 'hammer' || e.tech === 'pull')
    good = (r) => r.legato === true
  } else {
    rel = notes.filter((e) => e.tech === 'slide')
    good = (r) => r.legato === true
  }
  if (!rel.length) return true
  const ok = rel.filter((e) => {
    const r = byId.get(e.id)
    return !!r && good(r)
  }).length
  return ok / rel.length >= x.share
}

function coachTip(counts: Record<Verdict, number>, mean: number | null, graded: number): string {
  if (mean !== null && mean > COACH_MS && graded >= COACH_MIN_GRADED) return `You're about ${Math.round(mean)} ms late on average. Re-sync, or pick a touch earlier.`
  if (mean !== null && mean < -COACH_MS) return `You're about ${Math.round(-mean)} ms early on average. Relax and let the click lead.`
  if (counts.wrong >= 3) return 'Lots of wrong notes. Check the fret numbers, or try Slower.'
  if (counts.ringing >= 2) return 'Notes kept ringing in the rests. Touch the strings to stop them.'
  if (counts.miss >= 3) return "Some notes didn't reach me. Pick a little harder."
  return 'Nice run.'
}

export function buildResult(a: {
  lesson: Lesson
  chart: Chart
  summary: JudgeSummary | null
  improv: ImprovReport | null
  chain: ChainMeter
  bpm: number
  speed: Speed
  easyTiming: boolean
  secPerBeat: number
  playedSec: number
  calibrated?: boolean
}): LessonResult {
  const { lesson, chart, summary, improv, chain } = a
  const counts = emptyCounts()
  const results = summary?.results ?? []
  for (const r of results) counts[r.verdict]++

  let score = 0
  let extra = true
  if (lesson.type === 'improv' && lesson.improv && improv) score = improvScore(lesson.improv, improv)
  else if (summary) {
    score = noteScore(lesson, summary)
    extra = extraMet(lesson, chart, results)
  }
  const passed = score >= lesson.pass

  const errs = results.filter((r) => r.errMs !== null).map((r) => r.errMs!)
  let meanErrMs: number | null = null
  let spreadMs: number | null = null
  if (errs.length >= 4) {
    const mean = errs.reduce((s, e) => s + e, 0) / errs.length
    meanErrMs = Math.round(mean)
    spreadMs = Math.round(Math.sqrt(errs.reduce((s, e) => s + (e - mean) * (e - mean), 0) / errs.length))
  }

  const byId = new Map(chart.events.map((e) => [e.id, e]))
  const perBar = new Map<number, number>()
  let bendsInTune = 0
  for (const r of results) {
    const ev = byId.get(r.eventId)
    if (!ev) continue
    if (r.verdict === 'miss' || r.verdict === 'wrong') {
      const bar = Math.floor(ev.beat / 4)
      perBar.set(bar, (perBar.get(bar) ?? 0) + 1)
    }
    if (ev.kind === 'note' && ev.tech === 'bend' && r.techOk === true) bendsInTune++
  }
  let hardestBar: number | null = null
  let most = 0
  for (const [bar, n] of perBar) {
    if (n > most) {
      most = n
      hardestBar = bar
    }
  }

  const clean = results.length >= CLEAN_MIN_EVENTS && counts.miss === 0 && counts.wrong === 0 && counts.ringing === 0
  const tip = improv ? (improv.tips[0] ?? 'Nice run.') : coachTip(counts, meanErrMs, errs.length)

  return {
    lessonId: lesson.id,
    at: Date.now(),
    bpm: a.bpm,
    speed: a.speed,
    easyTiming: a.easyTiming,
    score,
    stars: starsFor(lesson, score, passed, a.speed, extra),
    passed,
    playedSec: a.playedSec,
    counts,
    extras: summary?.extras ?? 0,
    bestChain: chain.best,
    roarMs: Math.round(chain.roarMs),
    perfectRun: chain.perfectRun,
    points: chain.points,
    clean,
    meanErrMs,
    meanAbsErrMs: errs.length >= 4 ? Math.round(errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length) : null,
    spreadMs,
    calibrated: a.calibrated ?? false,
    improv: improv ?? undefined,
    coachTip: tip,
    hardestBar,
    bendsInTune,
    barAcc: summary ? barAccuracy(chart, results) : undefined,
    results: summary ? results : undefined,
  }
}

export function syncResult(lesson: Lesson, outcome: SyncOutcome): LessonResult {
  return {
    lessonId: lesson.id,
    at: Date.now(),
    bpm: 80,
    speed: 1,
    easyTiming: false,
    score: Math.round((100 * outcome.captured) / 8),
    stars: outcome.stars,
    passed: outcome.captured >= 4,
    playedSec: 6,
    counts: emptyCounts(),
    extras: 0,
    bestChain: 0,
    roarMs: 0,
    perfectRun: 0,
    points: 0,
    clean: false,
    meanErrMs: null,
    meanAbsErrMs: null,
    spreadMs: null,
    coachTip: outcome.message,
    hardestBar: null,
    bendsInTune: 0,
  }
}
