// Jam ideas: a short phrase to try over the chord the band is on, as in the Band tab's solo guide.
// An idea is only a suggestion: it is never judged, and copying it scores the same as ignoring it.
import type { Chart, ImprovSpec, Lesson } from './types'
import type { FretPos } from '../music/theory'
import { chordPcs, scalePcsOf } from './improv'
import { boxNotes, makePhrase } from '../music/phrase'

export interface Idea {
  chord: string
  notes: FretPos[]
}

export const IDEA_LEN = 5 // short enough to play and still leave a gap
const MIN_BARS = 2 // an idea stays at least this long, so there is time to read it and try it
const MAX_BARS = 4 // and at most this long on one chord

/** Jams that show ideas: free jams and "answer" jams. Echo jams ask the player to copy the band's call instead. */
export function ideasFor(lesson: Lesson): ImprovSpec | null {
  const spec = lesson.type === 'improv' ? lesson.improv : undefined
  if (!spec || spec.callResponse?.mode === 'mixed') return null
  return spec
}

/**
 * The first bar of each idea: a new one when the chord changes (after two bars at least), or after four bars on one chord.
 * In an answer jam each idea starts with the band's call instead and is written for the chord of the answer that follows,
 * so it is on screen to read while the band plays, before the player's turn.
 */
export function ideaSegments(chart: Pick<Chart, 'bars' | 'chordTimeline' | 'listenBars'>): { from: number; chord: string }[] {
  const out: { from: number; chord: string }[] = []
  const chordAt = (bar: number) => chart.chordTimeline[bar]?.symbol ?? ''
  if (chart.listenBars.length) {
    const calls = [...chart.listenBars].sort((a, b) => a - b)
    if (calls[0] > 0) out.push({ from: 0, chord: chordAt(0) })
    calls.forEach((bar, i) => {
      if (i > 0 && calls[i - 1] === bar - 1) return // a call of several bars is one idea
      let answer = bar + 1
      while (chart.listenBars.includes(answer)) answer++
      out.push({ from: bar, chord: chordAt(Math.min(answer, chart.bars - 1)) })
    })
    return out
  }
  for (let bar = 0; bar < chart.bars; bar++) {
    const chord = chart.chordTimeline[bar]?.symbol ?? ''
    const cur = out[out.length - 1]
    const len = cur ? bar - cur.from : 0
    if (!cur || len >= MAX_BARS || (len >= MIN_BARS && chord !== cur.chord)) out.push({ from: bar, chord })
  }
  return out
}

/** Index of the segment the bar is in. */
export function segmentAt(segs: { from: number }[], bar: number): number {
  let i = 0
  while (i + 1 < segs.length && segs[i + 1].from <= bar) i++
  return i
}

/** A phrase from the jam's own notes that starts and ends on a note of the chord. Null when the box has too few notes for one. */
export function makeIdea(spec: ImprovSpec, chord: string, rand = Math.random): Idea | null {
  const scale = scalePcsOf(spec)
  // only the chord's notes that are among the jam's notes: an idea never asks for a note the lesson left out
  const tones = (chord ? chordPcs(chord) : []).filter((t) => scale.includes(t))
  const notes = makePhrase(boxNotes(scale, [], spec.boxFret), scale, tones, tones, IDEA_LEN, rand)
  return notes.length >= 3 ? { chord, notes } : null
}
