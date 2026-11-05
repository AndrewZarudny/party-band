// Small builders for lesson tests. Not a test file itself.
import type { Chart, ChartEvent, ChordEv, InputFrame, InputOnset, JudgeResult, Lesson, LessonRecord, LessonResult, NoteEv, Verdict } from '../types'
import { STANDARD_TUNING } from '../../music/theory'
import { emptyCounts } from '../scoring'

export function lesson(over: Partial<Lesson> = {}): Lesson {
  return { id: 'test', world: 1, order: 1, title: 'Test', goal: 'Test', tips: [], type: 'notes', bpm: 60, bars: 2, timing: 'normal', tone: 'Clean', pass: 60, stars: [60, 80, 95], xp: 40, ...over }
}

export function result(over: Partial<LessonResult> = {}): LessonResult {
  return {
    lessonId: 'w1-02',
    at: 0,
    bpm: 60,
    speed: 1,
    easyTiming: false,
    score: 80,
    stars: 2,
    passed: true,
    playedSec: 30,
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
    coachTip: '',
    hardestBar: null,
    bendsInTune: 0,
    ...over,
  }
}

export function rec(over: Partial<LessonRecord> = {}): LessonRecord {
  return { best: 0, stars: 0, plays: 0, fails: 0, bestChain: 0, clean: false, playsDay: '', playsToday: 0, lastPlayed: 0, ...over }
}

export function note(id: number, beat: number, string: number, fret: number, over: Partial<NoteEv> = {}): NoteEv {
  return { id, kind: 'note', beat, dur: 1, string, fret, midi: STANDARD_TUNING[string] + fret, ...over }
}

export function chord(id: number, beat: number, symbol: string, pcs: number[], over: Partial<ChordEv> = {}): ChordEv {
  return { id, kind: 'chord', beat, dur: 1, symbol, frets: [-1, 3, 2, 0, 1, 0], pcs, power: false, chroma: false, ...over }
}

export function chartOf(events: ChartEvent[], bars = 2): Chart {
  return {
    lessonId: 'test',
    bars,
    totalBeats: bars * 4,
    events,
    calls: [],
    listenBars: [],
    chordTimeline: Array.from({ length: bars }, (_, i) => ({ beat: 4 * i, symbol: '' })),
    minGapBeats: 1,
  }
}

export function onset(t: number, midi: number | null, source: InputOnset['source'] = 'key'): InputOnset {
  return { t, raw: t, midi, source, peak: 0.1, strength: null }
}

/** Frames every 10 ms from t, `n` of them, all showing `midi`. */
export function frames(t: number, n: number, midi: number | null, rms = 0.05): InputFrame[] {
  return Array.from({ length: n }, (_, i) => ({ t: t + i * 0.01, rms, midi, midiF: midi }))
}

export function jr(eventId: number, kind: ChartEvent['kind'], verdict: Verdict, errMs: number | null, over: Partial<JudgeResult> = {}): JudgeResult {
  const good = verdict === 'perfect' || verdict === 'good' || verdict === 'clean-stop'
  return { eventId, kind, verdict, grade: good ? 'good' : verdict === 'miss' ? 'miss' : 'ok', errMs, pitchOk: verdict !== 'wrong', credit: good ? 1 : 0, ...over }
}

/** A fixed local noon, so day keys never flip on the 4 am practice-day line. */
export const at = (day: string) => new Date(day + 'T12:00:00')

/**
 * The player's own save from the old world map (no mapV): World 1 done, Spark Show 2 stars, World 2 partly done,
 * Downstroke Lock passed with 1 star, the boogie played but not passed.
 */
export function oldMapSave(): Record<string, unknown> {
  const passed = (stars: number, plays = 2) => rec({ best: 60 + 10 * stars, stars: stars as 0 | 1 | 2 | 3, plays, passedAt: 1000, lastPlayed: 1000, firstS: 1 })
  return {
    v: 1,
    xp: 600,
    lessons: {
      'w1-01': rec({ plays: 1, passedAt: 1000, lastPlayed: 1000, firstS: 1 }),
      'w1-02': passed(2),
      'w1-03': passed(2),
      'w1-05': passed(2),
      'w1-04': passed(2),
      'w2-01': passed(1),
      'w2-02': passed(1),
      'w2-05': passed(1),
      'w3-06': passed(1),
      'w3-07': rec({ best: 48, plays: 3, fails: 3, lastPlayed: 1000, firstS: 2 }),
    },
  }
}