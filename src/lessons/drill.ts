// Trouble-spot drills: a generated 2-bar lesson from one heat cell, played as a loop (LoopScreen).
import type { BackingSpec, ChordBar, Lesson, LoopSpec, Progress } from './types'
import type { SpotProblem } from './heat'
import { lessonById } from './data'
import { decayed, drillTitle, spotCopy, spotFor } from './heat'

export const DRILL_START = 0.85
const MAX_FRET = 15

const NOTE_RE = /^n:([0-5])\.(\d{1,2})$/

const drums = (chords: string[], feel: BackingSpec['feel'] = 'pop'): BackingSpec => ({ feel, chords, parts: { drums: true }, level: 0.5 })

/** The shape the source lesson teaches for a chord, if any. */
function fretsFor(source: Lesson | undefined, sym: string): number[] | undefined {
  return source?.chordBars?.find((b) => b.chord === sym && b.frets)?.frets ?? source?.shapes?.[sym]
}

/** The nearest other chord before `sym` in the source lesson, else the nearest after. */
function partnerOf(source: Lesson | undefined, sym: string): string | null {
  const bars = source?.chordBars ?? []
  const at = bars.findIndex((b) => b.chord === sym)
  if (at < 0) return null
  const ok = (b: ChordBar | undefined) => !!b && b.chord !== sym && b.chord !== 'mute'
  for (let i = at - 1; i >= 0; i--) if (ok(bars[i])) return bars[i].chord
  for (let i = at + 1; i < bars.length; i++) if (ok(bars[i])) return bars[i].chord
  return null
}

/** A 2-bar lesson aimed at one spot; null for a key it can't build. Not in LESSONS. */
export function drillLesson(key: string, problem: SpotProblem, source: Lesson | undefined): Lesson | null {
  const timingProblem = problem === 'early' || problem === 'late'
  const copy = spotCopy(key, problem)
  const base = {
    id: 'drill-' + key,
    world: source?.world ?? 1,
    order: 0,
    title: drillTitle(key),
    goal: copy.text,
    tips: [copy.advice],
    bars: 2,
    countInBeats: 4,
    tone: source?.tone ?? 'Clean',
    pass: 0,
    stars: [0, 0, 0],
    xp: 0,
    bpm: Math.max(60, Math.min(80, source?.bpm ?? 70)),
    timing: timingProblem ? (source?.timing ?? 'normal') : 'easy',
  } satisfies Partial<Lesson>

  const m = NOTE_RE.exec(key)
  if (m) {
    const s = Number(m[1])
    const f = Number(m[2])
    if (f > MAX_FRET) return null
    const t = `${s}.${f}`
    // A neighbour to move to and back: two frets down, or fret 3 above fret 1, or the next open string.
    const a = f >= 2 ? `${s}.${f - 2}` : f === 1 ? `${s}.3` : `${s < 5 ? s + 1 : s - 1}.0`
    const seq = timingProblem ? `${t} ${t} ${t} ${t} | ${t}*0.5 ${t}*0.5 ${t} ${t}*0.5 ${t}*0.5 ${t}` : `${t} ${a} ${t} ${a} | ${t} ${t} ${a} ${t}`
    return { ...base, type: 'notes', step: 1, seq, backing: drums(['E5']) }
  }

  if (key.startsWith('c:')) {
    const sym = key.slice(2)
    const frets = fretsFor(source, sym)
    if (frets?.some((x) => x > MAX_FRET)) return null
    const partner = partnerOf(source, sym)
    const pf = partner ? fretsFor(source, partner) : undefined
    const chordBars: ChordBar[] = timingProblem
      ? [
          { chord: sym, frets, strum: 'D_D_D_D_' },
          { chord: sym, frets, strum: 'D_D_DUDU' },
        ]
      : [{ chord: sym, frets, strum: 'D___D___', chroma: true }, partner ? { chord: partner, frets: pf, strum: 'D___D___' } : { chord: sym, frets, strum: 'D_D_D_D_' }]
    const lesson: Lesson = {
      ...base,
      type: timingProblem ? 'rhythm' : 'chords',
      chordBars,
      backing: drums([sym, partner ?? sym], source?.backing?.feel ?? 'pop'),
    }
    if (source?.shapes) lesson.shapes = source.shapes
    return lesson
  }

  if (key === 't:notes') {
    const seq = '1.0 1.0 1.0 1.0 | 1.0*0.5 1.0*0.5 1.0*0.5 1.0*0.5 1.0*0.5 1.0*0.5 1.0*0.5 1.0*0.5'
    return { ...base, type: 'notes', step: 1, seq, backing: drums(['E5']) }
  }
  if (key === 't:chords' || key === 't:rhythm') {
    const chordBars: ChordBar[] = [
      { chord: 'mute', strum: 'D_D_D_D_' },
      { chord: 'mute', strum: 'DUDUDUDU' },
    ]
    return { ...base, type: 'rhythm', chordBars, backing: drums(['E5']) }
  }
  return null
}

/** A loop for one trouble spot, or null when the spot's lesson is unknown or no drill fits. */
export function drillSpec(p: Progress, key: string, now: Date, fallbackLessonId?: string): LoopSpec | null {
  const cell = decayed(p.heat, now)[key]
  const sourceId = cell && lessonById(cell.l) ? cell.l : fallbackLessonId && lessonById(fallbackLessonId) ? fallbackLessonId : null
  if (!sourceId) return null
  const problem = (cell ? spotFor(key, cell)?.problem : undefined) ?? (key.startsWith('t:') ? 'early' : 'miss')
  const lesson = drillLesson(key, problem, lessonById(sourceId))
  if (!lesson) return null
  return { kind: 'drill', lesson, fromBar: 0, toBar: 1, startSpeed: DRILL_START, targetSpeed: 1, title: drillTitle(key), sourceId, drillKey: key }
}
