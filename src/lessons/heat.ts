// Mistake heat map: judged results from every run, folded into small decaying counts per note, chord and lesson type.
// Lives in progress.heat (synced with lessons-progress). Must not import progress.ts or plan.ts.
import type { Chart, Heat, HeatCell, JudgeResult, Lesson, Progress } from './types'
import { STANDARD_TUNING, noteName, pc } from '../music/theory'

export const HEAT_DAYS = 60
export const HALF_LIFE_DAYS = 20
export const MAX_CELLS = 140
export const TIMING_MS = 35 // early / late threshold
export const READY_EVENTS = 40 // judged note + chord events before the map and the drill warm-up show
const MIN_TRIES = 6 // note and chord cells
const MIN_TIMED = 12 // timing cells
const LEAN_MS = 25 // timing cell: mean lean that counts as a tendency
const STRING_NAME = ['low E', 'A', 'D', 'G', 'B', 'high E']

const KEY_RE = /^(n:[0-5]\.\d{1,2}|c:[^\s]{1,16}|t:(notes|chords|rhythm))$/
const NOTE_RE = /^n:([0-5])\.(\d{1,2})$/
const TIMING_KIND: Record<string, string> = { notes: 'note', chords: 'chord', rhythm: 'rhythm' }

type TimedType = 'notes' | 'chords' | 'rhythm'
const TIMED: TimedType[] = ['notes', 'chords', 'rhythm']

/** The practice day (local date of d − 4 h, as progress.ts dayKey) as whole days since 1970. */
export function dayNum(d: Date): number {
  const s = new Date(d.getTime() - 4 * 3600000)
  return Math.floor(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()) / 86400000)
}

const r2 = (x: number) => Math.round(x * 100) / 100
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Keeps the `max` cells with the most events (by `weight`, default the stored count). */
function cap(cells: Record<string, HeatCell>, max: number, weight: (k: string) => number = (k) => cells[k].n): Record<string, HeatCell> {
  const keys = Object.keys(cells)
  if (keys.length <= max) return cells
  const out: Record<string, HeatCell> = {}
  for (const k of keys.sort((a, b) => weight(b) - weight(a)).slice(0, max)) out[k] = cells[k]
  return out
}

/** A checked copy of stored heat; undefined when it isn't heat at all. */
export function normalizeHeat(raw: unknown): Heat | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const cells = o.cells
  if (o.v !== 1 || !cells || typeof cells !== 'object' || Array.isArray(cells)) return undefined
  const out: Record<string, HeatCell> = {}
  for (const [k, v] of Object.entries(cells as Record<string, unknown>)) {
    if (!KEY_RE.test(k) || !v || typeof v !== 'object') continue
    const c = v as Record<string, unknown>
    const counts = [c.n, c.bad, c.wrong, c.early, c.late]
    // err is a signed sum (rushing is negative), the counts are not.
    if (!counts.every((x) => fin(x) && x >= 0) || !fin(c.err) || !fin(c.d) || typeof c.l !== 'string') continue
    const n = c.n as number
    const bad = Math.min(n, c.bad as number)
    out[k] = { n, bad, wrong: Math.min(bad, c.wrong as number), early: c.early as number, late: c.late as number, err: c.err, d: c.d, l: c.l }
  }
  return { v: 1, cells: cap(out, MAX_CELLS) }
}

/** Every cell decayed to today; old and faded cells are dropped. */
export function decayed(heat: Heat | undefined, now: Date): Record<string, HeatCell> {
  const today = dayNum(now)
  const out: Record<string, HeatCell> = {}
  if (!heat) return out
  for (const [k, c] of Object.entries(heat.cells)) {
    const age = Math.max(0, today - c.d)
    if (age > HEAT_DAYS) continue
    const f = 0.5 ** (age / HALF_LIFE_DAYS)
    const n = c.n * f
    if (n < 0.3) continue
    out[k] = { n, bad: c.bad * f, wrong: c.wrong * f, early: c.early * f, late: c.late * f, err: c.err * f, d: today, l: c.l }
  }
  return out
}

const emptyCell = (d: number, l: string): HeatCell => ({ n: 0, bad: 0, wrong: 0, early: 0, late: 0, err: 0, d, l })

/**
 * Progress with this run's judged events added to the heat. Sync and improv runs add nothing.
 * Only the cells this run touches are faded and re-dated; the rest keep their stored counts and day,
 * so an account merge (later day wins per cell) keeps each spot from the device that played it last.
 * `loop`: a loop or drill, which repeats one or two spots over and over.
 */
export function recordHeat(p: Progress, lesson: Lesson, chart: Chart, results: JudgeResult[], o: { sourceId: string; calibrated: boolean; now: Date; loop?: boolean }): Progress {
  if (lesson.type === 'improv' || lesson.type === 'sync') return p
  const today = dayNum(o.now)
  const live = decayed(p.heat, o.now) // also drops cells too old or faded to keep
  const stored = p.heat?.cells ?? {}
  const cells: Record<string, HeatCell> = {}
  for (const k of Object.keys(live)) cells[k] = { ...stored[k] }
  const touched = new Set<string>()
  const byId = new Map(chart.events.map((e) => [e.id, e]))
  const graded = results.filter((r) => r.errMs !== null && r.verdict !== 'wrong')
  // Note and chord cells lean against the run's own average, so a steady offset doesn't paint every spot.
  // A loop's own average is mostly the looped spot itself, so it leans against the player's usual lean
  // instead (0 when there's none yet); without a calibration its spots get no early or late counts.
  const usual = live[`t:${lesson.type}`]
  let ref: number | null = 0
  if (o.loop) ref = !o.calibrated ? null : usual && usual.n >= MIN_TIMED ? usual.err / usual.n : 0
  else if (graded.length >= 4) ref = graded.reduce((a, r) => a + (r.errMs ?? 0), 0) / graded.length
  const cell = (k: string) => {
    if (!touched.has(k)) {
      touched.add(k)
      const c = live[k]
      cells[k] = c ? { ...c, d: today } : emptyCell(today, o.sourceId)
    }
    const c = cells[k]
    c.l = o.sourceId
    return c
  }

  for (const r of results) {
    const ev = byId.get(r.eventId)
    if (!ev || (ev.kind !== 'note' && ev.kind !== 'chord')) continue
    const k = ev.kind === 'note' ? `n:${ev.string}.${ev.fret}` : `c:${ev.symbol}`
    if (!KEY_RE.test(k)) continue
    const c = cell(k)
    const rang = ev.kind === 'chord' && r.chordOk === false
    c.n += 1
    if (r.verdict === 'miss' || r.verdict === 'wrong' || rang) c.bad += 1
    if (r.verdict === 'wrong' || (rang && r.verdict !== 'miss')) c.wrong += 1
    if (ref !== null && r.errMs !== null && r.verdict !== 'wrong') {
      const rel = r.errMs - ref
      if (rel < -TIMING_MS) c.early += 1
      if (rel > TIMING_MS) c.late += 1
    }
  }

  // Timing per lesson type only means something with a saved latency calibration.
  if (o.calibrated && graded.length) {
    const c = cell(`t:${lesson.type}`)
    for (const r of graded) {
      const e = r.errMs ?? 0
      c.n += 1
      c.err += e
      if (e < -TIMING_MS) c.early += 1
      if (e > TIMING_MS) c.late += 1
    }
  }

  const out: Record<string, HeatCell> = {}
  // Rank by today's faded count, not the stored one (untouched cells are stored as of their own day).
  const weight = (k: string) => (touched.has(k) ? cells[k].n : (live[k]?.n ?? 0))
  for (const [k, c] of Object.entries(cap(cells, MAX_CELLS, weight))) {
    out[k] = { n: r2(c.n), bad: r2(c.bad), wrong: r2(c.wrong), early: r2(c.early), late: r2(c.late), err: r2(c.err), d: c.d, l: c.l }
  }
  return { ...p, heat: { v: 1, cells: out } }
}

/** Judged note and chord events in the window (decayed). */
export function heatEvents(heat: Heat | undefined, now: Date): number {
  let n = 0
  for (const [k, c] of Object.entries(decayed(heat, now))) if (!k.startsWith('t:')) n += c.n
  return n
}

/** Enough data for the map and the drill warm-up. */
export function heatReady(heat: Heat | undefined, now: Date): boolean {
  return heatEvents(heat, now) >= READY_EVENTS
}

/** 'G string fret 7', 'low E string, open', 'C chord', 'rhythm timing'. */
export function spotLabel(key: string): string {
  const m = NOTE_RE.exec(key)
  if (m) {
    const s = STRING_NAME[Number(m[1])]
    const f = Number(m[2])
    return f === 0 ? `${s} string, open` : `${s} string fret ${f}`
  }
  if (key.startsWith('c:')) return `${key.slice(2)} chord`
  if (key.startsWith('t:')) return `${TIMING_KIND[key.slice(2)] ?? key.slice(2)} timing`
  return key
}

export function drillTitle(key: string): string {
  return `Drill: ${spotLabel(key)}`
}

export type SpotProblem = 'wrong' | 'miss' | 'early' | 'late' | 'muddy'
export interface Spot {
  key: string
  kind: 'note' | 'chord' | 'timing'
  problem: SpotProblem
  score: number // ranking, 0–1
  n: number // tries, rounded
  rate: number // share of tries with this problem
  meanMs: number | null // timing cells: mean lean (+ = late)
  lessonId: string
  text: string // the plain explanation
  advice: string
}

/** The note's name for a note key ('D'), or null. */
function keyNote(key: string): string | null {
  const m = NOTE_RE.exec(key)
  return m ? noteName(STANDARD_TUNING[Number(m[1])] + Number(m[2])) : null
}

/** The explanation and the advice for a spot. `ms` = the timing lean, when known. */
export function spotCopy(key: string, problem: SpotProblem, ms: number | null = null): { text: string; advice: string } {
  const early = { advice: 'Let the note reach the line. Wait for the click.' }
  const late = { advice: 'Get your finger there a beat ahead.' }
  if (key.startsWith('t:')) {
    const kind = TIMING_KIND[key.slice(2)] ?? 'these'
    const about = ms === null ? '' : `, about ${Math.round(Math.abs(ms))} ms ${problem === 'late' ? 'late' : 'early'}`
    return problem === 'late'
      ? { text: `In ${kind} lessons you tend to drag${about}.`, advice: 'Re-sync if it feels off, then lean on the beat.' }
      : { text: `In ${kind} lessons you tend to rush${about}.`, advice: 'Re-sync if it feels off, then play with the click, not ahead of it.' }
  }
  if (key.startsWith('c:')) {
    const sym = key.slice(2)
    if (problem === 'muddy' || problem === 'wrong') return { text: `The ${sym} chord often doesn't ring clean.`, advice: 'Press each string just behind the fret, then check every string rings.' }
    if (problem === 'miss') return { text: `You often miss the ${sym} chord.`, advice: 'Move to the shape a beat early.' }
    return problem === 'early' ? { text: `You often strum ${sym} early.`, ...early } : { text: `You often strum ${sym} late.`, ...late }
  }
  const name = keyNote(key)
  const s = `${spotLabel(key)}${name ? ` (${name})` : ''}`
  if (problem === 'wrong' || problem === 'muddy') return { text: `You often play the wrong note at ${s}.`, advice: 'Look at the fret number before you pick.' }
  if (problem === 'miss') return { text: `Notes at ${s} often don't come through.`, advice: 'Pick a little firmer and press right behind the fret.' }
  return problem === 'early' ? { text: `You often play ${s} early.`, ...early } : { text: `You often play ${s} late.`, ...late }
}

/** What this cell says about the player, or null when it's too thin or too clean to mention. */
export function spotFor(key: string, c: HeatCell): Spot | null {
  if (key.startsWith('t:')) {
    if (c.n < MIN_TIMED) return null
    const mean = c.err / c.n
    if (Math.abs(mean) < LEAN_MS) return null
    const problem: SpotProblem = mean < 0 ? 'early' : 'late'
    const score = (Math.min(0.6, Math.abs(mean) / 150) * c.n) / (c.n + 10)
    const rate = (problem === 'early' ? c.early : c.late) / c.n
    return { key, kind: 'timing', problem, score, n: Math.round(c.n), rate, meanMs: mean, lessonId: c.l, ...spotCopy(key, problem, mean) }
  }
  if (c.n < MIN_TRIES) return null
  const chord = key.startsWith('c:')
  const counts: [SpotProblem, number][] = [
    [chord ? 'muddy' : 'wrong', c.wrong],
    ['miss', Math.max(0, c.bad - c.wrong)],
    ['early', c.early],
    ['late', c.late],
  ]
  let best = counts[0]
  for (const x of counts) if (x[1] > best[1]) best = x
  const score = best[1] / (c.n + 4)
  if (score < 0.15) return null
  return { key, kind: chord ? 'chord' : 'note', problem: best[0], score, n: Math.round(c.n), rate: best[1] / c.n, meanMs: null, lessonId: c.l, ...spotCopy(key, best[0]) }
}

/** The worst spots, worst first. */
export function topSpots(heat: Heat | undefined, now: Date, max = 5): Spot[] {
  const spots: Spot[] = []
  for (const [k, c] of Object.entries(decayed(heat, now))) {
    const s = spotFor(k, c)
    if (s) spots.push(s)
  }
  return spots.sort((a, b) => b.score - a.score || b.n - a.n).slice(0, max)
}

// ---- Map helpers (take decayed() cells) ------------------------------------------------

/** One entry per fretboard spot with at least 2 tries; heat 0–1. */
export function noteCells(cells: Record<string, HeatCell>): { string: number; fret: number; n: number; heat: number }[] {
  const out: { string: number; fret: number; n: number; heat: number }[] = []
  for (const [k, c] of Object.entries(cells)) {
    const m = NOTE_RE.exec(k)
    if (!m || c.n < 2) continue
    // Shrunk toward clean like spotFor's score: one slip in two tries isn't "many slips".
    out.push({ string: Number(m[1]), fret: Number(m[2]), n: c.n, heat: Math.min(1, (c.bad + 0.5 * Math.max(c.early, c.late)) / (c.n + 4)) })
  }
  return out
}

/** The 12 note names, C first, with the share of slips over every spot that plays them. */
export function noteNameRows(cells: Record<string, HeatCell>): { pc: number; name: string; n: number; rate: number }[] {
  const n = new Array<number>(12).fill(0)
  const bad = new Array<number>(12).fill(0)
  for (const [k, c] of Object.entries(cells)) {
    const m = NOTE_RE.exec(k)
    if (!m) continue
    const p = pc(STANDARD_TUNING[Number(m[1])] + Number(m[2]))
    n[p] += c.n
    bad[p] += c.bad
  }
  return n.map((x, i) => ({ pc: i, name: noteName(i), n: x, rate: x > 0 ? bad[i] / x : 0 }))
}

/** Chords with at least 3 tries, most slips first. */
export function chordRows(cells: Record<string, HeatCell>): { symbol: string; n: number; rate: number }[] {
  return Object.entries(cells)
    .filter(([k, c]) => k.startsWith('c:') && c.n >= 3)
    .map(([k, c]) => ({ symbol: k.slice(2), n: c.n, rate: c.bad / c.n }))
    .sort((a, b) => b.rate - a.rate || b.n - a.n)
}

/** Mean timing lean per lesson type (+ = late); null until there are enough timed hits. */
export function timingRows(cells: Record<string, HeatCell>): { type: TimedType; n: number; meanMs: number | null }[] {
  return TIMED.map((type) => {
    const c = cells[`t:${type}`]
    const n = c?.n ?? 0
    return { type, n, meanMs: c && n >= MIN_TIMED ? c.err / n : null }
  })
}

export function heatBucket(h: number): 0 | 1 | 2 | 3 {
  return h < 0.1 ? 0 : h < 0.25 ? 1 : h < 0.45 ? 2 : 3
}
