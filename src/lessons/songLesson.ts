// The parts of the player's own tabs as lessons: each section's notes become a chart for the same runway, judge
// and speed trainer the built-in lessons use. Loaded on demand (it pulls in alphaTab to read the files).
import * as alphaTab from '@coderline/alphatab'
import type { Chart, ChartEvent, Lesson } from './types'
import { STANDARD_TUNING, pc } from '../music/theory'
import { songSections } from '../music/songLevels'
import { registerLesson } from './data'
import { registerChart } from './charts'

const TICKS = 960 // per quarter note
const MAX_BARS = 16 // a lesson run stays short; longer parts are cut at this many bars
const MIN_NOTES = 4

export interface SongSource {
  id: string
  title: string
  artist: string
  data: ArrayBuffer
}

/** One part of a song as a lesson, with how busy it is (notes a beat), for putting easier parts in earlier weeks. */
export interface SongPart {
  id: string // the lesson id
  songId: string
  song: string
  part: string
  density: number
}

type Draft = Omit<Extract<ChartEvent, { kind: 'note' }>, 'id'> | Omit<Extract<ChartEvent, { kind: 'chord' }>, 'id'>

const isGuitar = (t: alphaTab.model.Track) => t.staves[0]?.isStringed && !t.isPercussion && (/guit|gtr/i.test(t.name) || (t.playbackInfo.program >= 24 && t.playbackInfo.program <= 31))

/**
 * Builds and registers a lesson for every part of the song that can be one (enough notes, 4/4). The tab's
 * fingering is kept and read in standard tuning, as Learn a song does for a tuning that is a plain shift, so
 * nothing needs retuning. Returns the parts in song order, or why the song can't be used.
 */
export function songLessons(song: SongSource): { parts: SongPart[] } | { error: string } {
  let score: alphaTab.model.Score
  try {
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(song.data), new alphaTab.Settings())
  } catch {
    return { error: "That tab file can't be read." }
  }
  const track = score.tracks.find(isGuitar) ?? score.tracks.find((t) => t.staves[0]?.isStringed)
  const staff = track?.staves[0]
  if (!track || !staff) return { error: 'No guitar part in that tab.' }
  const tuning = [...staff.tuning].reverse() // low string first
  const shift = tuning.length === 6 ? STANDARD_TUNING[0] - tuning[0] : NaN
  if (!tuning.every((n, i) => STANDARD_TUNING[i] - n === shift)) return { error: 'This song is in a drop or open tuning. Lessons from songs work for standard-shaped tunings for now.' }

  const beatsOf = (bar: number) => staff.bars[bar]?.voices[0]?.beats ?? []
  const sounding = (b: alphaTab.model.Beat) => (b.isRest ? [] : b.notes.filter((n) => !n.isTieDestination && !n.isDead && n.isStringed))
  const notesIn = (from: number, to: number) => {
    let n = 0
    for (let bar = from; bar <= to; bar++) for (const b of beatsOf(bar)) if (sounding(b).length) n++
    return n
  }
  const bpm = Math.max(40, Math.min(200, Math.round(score.tempo)))
  const by = song.artist && song.artist !== 'Unknown artist' ? ` by ${song.artist}` : ''
  const tuningTip = shift
    ? `The tab is tuned ${Math.abs(shift)} semitone${Math.abs(shift) > 1 ? 's' : ''} ${shift > 0 ? 'down' : 'up'}. The fingering is the same in standard tuning; it just sounds ${shift > 0 ? 'higher' : 'lower'} than the record.`
    : 'Same fingering as the tab.'

  const parts: SongPart[] = []
  songSections(score.masterBars.map((mb) => mb.section?.text ?? null)).forEach((sec, index) => {
    if (notesIn(sec.from, sec.to) < MIN_NOTES) return
    // Bars with nothing to play at either end are left out; the band's count-in takes their place.
    let from = sec.from
    let to = sec.to
    while (from < to && !notesIn(from, from)) from++
    while (to > from && !notesIn(to, to)) to--
    to = Math.min(to, from + MAX_BARS - 1)
    for (let bar = from; bar <= to; bar++) {
      const mb = score.masterBars[bar]
      if (mb.timeSignatureNumerator !== 4 || mb.timeSignatureDenominator !== 4) return // lessons need 4/4 for now
    }

    const start = score.masterBars[from].start
    const drafts: Draft[] = []
    for (let bar = from; bar <= to; bar++) {
      for (const b of beatsOf(bar)) {
        const ns = sounding(b)
        if (!ns.length) continue
        const beat = (b.absolutePlaybackStart - start) / TICKS
        const dur = Math.max(0.25, b.playbackDuration / TICKS)
        // alphaTab counts strings from 1 at the lowest; the chart from 0 at low E.
        const at = (n: alphaTab.model.Note) => ({ string: Math.max(0, Math.min(5, n.string - 1)), fret: n.fret })
        if (ns.length === 1) {
          const { string, fret } = at(ns[0])
          drafts.push({ kind: 'note', beat, dur, string, fret, midi: STANDARD_TUNING[string] + fret })
          continue
        }
        // Several notes at once: a shape judged by its pitches, like a power chord.
        const frets = [-1, -1, -1, -1, -1, -1]
        const pcs: number[] = []
        for (const n of ns) {
          const { string, fret } = at(n)
          frets[string] = fret
          const p = pc(STANDARD_TUNING[string] + fret)
          if (!pcs.includes(p)) pcs.push(p)
        }
        drafts.push({ kind: 'chord', beat, dur, symbol: '', frets, pcs, power: true, chroma: false })
      }
    }
    drafts.sort((a, b) => a.beat - b.beat)
    const events = drafts.map((d, id) => ({ ...d, id }) as ChartEvent)
    let minGapBeats = Infinity
    for (let i = 1; i < events.length; i++) if (events[i].beat > events[i - 1].beat) minGapBeats = Math.min(minGapBeats, events[i].beat - events[i - 1].beat)

    const bars = to - from + 1
    const id = `song:${song.id}:${index}`
    const lesson: Lesson = {
      id,
      world: 4,
      order: index + 1,
      title: `${song.title}: ${sec.name}`,
      goal: `The ${sec.name.toLowerCase()} of ${song.title}${by}, from your own tab.`,
      tips: [tuningTip, 'It starts slow. Clean runs earn the tempo, a few BPM at a time.'],
      type: 'notes',
      bpm,
      bars,
      timing: 'easy',
      tone: 'Classic rock',
      octaveOk: true,
      // Drums only: the lesson band plays from chord names, and a riff's chords can't be read off the tab reliably.
      backing: { feel: 'pop', chords: ['E5'], parts: { drums: true }, level: 0.7 },
      pass: 60,
      stars: [60, 80, 92],
      xp: 80,
    }
    const chart: Chart = {
      lessonId: id,
      bars,
      totalBeats: bars * 4,
      events,
      calls: [],
      listenBars: [],
      chordTimeline: Array.from({ length: bars }, (_, i) => ({ beat: 4 * i, symbol: '' })),
      minGapBeats,
    }
    registerLesson(lesson)
    registerChart(id, chart)
    parts.push({ id, songId: song.id, song: song.title, part: sec.name, density: events.length / (bars * 4) })
  })
  return parts.length ? { parts } : { error: 'No part of that song has enough notes in 4/4 to play as a lesson.' }
}
