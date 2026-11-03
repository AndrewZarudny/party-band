// What the host publishes to a live session, and how every device turns it into the same view.
import type { Member } from '../music/band'
import type { Feel, KeysVoicing } from '../music/parts'
import { FEELS, keysVoicing } from '../music/parts'
import type { Step } from '../music/songForm'
import type { Chord } from '../music/theory'
import { beatsToNextSection, locate, sectionProgress, soloAt } from '../music/songForm'
import { SCALES, noteName, parseChord, pc, prefersFlats } from '../music/theory'

/** The jam as published by the host. Times are in the server's clock (the host Mac). */
export interface JamState {
  running: boolean
  startAt: number // server time (ms) of beat 0; before it, the count-in plays
  bpm: number
  beatsPerChord: number
  auto: boolean // chords follow the clock; otherwise manualIdx / chordCount from the host
  manualIdx: number
  chordCount: number
  keyRoot: number
  scaleId: string
  chords: string[] // chord symbols, e.g. ["Am", "G", "F", "G"]
  timeline?: { symbol: string; beats: number; section: string; solo: boolean; first: boolean; formIdx?: number }[] // per-chord lengths and song sections
  lyrics?: string[] // the singer's words per form entry (pasted by the band)
  lyricBeats?: (number[] | null)[] // when each line starts, from the section's start (tap-synced)
  lyricWords?: (number[][] | null)[] // when each word starts (from a tab)
  vocalPhrases?: (number[] | null)[] // where the tab's sung phrases start (pasted lines land on them)
  songTitle?: string
  withRecording?: boolean // playing along with the record: the song runs until the record ends
  ended?: boolean // the song played to its end
  rhythm?: Record<string, { strum?: string; technique?: string }> // the song's guitar rhythm per section
  feelId: string
  rotation: number
  position: number
  band: Member[]
  hostName: string
}

export interface SessionMember {
  id: string
  name: string
  instrument: Member['instrument']
  online: boolean
}

/** Everything derived from the state at one moment, identical on every device. */
export interface JamMoment {
  chords: Chord[]
  voicings: KeysVoicing[]
  feel: Feel
  chordIdx: number
  chord: Chord | null
  next: Chord | null
  beatInChord: number
  eighth: number | null
  countIn: number // beats left in the count-in, 0 when playing
  soloist: Member | null
  nextSoloist: Member | null // who takes over when the solo rotation moves on
  chordsUntilSwap: number // chords left until then (0 = no rotation)
  soloLeft: number // chords left in the current solo
  section: string // song section now ('' in a free jam)
  nextSection: string
  formIdx: number // entry of the song form now (-1 in a free jam)
  sectionProgress: number // 0–1 through the current section
  beatsToNext: number // beats until the next section starts
  songBeat: number // beats since the song's start (for the progress bar)
  ended: boolean
  beatsThisChord: number
  scaleLabel: string
  scalePcs: number[]
  flats: boolean
  keyName: string
}

export function momentOf(s: JamState, serverNow: number): JamMoment {
  // Steps: the song's timeline, or the free-jam progression with every chord the same length.
  const steps: Step[] = (s.timeline ?? s.chords.map((symbol, i) => ({ symbol, beats: s.beatsPerChord, section: '', solo: false, first: i === 0, formIdx: -1 })))
    .map((x) => ({ chord: parseChord(x.symbol)!, beats: x.beats, section: x.section, solo: x.solo, first: x.first, formIdx: x.formIdx ?? -1 }))
    .filter((x) => !!x.chord)
  const chords = steps.map((x) => x.chord)
  const voicings: KeysVoicing[] = []
  let prev: number[] | null = null
  for (const c of chords) {
    const v = keysVoicing(c, prev)
    voicings.push(v)
    prev = v.right
  }
  const len = Math.max(1, chords.length)
  const beatF = s.running ? ((serverNow - s.startAt) * s.bpm) / 60000 : -Infinity
  const beat = Math.floor(beatF)
  const playing = s.running && beat >= 0
  // A song stops at its end (no looping); a free jam loops.
  const isSong = steps.some((x) => x.section)
  const total = steps.reduce((a, x) => a + x.beats, 0)
  const past = isSong && playing && beat >= total
  const at = playing ? locate(steps, past ? total - 1 : beat) : null
  const chordCount = s.auto && at ? at.chordCount : s.chordCount
  const chordIdx = s.auto && at ? at.idx : s.manualIdx % len
  const solo = soloAt(s.band, s.rotation, steps, chordCount)
  const scale = SCALES[s.scaleId] ?? SCALES.minorPent
  const flats = prefersFlats(s.keyRoot, scale.minor)
  let nextSection = ''
  for (let k = 1; k <= steps.length; k++) {
    const st = steps[(chordIdx + k) % steps.length]
    if (st?.first && st.section) {
      nextSection = st.section
      break
    }
  }
  return {
    chords,
    voicings,
    feel: FEELS[s.feelId] ?? FEELS.pop,
    chordIdx,
    chord: chords[chordIdx] ?? null,
    next: chords.length ? chords[(chordIdx + 1) % len] : null,
    beatInChord: at ? at.beatInChord : 0,
    eighth: playing ? Math.floor(beatF * 2) % 8 : null,
    countIn: s.running && beat < 0 && beatF > -8 ? -beat : 0,
    soloist: solo.soloist,
    nextSoloist: solo.nextSoloist,
    chordsUntilSwap: solo.chordsUntilSwap,
    soloLeft: solo.soloLeft,
    section: steps[chordIdx]?.section ?? '',
    formIdx: steps[chordIdx]?.formIdx ?? -1,
    sectionProgress: at ? sectionProgress(steps, chordIdx, past ? steps[chordIdx].beats : at.beatInChord + (beatF - beat)) : 0,
    songBeat: playing ? (s.withRecording ? beatF : Math.min(beatF, total)) : 0,
    ended: !!s.ended || (past && !s.withRecording),
    beatsToNext: beatsToNextSection(steps, chordIdx, at ? at.beatInChord : 0),
    nextSection,
    beatsThisChord: steps[chordIdx]?.beats ?? s.beatsPerChord,
    scaleLabel: scale.label,
    scalePcs: scale.intervals.map((i) => pc(s.keyRoot + i)),
    flats,
    keyName: noteName(s.keyRoot, flats),
  }
}

/** Offset (ms) to add to Date.now() to get the server's clock: best of a few round trips. */
export async function measureClockOffset(rounds = 6): Promise<number> {
  let best = { rtt: Infinity, offset: 0 }
  for (let i = 0; i < rounds; i++) {
    const t0 = Date.now()
    const { now } = (await (await fetch('/api/time', { cache: 'no-store' })).json()) as { now: number }
    const t1 = Date.now()
    if (t1 - t0 < best.rtt) best = { rtt: t1 - t0, offset: now - (t0 + t1) / 2 }
  }
  return best.offset
}
