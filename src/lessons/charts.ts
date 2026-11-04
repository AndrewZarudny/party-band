// Compiles a Lesson into a timed Chart: judged events, lead-voice calls and the chord timeline.
// Must not import data.ts (data.ts imports this for validateLessons).
import type { CallNote, Chart, ChartEvent, ChordBar, ImprovSpec, Lesson, NoteEv, SeqItem } from './types'
import { STANDARD_TUNING, parseChord } from '../music/theory'
import { guitarShape } from '../music/parts'
import { boxNotes, makePhrase } from '../music/phrase'
import { seq } from './seq'
import { chordPcs, scalePcsOf } from './improv'

// An event before ids are assigned.
type NoId<T> = T extends unknown ? Omit<T, 'id'> : never
type Draft = NoId<ChartEvent>

const RHYTHMS = ['X_X_X___', 'X_XX_X__', 'XX_X_X__', 'X_X_XX__', 'X__X_X__']

/** Small seeded PRNG, returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a string hash, for stable per-lesson seeds. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// A chord that doesn't parse gets no shape and no tones; validateLessons() reports it.
function chordInfo(symbol: string, override: number[] | undefined) {
  const c = parseChord(symbol)
  const frets = override ?? (c ? guitarShape(c).frets : [-1, -1, -1, -1, -1, -1])
  return { frets, pcs: chordPcs(symbol), power: c?.quality === '5' }
}

function noteDraft(it: Extract<SeqItem, { k: 'note' }>, offset: number, hidden?: boolean): Draft {
  const midi = STANDARD_TUNING[it.s] + it.f
  const ev: Omit<NoteEv, 'id'> = { kind: 'note', beat: it.beat + offset, dur: it.len, string: it.s, fret: it.f, midi }
  if (it.tech) ev.tech = it.tech
  if (it.bend !== undefined) ev.bendTo = midi + it.bend
  if (hidden) ev.hidden = true
  return ev
}

function seqEvents(lesson: Lesson): Draft[] {
  const out: Draft[] = []
  for (const it of seq(lesson.seq ?? '', lesson.step ?? 1)) {
    if (it.k === 'note') out.push(noteDraft(it, 0))
    else if (it.k === 'rest') out.push({ kind: 'rest', beat: it.beat, dur: it.len })
    else if (it.k === 'mute') out.push({ kind: 'mute', beat: it.beat, dur: 0.5 })
    else out.push({ kind: 'chord', beat: it.beat, dur: it.len, symbol: it.symbol, ...chordInfo(it.symbol, lesson.shapes?.[it.symbol]), chroma: true })
  }
  return out
}

function callNote(it: Extract<SeqItem, { k: 'note' }>, offset: number): CallNote {
  return { beat: it.beat + offset, dur: it.len, midi: STANDARD_TUNING[it.s] + it.f, string: it.s, fret: it.f }
}

function strumEvents(lesson: Lesson, chordBars: ChordBar[]): Draft[] {
  const out: Draft[] = []
  chordBars.forEach((bar, i) => {
    const slots = bar.strum
    const firstHit = slots.search(/[DUP]/)
    const info = bar.chord === 'mute' ? null : chordInfo(bar.chord, bar.frets ?? lesson.shapes?.[bar.chord])
    for (let j = 0; j < slots.length; j++) {
      const ch = slots[j]
      const beat = 4 * i + j / 2
      if (ch === 'D' || ch === 'U' || ch === 'P') {
        if (!info) out.push({ kind: 'mute', beat, dur: 0.5 })
        else {
          const chroma = bar.chroma ?? (lesson.type === 'chords' && j === firstHit)
          out.push({ kind: 'chord', beat, dur: 0.5, symbol: bar.chord, ...info, dir: ch, chroma })
        }
      } else if (ch === 'x') out.push({ kind: 'mute', beat, dur: 0.5 })
      else if (ch === 'r') {
        let k = j + 1
        while (k < slots.length && slots[k] === '_') k++
        out.push({ kind: 'rest', beat, dur: (k - j) / 2 })
      }
    }
  })
  return out
}

/** The bar's chord as shown on the timeline: a band that plays harmony first, then the strummed chord, else ''. */
function barChord(lesson: Lesson, i: number): string {
  const b = lesson.backing
  const harmony = !!b && (!b.parts || !!b.parts.bass || !!b.parts.keys)
  if (b && harmony && b.chords.length) return b.chords[i % b.chords.length]
  const cb = lesson.chordBars?.[i]
  if (cb) return cb.chord === 'mute' ? '' : cb.chord
  return ''
}

// Fills `calls` and `improvBars` for an improv lesson with call & response.
function improvCalls(lesson: Lesson, spec: ImprovSpec, timeline: Chart['chordTimeline'], calls: CallNote[], improvBars: NonNullable<Chart['improvBars']>, listenBars: number[]) {
  const cr = spec.callResponse
  if (!cr) return
  const rng = mulberry32(cr.seed ?? hashSeed(lesson.id))
  const scalePcs = scalePcsOf(spec)
  const box = boxNotes(scalePcs, [], spec.boxFret)
  cr.calls.forEach((call, k) => {
    const callBar = 2 * k
    const off = 8 * k
    listenBars.push(callBar)
    improvBars.push({ bar: callBar, role: 'call', callIdx: k })
    improvBars.push({ bar: callBar + 1, role: cr.mode === 'mixed' && call !== '' ? 'echo' : 'answer', callIdx: k })
    if (call !== '') {
      for (const it of seq(call, 0.5)) if (it.k === 'note') calls.push(callNote(it, off))
      return
    }
    const chord = timeline[callBar]?.symbol ?? ''
    const len = 3 + Math.floor(rng() * 3)
    const phrase = makePhrase(box, scalePcs, chordPcs(chord), spec.endPcs ?? [spec.key], len, rng)
    const pattern = RHYTHMS[Math.floor(rng() * RHYTHMS.length)]
    const slots: number[] = []
    for (let j = 0; j < pattern.length; j++) if (pattern[j] === 'X') slots.push(j)
    for (let j = 0; j < 6 && slots.length < phrase.length; j++) if (!slots.includes(j)) slots.push(j)
    const use = slots.slice(0, phrase.length).sort((a, b) => a - b)
    use.forEach((slot, n) => {
      const p = phrase[n]
      const inBar = slot / 2
      const dur = n + 1 < use.length ? (use[n + 1] - slot) / 2 : Math.max(0.5, 3.5 - inBar)
      calls.push({ beat: off + inBar, dur, midi: p.midi, string: p.string, fret: p.fret })
    })
  })
}

export function buildChart(lesson: Lesson): Chart {
  const totalBeats = lesson.bars * 4
  const chordTimeline: Chart['chordTimeline'] = []
  for (let i = 0; i < lesson.bars; i++) {
    chordTimeline.push({ beat: 4 * i, symbol: lesson.type === 'sync' ? '' : barChord(lesson, i) })
  }
  const drafts: Draft[] = []
  const calls: CallNote[] = []
  const listenBars: number[] = []
  let improvBars: Chart['improvBars']

  if (lesson.type === 'notes') {
    const cs = lesson.calls
    if (!cs) drafts.push(...seqEvents(lesson))
    else if (cs.mode === 'echo-rhythm') {
      if (!cs.pos) throw new Error(`chart: ${lesson.id} echo-rhythm needs pos`)
      const { s, f } = cs.pos
      const midi = STANDARD_TUNING[s] + f
      cs.calls.forEach((pattern, k) => {
        listenBars.push(2 * k)
        for (let j = 0; j < pattern.length; j++) {
          if (pattern[j] !== 'X') continue
          const beat = 8 * k + j / 2
          calls.push({ beat, dur: 0.5, midi, string: s, fret: f })
          drafts.push({ kind: 'note', beat: beat + 4, dur: 0.5, string: s, fret: f, midi })
        }
      })
    } else {
      const showUntil = cs.showUntil ?? Infinity
      cs.calls.forEach((call, k) => {
        listenBars.push(2 * k)
        for (const it of seq(call, 0.5)) {
          if (it.k !== 'note') continue
          calls.push(callNote(it, 8 * k))
          drafts.push(noteDraft(it, 8 * k + 4, k >= showUntil))
        }
      })
    }
  } else if (lesson.type === 'chords' || lesson.type === 'rhythm') {
    drafts.push(...strumEvents(lesson, lesson.chordBars ?? []))
  } else if (lesson.type === 'improv' && lesson.improv) {
    if (lesson.improv.callResponse) {
      improvBars = []
      improvCalls(lesson, lesson.improv, chordTimeline, calls, improvBars, listenBars)
    }
  }

  // Stable sort keeps authoring order for events on the same beat.
  const events = drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.beat - b.d.beat || a.i - b.i)
    .map(({ d }, id) => ({ ...d, id }) as ChartEvent)
  calls.sort((a, b) => a.beat - b.beat)

  // Refractory and window shrink only care about events the player strikes.
  let minGapBeats = Infinity
  let prev: number | null = null
  for (const e of events) {
    if (e.kind === 'rest') continue
    if (prev !== null && e.beat > prev) minGapBeats = Math.min(minGapBeats, e.beat - prev)
    prev = e.beat
  }

  const chart: Chart = { lessonId: lesson.id, bars: lesson.bars, totalBeats, events, calls, listenBars, chordTimeline, minGapBeats }
  if (improvBars) chart.improvBars = improvBars
  return chart
}
