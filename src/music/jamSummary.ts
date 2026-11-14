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

// ---- Jams over time -------------------------------------------------------------------------------------

export interface JamRecord {
  at: number
  notes: number
  chordPct: number
  outPct: number
  sec: number
}

const KEY = 'jam-history'

export function loadJamHistory(): JamRecord[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? '[]') as JamRecord[]
    return Array.isArray(a) ? a.filter((r) => r && typeof r.at === 'number' && typeof r.outPct === 'number') : []
  } catch {
    return []
  }
}

/** Keeps a jam's numbers (the last 60). */
export function saveJam(s: JamSummary, at = Date.now()) {
  const all = [...loadJamHistory(), { at, notes: s.notes, chordPct: s.chordPct, outPct: s.outPct, sec: s.sec }].slice(-60)
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable */
  }
}

/** This jam against the average of the ones before it (up to 5); null with none before. */
export function againstUsual(s: JamSummary, before: JamRecord[]): { chordPct: number; outPct: number; jams: number; better: boolean } | null {
  const last = before.slice(-5)
  if (!last.length) return null
  const avg = (f: (r: JamRecord) => number) => Math.round(last.reduce((a, r) => a + f(r), 0) / last.length)
  const chordPct = avg((r) => r.chordPct)
  const outPct = avg((r) => r.outPct)
  // Better: fewer notes outside, or as few outside and more chord tones.
  const better = s.outPct < outPct - 2 || (s.outPct <= outPct + 2 && s.chordPct > chordPct + 2)
  return { chordPct, outPct, jams: last.length, better }
}

// ---- Timing against the band -------------------------------------------------------------------------

/**
 * How far an attack at audio time `t` is from the nearest 8th note of a band whose beat 0 is at `start`, in ms
 * (+ = late). A swung band plays its off-beats late on purpose: then only the beats themselves are the grid.
 */
export function gridOffsetMs(t: number, start: number, secPerBeat: number, swing = false): number | null {
  const e = swing ? secPerBeat : secPerBeat / 2
  const k = Math.round((t - start) / e)
  const off = t - (start + k * e)
  // Clearly between grid points (a 16th, a swung off-beat): not meant for the grid, left out.
  return Math.abs(off) > 0.3 * e ? null : Math.round(off * 1000)
}

/** The average lean against the band, from 8 or more attacks; null with fewer. */
export function bandTiming(offsets: number[]): { meanMs: number; n: number; text: string | null } | null {
  if (offsets.length < 8) return null
  const meanMs = Math.round(offsets.reduce((a, o) => a + o, 0) / offsets.length)
  const text = meanMs <= -20 ? `you were about ${-meanMs} ms ahead of the band (rushing)` : meanMs >= 20 ? `you were about ${meanMs} ms behind the band (dragging)` : null
  return { meanMs, n: offsets.length, text }
}
