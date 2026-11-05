// Fretting-hand fingers, hand positions and pick strokes for a chart. Pure; must not import data.ts.
import type {
  Barre, Chart, ChartFingering, ChordEv, ChordEvFingering, ChordFingering, EventFingering, Finger, FingerTip, HandFrame,
  Lesson, NoteFingering, PickDir, PickRule, Prefs, Shift, Tech, WorldId,
} from './types'
import { buildChart } from './charts'

export const GUIDES_AUTO_MAX_WORLD = 6

export const FINGER_NAME: Record<Exclude<Finger, 'T'> | 'T', string> = { 0: 'open', 1: 'index', 2: 'middle', 3: 'ring', 4: 'pinky', T: 'thumb' }

export const HAND_TIPS: Record<WorldId, { fret: string; pick: string }> = {
  1: { fret: 'Press with the fingertip just behind the fret wire. Thumb rests behind the neck.',
    pick: 'Thumb and the side of your index, a little tip showing. Pick down on each beat.' },
  2: { fret: 'One finger per fret: index, middle, ring, pinky on four frets side by side. Keep the fingers hovering close.',
    pick: 'Down on the beat, up on the "and". A small motion from the wrist.' },
  3: { fret: "Make the shape before the strum. Start the change on beat 4, even if it isn't perfect yet.",
    pick: 'Keep swinging down and up like a pendulum. Only hit the strings when the pattern says.' },
  4: { fret: 'Open power chords: middle and ring on fret 2. Moving ones: index on the root, ring and pinky two frets up on the next two strings. Let the fingers rest lightly on the strings you skip to mute them.',
    pick: 'Downstrokes for chugs and power chords. For palm mute, rest the edge of your hand on the strings at the bridge.' },
  5: { fret: 'Box 1 at fret 5: index on 5, ring on 7, pinky on 8. The hand stays put.',
    pick: 'Strict down-up on eighths, even when you change strings.' },
  6: { fret: 'Hammer fast with the fingertip. Pull off with a small flick down. Bend with the ring finger, middle and index pushing behind it. Slides keep the same finger.',
    pick: 'Pick only the first note of a hammer, pull or slide. While bending, rest your palm lightly on the lower strings.' },
  7: { fret: 'Stay in box 1. The call uses the same fingers you answer with.',
    pick: 'Down on the beats, up on the "ands". It makes rhythms easier to copy.' },
  8: { fret: 'Home is fret 5 with the index on A. Every note in the box has its finger.',
    pick: 'Keep the pendulum going in the rests, so you come back in on time.' },
}

const _ = null
/** Shapes where the fallback rule is not the standard beginner fingering (plus a few for clarity). */
export const CHORD_FINGERS: Record<string, ChordFingering> = {
  '0,2,2,0,0,0': { fingers: [0, 2, 3, 0, 0, 0] }, // Em: index stays free for E and Am
  '0,2,2,x,x,x': { fingers: [0, 2, 3, _, _, _] }, // E5 open: the Em fingers
  'x,0,2,2,x,x': { fingers: [_, 0, 2, 3, _, _] }, // A5 open: E5 one string over
  'x,x,x,5,5,5': { fingers: [_, _, _, 1, 1, 1], barre: { fret: 5, from: 3, to: 5 } }, // Am top 3: index mini-barre
  'x,0,2,2,2,0': { fingers: [_, 0, 1, 2, 3, 0] }, // A
  '3,2,0,0,0,3': { fingers: [2, 1, 0, 0, 0, 3] }, // beginner G
  'x,x,0,2,3,2': { fingers: [_, _, 0, 1, 3, 2] }, // D
  'x,3,2,0,1,0': { fingers: [_, 3, 2, 0, 1, 0] }, // C
  'x,0,2,2,1,0': { fingers: [_, 0, 2, 3, 1, 0] }, // Am
  '0,2,2,1,0,0': { fingers: [0, 2, 3, 1, 0, 0] }, // E
  'x,x,x,7,7,5': { fingers: [_, _, _, 3, 4, 1] }, // D top 3
  // Boogie sixths: the index stays on fret 2 (the fifth), the ring finger reaches fret 4 and back.
  'x,0,4,x,x,x': { fingers: [_, 0, 3, _, _, _] }, // A6
  'x,x,0,4,x,x': { fingers: [_, _, 0, 3, _, _] }, // D6
  '0,4,x,x,x,x': { fingers: [0, 3, _, _, _, _] }, // E6
}

const shapeKey = (frets: number[]) => frets.map((f) => (f < 0 ? 'x' : f)).join(',')

/** Table lookup, else the fallback rule (1.7). */
export function chordFingering(frets: number[]): ChordFingering {
  const hit = CHORD_FINGERS[shapeKey(frets)]
  if (hit) return hit.barre ? { fingers: [...hit.fingers], barre: { ...hit.barre } } : { fingers: [...hit.fingers] }
  const fingers: (Finger | null)[] = frets.map((f) => (f < 0 ? null : f === 0 ? 0 : null))
  const fretted: number[] = []
  frets.forEach((f, s) => {
    if (f > 0) fretted.push(s)
  })
  if (!fretted.length) return { fingers }
  const m = Math.min(...fretted.map((s) => frets[s]))
  const taken = new Set<number>()
  let barre: Barre | undefined
  let rest = fretted
  if (fretted.length > 4) {
    const low = fretted.filter((s) => frets[s] === m)
    for (const s of low) fingers[s] = 1
    taken.add(1)
    barre = { fret: m, from: low[0], to: low[low.length - 1] }
    rest = fretted.filter((s) => frets[s] !== m)
  }
  rest = [...rest].sort((a, b) => frets[a] - frets[b] || a - b)
  for (const s of rest) {
    let k = frets[s] - m + 1
    while (taken.has(k)) k++
    taken.add(k)
    fingers[s] = k as Finger // above 4 is a validation error
  }
  return barre ? { fingers, barre } : { fingers }
}

/** Stroke for an onset at `beat` (2.2). */
export function strokeAt(beat: number, grid: 0.5 | 0.25, rule: PickRule): PickDir {
  if (rule === 'down') return 'D'
  const slot = Math.abs(Math.round(beat / grid))
  return slot % 2 === 0 ? 'D' : 'U'
}

// ---- The walk -------------------------------------------------------------------

const LEGATO: Tech[] = ['hammer', 'pull', 'slide']

interface WNote {
  kind: 'note'
  beat: number
  dur: number
  string: number
  fret: number
  midi: number
  tech?: Tech
  bendTo?: number
  hint?: Finger
  call: boolean
  ref: number // event id, or calls index for calls
}
interface WChord {
  kind: 'chord'
  beat: number
  dur: number
  ev: ChordEv
  call: false
  ref: number
}
type WItem = WNote | WChord

// Notes, calls and chords merged by beat; events before calls on the same beat.
function walkItems(chart: Chart): WItem[] {
  const out: WItem[] = []
  for (const e of chart.events) {
    if (e.kind === 'note') {
      out.push({ kind: 'note', beat: e.beat, dur: e.dur, string: e.string, fret: e.fret, midi: e.midi, tech: e.tech, bendTo: e.bendTo, hint: e.finger, call: false, ref: e.id })
    } else if (e.kind === 'chord') out.push({ kind: 'chord', beat: e.beat, dur: e.dur, ev: e, call: false, ref: e.id })
  }
  chart.calls.forEach((c, i) => {
    out.push({ kind: 'note', beat: c.beat, dur: c.dur, string: c.string, fret: c.fret, midi: c.midi, tech: c.tech, bendTo: c.bendTo, hint: c.finger, call: true, ref: i })
  })
  return out.map((it, i) => ({ it, i })).sort((a, b) => a.it.beat - b.it.beat || a.i - b.i).map(({ it }) => it)
}

function phraseStarts(items: WItem[]): boolean[] {
  return items.map((it, i) => {
    if (i === 0) return true
    const prev = items[i - 1]
    if (it.beat - (prev.beat + prev.dur) >= 1 - 1e-9) return true
    if (prev.dur >= 2) return true
    return prev.call !== it.call
  })
}

// Pass A (1.6): fingers fixed before the position walk.
function fixedFingers(items: WItem[]): (Finger | undefined)[] {
  return items.map((it, i) => {
    if (it.kind !== 'note') return undefined
    if (it.hint !== undefined) return it.hint
    if (it.fret === 0) return 0
    if (it.tech === 'bend') return bendFinger(it.fret)
    const next = items[i + 1]
    if (next?.kind === 'note' && next.tech === 'bend' && next.string === it.string && next.bendTo === it.midi && next.fret > 0) {
      return next.hint ?? bendFinger(next.fret)
    }
    const prev = items[i - 1]
    if (it.tech === 'slide' && prev?.kind === 'note' && prev.string === it.string && prev.fret > 0) return slideFinger(prev, it)
    if (next?.kind === 'note' && next.tech === 'slide' && next.string === it.string && next.fret > 0) return slideFinger(it, next)
    return undefined
  })
}

const bendFinger = (fret: number): Finger => (fret < 3 ? (fret as Finger) : 3)
const slideFinger = (src: WNote, tgt: WNote): Finger => tgt.hint ?? src.hint ?? (Math.min(3, src.fret, tgt.fret) as Finger)

/** Fingers, picks and shifts for every event and call (1.6, 2.2). Pure. */
export function assignFingering(lesson: Lesson, chart: Chart = buildChart(lesson)): ChartFingering {
  const home = lesson.position ?? lesson.improv?.boxFret ?? null
  const pickRule: PickRule = lesson.pickRule ?? 'grid'
  const items = walkItems(chart)
  const starts = phraseStarts(items)
  const fixed = fixedFingers(items)

  // Grid: 16ths only when a picked onset needs them.
  const offEighth = (b: number) => Math.abs(b * 2 - Math.round(b * 2)) > 1e-6
  let grid: 0.5 | 0.25 = 0.5
  for (const e of chart.events) {
    if (e.kind === 'rest' || (e.kind === 'note' && e.tech && LEGATO.includes(e.tech))) continue
    if (offEighth(e.beat)) grid = 0.25
  }
  for (const c of chart.calls) if (!(c.tech && LEGATO.includes(c.tech)) && offEighth(c.beat)) grid = 0.25

  const notePick = (beat: number, tech: Tech | undefined): PickDir | null => (tech && LEGATO.includes(tech) ? null : strokeAt(beat, grid, pickRule))

  const events: EventFingering[] = chart.events.map((e) => {
    if (e.kind === 'rest') return { kind: 'rest' }
    if (e.kind === 'mute') return { kind: 'mute', pick: strokeAt(e.beat, grid, pickRule) }
    // placeholders; the walk fills notes and chords
    return { kind: 'rest' }
  })
  const calls: NoteFingering[] = []

  let p: number | null = null
  let startPos: number | null = null
  let last: { string: number; fret: number; finger: Finger } | null = null
  const inRange = (lo: number, hi: number, v: number | null): v is number => v !== null && v >= lo && v <= hi

  items.forEach((it, i) => {
    let shift: Shift | undefined
    const moveTo = (to: number, kind: Shift['kind']) => {
      if (p !== null && to !== p) shift = { from: p, to, kind }
      p = to
    }

    if (it.kind === 'chord') {
      const fingering = chordFingering(it.ev.frets)
      const frettedF = it.ev.frets.filter((f) => f > 0)
      const open = it.ev.frets.some((f) => f === 0) || !frettedF.length
      const pos = open ? null : Math.min(...frettedF)
      if (pos !== null) moveTo(pos, 'shift')
      const dir = it.ev.dir
      const cf: ChordEvFingering = {
        fingering,
        pos,
        pick: dir === 'U' ? 'U' : dir === 'D' || dir === 'P' ? 'D' : strokeAt(it.beat, grid, pickRule),
        palmMute: dir === 'P',
      }
      if (shift) cf.shift = shift
      events[it.ref] = { kind: 'chord', ...cf }
      if (startPos === null && p !== null) startPos = p
      last = null
      return
    }

    let finger: Finger
    const k = fixed[i]
    if (k === 0 || k === 'T') finger = k
    else if (k !== undefined) {
      finger = k
      moveTo(it.fret - k + 1, it.tech === 'slide' ? 'slide' : 'shift')
    } else if (!starts[i] && p !== null && it.fret >= p && it.fret <= p + 3) {
      finger = (it.fret - p + 1) as Finger
    } else {
      // A run from this note inside the phrase, at most 4 frets wide.
      let lo = it.fret
      let hi = it.fret
      for (let j = i + 1; j < items.length && !starts[j]; j++) {
        const nx = items[j]
        if (nx.kind !== 'note') break
        if (fixed[j] === 0) continue
        if (fixed[j] !== undefined) break
        const nlo = Math.min(lo, nx.fret)
        const nhi = Math.max(hi, nx.fret)
        if (nhi - nlo > 3) break
        lo = nlo
        hi = nhi
      }
      const rLo = Math.max(1, hi - 3)
      const pNew = inRange(rLo, lo, home) ? home : inRange(rLo, lo, p) ? p : lo
      const prev = last
      if (prev && p !== null && it.fret > 0 && prev.string === it.string && prev.fret === it.fret && isFretting(prev.finger) && Math.abs(pNew - p) <= 1) {
        // same fret again (say after a bend): keep that finger; a nearby note reaches
        finger = prev.finger
      } else {
        moveTo(pNew, 'shift')
        finger = (it.fret - pNew + 1) as Finger
      }
    }

    const nf: NoteFingering = {
      finger,
      pos: p,
      pick: notePick(it.beat, it.tech),
      legato: !!it.tech && LEGATO.includes(it.tech),
      palmMute: it.tech === 'pm',
    }
    if (shift) nf.shift = shift
    if (it.call) calls[it.ref] = nf
    else events[it.ref] = { kind: 'note', ...nf }
    if (startPos === null && p !== null) startPos = p
    last = { string: it.string, fret: it.fret, finger }
  })

  return { events, calls, startPos, grid, pickRule }
}

const cache = new WeakMap<Chart, ChartFingering>()

/** assignFingering cached per chart object (WeakMap). Use this in UI code. */
export function fingeringFor(lesson: Lesson, chart: Chart): ChartFingering {
  let f = cache.get(chart)
  if (!f) {
    f = assignFingering(lesson, chart)
    cache.set(chart, f)
  }
  return f
}

/** The demo phrase, in beats [from, to). */
export function firstPhrase(chart: Chart): { from: number; to: number } {
  const chords = chart.events.filter((e): e is ChordEv => e.kind === 'chord')
  const hasNotes = chart.events.some((e) => e.kind === 'note')
  if (chords.length && !hasNotes) {
    const barSym = new Map<number, string>()
    for (const c of chords) {
      const bar = Math.floor(c.beat / 4)
      if (!barSym.has(bar)) barSym.set(bar, c.symbol)
    }
    const first = barSym.get(0) ?? chart.chordTimeline[0]?.symbol ?? ''
    for (let k = 1; k < chart.bars; k++) {
      const s = barSym.get(k)
      if (s !== undefined && s !== first) return { from: 4 * (k - 1), to: 4 * (k + 1) }
    }
    return { from: 0, to: 8 }
  }
  const play = chart.events.filter((e) => e.kind !== 'rest')
  if (!play.length) return { from: 0, to: 8 }
  const from = play[0].beat
  let last = play[0]
  let n = 1
  for (let i = 1; i < play.length; i++) {
    const e = play[i]
    if (n >= 8 || e.beat >= from + 8) break
    if (n >= 4 && (e.beat - (last.beat + last.dur) >= 1 || last.dur >= 2)) break
    last = e
    n++
  }
  return { from, to: Math.min(from + 8, last.beat + last.dur) }
}

// ---- handFrame ------------------------------------------------------------------

interface HItem {
  beat: number
  dur: number
  kind: 'note' | 'chord' | 'mute'
  eventId: number | null
  callIdx: number | null
  string: number
  fret: number
  tech?: Tech
  symbol: string
  frets: number[]
}

const hCache = new WeakMap<Chart, { items: HItem[]; playIds: number[] }>()

function handItems(chart: Chart): { items: HItem[]; playIds: number[] } {
  let c = hCache.get(chart)
  if (c) return c
  const raw: HItem[] = []
  const playIds: number[] = []
  for (const e of chart.events) {
    if (e.kind === 'rest') continue
    playIds.push(e.id)
    const base = { beat: e.beat, dur: e.dur, eventId: e.id, callIdx: null, string: 0, fret: 0, symbol: '', frets: [] as number[] }
    if (e.kind === 'note') raw.push({ ...base, kind: 'note', string: e.string, fret: e.fret, tech: e.tech })
    else if (e.kind === 'chord') raw.push({ ...base, kind: 'chord', symbol: e.symbol, frets: e.frets })
    else raw.push({ ...base, kind: 'mute' })
  }
  chart.calls.forEach((cn, i) => {
    raw.push({ beat: cn.beat, dur: cn.dur, kind: 'note', eventId: null, callIdx: i, string: cn.string, fret: cn.fret, tech: cn.tech, symbol: '', frets: [] })
  })
  const items = raw.map((it, i) => ({ it, i })).sort((a, b) => a.it.beat - b.it.beat || a.i - b.i).map(({ it }) => it)
  c = { items, playIds }
  hCache.set(chart, c)
  return c
}

function noteFing(f: ChartFingering, it: HItem): NoteFingering | null {
  if (it.callIdx !== null) return f.calls[it.callIdx] ?? null
  const e = it.eventId !== null ? f.events[it.eventId] : undefined
  return e?.kind === 'note' ? e : null
}

function itemPos(f: ChartFingering, it: HItem): number | null {
  if (it.kind === 'note') return noteFing(f, it)?.pos ?? null
  if (it.kind === 'chord' && it.eventId !== null) {
    const e = f.events[it.eventId]
    return e?.kind === 'chord' ? e.pos : null
  }
  return null
}

const lowestPlayed = (frets: number[]) => Math.max(0, frets.findIndex((x) => x >= 0))
const isFretting = (k: Finger | undefined): k is 1 | 2 | 3 | 4 => k === 1 || k === 2 || k === 3 || k === 4

/** The fretting hand at `beat` (6.4). */
export function handFrame(chart: Chart, f: ChartFingering, beat: number): HandFrame {
  const { items, playIds } = handItems(chart)
  // cur = last item with beat <= b
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].beat <= beat) lo = mid + 1
    else hi = mid
  }
  const ci = lo - 1
  const cur = ci >= 0 ? items[ci] : null
  const next = items[ci + 1] ?? null
  const nextId = playIds.find((id) => chart.events[id].beat > beat) ?? null

  const posAfter = (from: number): number | null => {
    for (let j = from; j < items.length; j++) {
      const p = itemPos(f, items[j])
      if (p !== null) return p
    }
    return null
  }
  const posBefore = (from: number): number | null => {
    for (let j = from; j >= 0; j--) {
      const p = itemPos(f, items[j])
      if (p !== null) return p
    }
    return null
  }
  const hover = (string: number, pos: number): FingerTip[] =>
    ([1, 2, 3, 4] as const).map((k) => ({ finger: k, string, fret: pos + k - 1, down: false, active: false }))

  const frame = (pos: number | null, string: number, tips: FingerTip[]): HandFrame => ({
    pos, string, tips, barre: null, eventId: null, callIdx: null, sinceBeat: Infinity, nextId, pick: null, palmMute: false, shift: null,
  })

  if (!cur) {
    if (!next) return frame(null, 0, hover(0, 1))
    const pos = itemPos(f, next) ?? posAfter(0) ?? 1
    const string = next.kind === 'note' ? next.string : next.kind === 'chord' ? lowestPlayed(next.frets) : 0
    return frame(pos, string, hover(string, pos))
  }

  const out = frame(null, 0, [])
  out.eventId = cur.eventId
  out.callIdx = cur.callIdx
  out.sinceBeat = beat - cur.beat

  if (cur.kind === 'mute') {
    const e = cur.eventId !== null ? f.events[cur.eventId] : undefined
    const prevNote = items.slice(0, ci).reverse().find((x) => x.kind === 'note')
    const pos = posBefore(ci - 1) ?? posAfter(ci + 1) ?? 1
    out.pos = pos
    out.string = prevNote?.string ?? 0
    out.tips = hover(out.string, pos)
    out.pick = e?.kind === 'mute' ? e.pick : null
    return out
  }

  if (cur.kind === 'chord') {
    const e = cur.eventId !== null ? f.events[cur.eventId] : undefined
    const cf = e?.kind === 'chord' ? e : null
    const string = lowestPlayed(cur.frets)
    const pos = cf?.pos ?? null
    const held = beat < cur.beat + cur.dur || (next?.kind === 'chord' && next.symbol === cur.symbol)
    const tips: (FingerTip | undefined)[] = [undefined, undefined, undefined, undefined]
    cf?.fingering.fingers.forEach((k, s) => {
      if (k === null || !isFretting(k) || tips[k - 1]) return
      tips[k - 1] = { finger: k, string: s, fret: cur.frets[s], down: held, active: true }
    })
    const base = pos ?? 1
    out.pos = pos
    out.string = string
    out.tips = ([1, 2, 3, 4] as const).map((k) => tips[k - 1] ?? { finger: k, string, fret: base + k - 1, down: false, active: false })
    out.barre = cf?.fingering.barre ?? null
    if (cf) {
      out.pick = cf.pick
      out.palmMute = cf.palmMute
      out.shift = cf.shift ?? null
    }
    return out
  }

  // a note or a call
  const nf = noteFing(f, cur)
  const string = cur.string
  const pos = nf?.pos ?? posAfter(ci + 1) ?? 1
  const tips = hover(string, pos)
  const down = beat < cur.beat + cur.dur
  const k = nf?.finger
  if (cur.fret > 0 && isFretting(k)) {
    tips[k - 1] = { finger: k, string, fret: cur.fret, down, active: true }
    // anchors: lower fingers still planted from the notes just before, on this string
    for (let j = ci - 1; j >= 0; j--) {
      const pr = items[j]
      if (pr.kind !== 'note' || pr.string !== string) break
      const pf = noteFing(f, pr)
      if (!pf || pf.pos !== nf?.pos) break
      if (pr.fret > 0 && pr.fret < cur.fret && isFretting(pf.finger) && pf.finger !== k && !tips[pf.finger - 1].active && !tips[pf.finger - 1].down) {
        tips[pf.finger - 1] = { finger: pf.finger, string, fret: pr.fret, down, active: false }
      }
    }
    // prepared pull-off: the target finger is already down
    if (next?.kind === 'note' && next.tech === 'pull' && next.string === string) {
      const tf = noteFing(f, next)?.finger
      if (isFretting(tf) && tf !== k && next.fret > 0) tips[tf - 1] = { finger: tf, string, fret: next.fret, down, active: false }
    }
    // bend support: the fingers behind the bending one push too
    if (cur.tech === 'bend') {
      for (let s = 1; s < k; s++) {
        const fr = cur.fret - (k - s)
        if (fr >= 1) tips[s - 1] = { finger: s as 1 | 2 | 3, string, fret: fr, down, active: false }
      }
    }
  }
  out.pos = pos
  out.string = string
  out.tips = tips
  if (nf) {
    out.pick = nf.pick
    out.palmMute = nf.palmMute
    out.shift = nf.shift ?? null
  }
  return out
}

/** Guides shown in play for this lesson. */
export function guidesOn(prefs: Prefs, lesson: Lesson): boolean {
  if (prefs.guides === 'on') return true
  if (prefs.guides === 'off') return false
  return lesson.world <= GUIDES_AUTO_MAX_WORLD
}

// ---- Validation -----------------------------------------------------------------

function noteProblems(what: string, fret: number, nf: NoteFingering | undefined): string[] {
  if (!nf) return [`${what}: no fingering`]
  const k = nf.finger
  if (k === 'T') return [`${what}: thumb is not used in beginner lessons`]
  const out: string[] = []
  if (!(k >= 0 && k <= 4)) out.push(`${what}: finger ${k} is not 0–4`)
  if ((k === 0) !== (fret === 0)) out.push(`${what}: finger ${k} on fret ${fret}`)
  if (fret > 0) {
    const pos = fret - k + 1
    if (pos < 1) out.push(`${what}: finger ${k} on fret ${fret} puts the hand below fret 1`)
    if (nf.pos !== pos) out.push(`${what}: hand at ${nf.pos} but finger ${k} on fret ${fret}`)
  }
  return out
}

function chordProblems(what: string, frets: number[], cf: ChordFingering): string[] {
  const out: string[] = []
  const { fingers, barre } = cf
  if (fingers.length !== 6) return [`${what}: ${fingers.length} fingers, expected 6`]
  const at = new Map<number, number>() // finger -> fret
  let lo = Infinity
  let hi = -Infinity
  fingers.forEach((k, s) => {
    const f = frets[s]
    if ((k === null) !== (f < 0)) out.push(`${what}: string ${s} finger ${k} with fret ${f}`)
    if ((k === 0) !== (f === 0)) out.push(`${what}: string ${s} finger ${k} with fret ${f}`)
    if (k === null || k === 0 || f <= 0) return
    if (k === 'T') {
      out.push(`${what}: thumb is not used in beginner lessons`)
      return
    }
    if (k > 4) out.push(`${what}: finger ${k} is above 4`)
    lo = Math.min(lo, f)
    hi = Math.max(hi, f)
    const had = at.get(k)
    if (had !== undefined && had !== f) out.push(`${what}: finger ${k} on frets ${had} and ${f}`)
    else if (had !== undefined) {
      const inBarre = !!barre && f === barre.fret && s >= barre.from && s <= barre.to
      if (!inBarre) out.push(`${what}: finger ${k} on two strings outside a barre`)
    }
    at.set(k, f)
  })
  if (hi - lo > 3) out.push(`${what}: spans ${hi - lo + 1} frets`)
  return out
}

/** One message per problem; empty = OK (6.5). */
export function validateFingering(lesson: Lesson): string[] {
  const chart = buildChart(lesson)
  const f = assignFingering(lesson, chart)
  const out: string[] = []
  const seenChords = new Set<string>()
  chart.events.forEach((e, i) => {
    const ef = f.events[i]
    if (!ef || ef.kind !== e.kind) {
      out.push(`event ${i}: fingering kind ${ef?.kind} for a ${e.kind}`)
      return
    }
    if (e.kind === 'note' && ef.kind === 'note') {
      const what = `note ${i}`
      out.push(...noteProblems(what, e.fret, ef))
      const legato = !!e.tech && LEGATO.includes(e.tech)
      if (legato && ef.pick !== null) out.push(`${what}: legato note is picked`)
      if (!legato && ef.pick === null) out.push(`${what}: picked note has no stroke`)
      const prev = chart.events[i - 1]
      const pf = f.events[i - 1]
      if (legato && prev?.kind === 'note' && pf?.kind === 'note' && typeof pf.finger === 'number' && typeof ef.finger === 'number') {
        if (e.tech === 'hammer' && pf.finger !== 0 && ef.finger <= pf.finger) out.push(`${what}: hammer finger ${ef.finger} is not above ${pf.finger}`)
        if (e.tech === 'pull' && ef.finger !== 0 && ef.finger >= pf.finger) out.push(`${what}: pull finger ${ef.finger} is not below ${pf.finger}`)
        if (e.tech === 'slide' && ef.finger !== pf.finger) out.push(`${what}: slide changes finger ${pf.finger} to ${ef.finger}`)
      }
      if (e.tech === 'bend' && ef.finger !== 3 && e.fret >= 3) out.push(`${what}: bend with finger ${ef.finger}, not the ring finger`)
    } else if (e.kind === 'chord' && ef.kind === 'chord') {
      if (e.frets.every((x) => x < 0)) return
      const key = `${e.symbol} ${shapeKey(e.frets)}`
      if (seenChords.has(key)) return
      seenChords.add(key)
      out.push(...chordProblems(`chord ${e.symbol} (${shapeKey(e.frets)})`, e.frets, ef.fingering))
    }
  })
  if (f.calls.length !== chart.calls.length) out.push(`${f.calls.length} call fingerings for ${chart.calls.length} calls`)
  chart.calls.forEach((c, i) => {
    const what = `call ${i}`
    const cf = f.calls[i]
    out.push(...noteProblems(what, c.fret, cf))
    if (!cf) return
    const legato = !!c.tech && LEGATO.includes(c.tech)
    if (legato && cf.pick !== null) out.push(`${what}: legato note is picked`)
    if (!legato && cf.pick === null) out.push(`${what}: picked note has no stroke`)
  })
  return out
}
