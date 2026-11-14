// A jam in numbers, when the band stops: how many notes, how they sat against the chord and the scale, how many
// suggested phrases were played. Plus one pointer for next time.

export interface JamCounts {
  chord: number // notes that were tones of the chord playing then
  scale: number // in the scale, not a chord tone
  out: number // outside the scale
  phrases: number // suggested phrases played to the end
  sec: number // how long the band played
}

export const emptyJamCounts = (): JamCounts => ({ chord: 0, scale: 0, out: 0, phrases: 0, sec: 0 })

export interface JamSummary {
  notes: number
  chordPct: number
  scalePct: number
  outPct: number
  phrases: number
  sec: number
  /** One thing for next time, or praise when it was balanced. */
  pointer: string
}

const OUT_HIGH = 20 // % outside the scale that means the hand wandered off the box
const CHORD_LOW = 25 // % chord tones under which the solo floats over the changes

/** Null when too little was played to say anything (under 12 notes). */
export function jamSummary(c: JamCounts): JamSummary | null {
  const notes = c.chord + c.scale + c.out
  if (notes < 12) return null
  const pct = (n: number) => Math.round((100 * n) / notes)
  const chordPct = pct(c.chord)
  const outPct = pct(c.out)
  const pointer =
    outPct >= OUT_HIGH
      ? `${outPct}% of your notes were outside the scale. Stay inside the box next time, and bend or slide out of a wrong note into the nearest box note.`
      : chordPct < CHORD_LOW
        ? `Only ${chordPct}% of your notes were chord tones. When the chord changes, land on one of its notes (they're highlighted on the board).`
        : `Good balance: ${chordPct}% chord tones, only ${outPct}% outside. Next time, leave more space between phrases.`
  return { notes, chordPct, scalePct: 100 - chordPct - outPct, outPct, phrases: c.phrases, sec: Math.round(c.sec), pointer }
}
