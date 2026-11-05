// What the teaching demos show: the steps of a phrase, their words, and the loop clock. Pure: no DOM.
import type { Chart, ChartFingering, Finger, PickDir } from '../../types'
import { FINGER_NAME } from '../../fingering'

export const STRING_NAME = ['low E', 'A', 'D', 'G', 'B', 'high e'] // by string, 0 = low E
export const STRING_SHORT = ['E', 'A', 'D', 'G', 'B', 'e']

/** One thing the player does: a note, a chord or a muted scratch. */
export interface Step {
  id: number // chart event id
  beat: number
  dur: number
  kind: 'note' | 'chord' | 'mute'
  string: number // the note's string; chords: the lowest played string
  fret: number
  finger: Finger | null // notes only
  pick: PickDir | null
  legato: boolean
  palmMute: boolean
  tech?: string
  symbol?: string
  frets?: number[]
  fingers?: (Finger | null)[] // chords: per string
  pos: number | null
}

/** The playable events with beat in [from, to), with their fingering. */
export function stepsOf(chart: Chart, f: ChartFingering, from = -Infinity, to = Infinity): Step[] {
  const out: Step[] = []
  for (const e of chart.events) {
    if (e.beat < from || e.beat >= to) continue
    const ef = f.events[e.id]
    if (!ef) continue
    if (e.kind === 'note' && ef.kind === 'note') {
      out.push({
        id: e.id, beat: e.beat, dur: e.dur, kind: 'note', string: e.string, fret: e.fret, finger: ef.finger, pick: ef.pick,
        legato: ef.legato, palmMute: ef.palmMute, tech: e.tech, pos: ef.pos,
      })
    } else if (e.kind === 'chord' && ef.kind === 'chord') {
      out.push({
        id: e.id, beat: e.beat, dur: e.dur, kind: 'chord', string: Math.max(0, e.frets.findIndex((x) => x >= 0)), fret: 0, finger: null,
        pick: ef.pick, legato: false, palmMute: ef.palmMute, symbol: e.symbol, frets: e.frets, fingers: ef.fingering.fingers, pos: ef.pos,
      })
    } else if (e.kind === 'mute' && ef.kind === 'mute') {
      out.push({ id: e.id, beat: e.beat, dur: e.dur, kind: 'mute', string: 0, fret: 0, finger: null, pick: ef.pick, legato: false, palmMute: false, pos: null })
    }
  }
  return out
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const pickWord = (p: PickDir | null) => (p === 'D' ? 'down' : p === 'U' ? 'up' : 'no pick')
const LEGATO_WORD: Record<string, string> = { hammer: 'hammer', pull: 'pull-off', slide: 'slide' }

/** "1. Index, fret 5, down", "3. Ring, fret 7, hammer (no pick)", "2. Open A string, down", "1. G chord, strum down". */
export function stepCaption(s: Step, n: number): string {
  const p = s.palmMute ? `${pickWord(s.pick)}, palm muted` : pickWord(s.pick)
  if (s.kind === 'chord') return `${n}. ${s.symbol} chord, strum ${p}`
  if (s.kind === 'mute') return `${n}. Muted scratch, ${p}`
  if (s.fret === 0 || s.finger === 0) return `${n}. Open ${STRING_NAME[s.string]} string, ${p}`
  const who = cap(FINGER_NAME[s.finger ?? 0])
  if (s.legato && s.tech) return `${n}. ${who}, fret ${s.fret}, ${LEGATO_WORD[s.tech] ?? s.tech} (no pick)`
  const extra = s.tech === 'bend' ? ', bend' : s.tech === 'vibrato' ? ', vibrato' : ''
  return `${n}. ${who}, fret ${s.fret}${extra}, ${p}`
}

/** Spoken summary of a phrase: "First phrase: index on low E fret 5, pick down; pinky on fret 8, pick up". */
export function phraseLabel(steps: Step[]): string {
  if (!steps.length) return 'Nothing to play in this phrase'
  const parts: string[] = []
  let lastString = -1
  for (const s of steps) {
    const pick = s.pick ? `pick ${s.pick === 'D' ? 'down' : 'up'}` : 'no pick'
    if (s.kind === 'chord') parts.push(`${s.symbol} chord, strum ${s.pick === 'U' ? 'up' : 'down'}`)
    else if (s.kind === 'mute') parts.push(`muted scratch, ${pick}`)
    else if (s.fret === 0) parts.push(`open ${STRING_NAME[s.string]} string, ${pick}`)
    else {
      const where = s.string === lastString ? `fret ${s.fret}` : `${STRING_NAME[s.string]} fret ${s.fret}`
      const how = s.legato && s.tech ? `${LEGATO_WORD[s.tech] ?? s.tech}, no pick` : pick
      parts.push(`${FINGER_NAME[s.finger ?? 0]} on ${where}, ${how}`)
    }
    lastString = s.kind === 'note' ? s.string : -1
  }
  return 'First phrase: ' + parts.join('; ')
}

/** What the hand does right now, for the line under the demo. */
export function stepNow(s: Step): string {
  if (s.kind === 'chord') return `${s.symbol}: ${s.pick === 'U' ? 'strum up' : 'strum down'}${s.palmMute ? ', palm muted' : ''}`
  if (s.kind === 'mute') return `Muted scratch, pick ${s.pick === 'U' ? 'up' : 'down'}`
  const pick = s.legato ? 'no pick' : s.pick ? `pick ${s.pick === 'D' ? 'down' : 'up'}` : 'no pick'
  if (s.fret === 0) return `Open ${STRING_NAME[s.string]} string, ${pick}`
  const tech = s.tech === 'hammer' ? ', hammer on' : s.tech === 'pull' ? ', pull off' : s.tech === 'slide' ? ', slide' : s.tech === 'bend' ? ', bend' : s.tech === 'vibrato' ? ', vibrato' : ''
  return `${cap(FINGER_NAME[s.finger ?? 0])} finger, ${STRING_NAME[s.string]} fret ${s.fret}${tech}, ${pick}`
}

/** Demo loop tempo: 75% of the lesson's. */
export const loopBpm = (bpm: number) => Math.max(30, Math.round(bpm * 0.75))

/**
 * Loop clock: the phrase [from, to) then one beat of silence, over and over.
 * Returns the chart beat and whether it falls in the silence.
 */
export function loopBeat(elapsedSec: number, spb: number, from: number, to: number): { beat: number; gap: boolean; pass: number } {
  const len = to - from + 1
  const b = Math.max(0, elapsedSec / spb)
  const pass = Math.floor(b / len)
  const inPass = b - pass * len
  return { beat: from + inPass, gap: inPass >= to - from, pass }
}
