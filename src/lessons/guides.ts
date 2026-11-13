// Finger guides on the lesson fretboard: the next note with its finger, a few faint notes after it,
// the other fingers resting on the same string, the hand's four-fret window and a move arrow. Pure.

import type { Marker } from '../components/Fretboard'
import type { Chart, ChartEvent, ChartFingering, Finger, Shift } from './types'

export interface GuideView {
  markers: Marker[]
  window: { from: number; to: number } | null
  arrow: { from: number; to: number; label: string } | null
}

const UPCOMING_OPACITY = [0.55, 0.38, 0.25]
const UPCOMING_BEATS = 4

const spot = (s: number, f: number) => s * 64 + f

export function guideMarkers(chart: Chart, f: ChartFingering, nextId: number | null): GuideView {
  const empty: GuideView = { markers: [], window: null, arrow: null }
  if (nextId === null) return empty
  const ev = chart.events[nextId]
  const ef = f.events[nextId]
  if (!ev || !ef) return empty

  const next: Marker[] = []
  const ghosts: Marker[] = []
  const used = new Set<number>()
  let pos: number | null
  let shift: Shift | null

  if (ev.kind === 'note' && ef.kind === 'note') {
    if (ev.hidden) return empty
    pos = ef.pos
    shift = ef.shift ?? null
    next.push({ kind: 'next', string: ev.string, fret: ev.fret, finger: ef.finger, id: `n${ev.id}` })
    used.add(spot(ev.string, ev.fret))
    if (ev.fret > 0 && pos !== null) {
      for (let k = 1; k <= 4; k++) {
        const fret = pos + k - 1
        if (k === ef.finger || fret < 1 || fret === ev.fret) continue
        ghosts.push({ kind: 'ghost', string: ev.string, fret, finger: k as Finger })
      }
    }
  } else if (ev.kind === 'chord' && ef.kind === 'chord') {
    pos = ef.pos
    shift = ef.shift ?? null
    ev.frets.forEach((fret, s) => {
      const fg = ef.fingering.fingers[s]
      if (fret < 0 || fg === null || fg === undefined) return
      next.push({ kind: 'next', string: s, fret, finger: fg, id: `n${ev.id}.${s}` })
      used.add(spot(s, fret))
    })
  } else return empty

  // the next few notes, fainter the further away
  const upcoming: Marker[] = []
  const until = ev.beat + UPCOMING_BEATS
  for (let i = nextId + 1; i < chart.events.length && upcoming.length < UPCOMING_OPACITY.length; i++) {
    const u = chart.events[i]
    if (u.beat > until) break
    const uf = f.events[i]
    if (u.kind !== 'note' || u.hidden || !uf || uf.kind !== 'note') continue
    const at = spot(u.string, u.fret)
    if (used.has(at)) continue
    used.add(at)
    upcoming.push({ kind: 'upcoming', string: u.string, fret: u.fret, finger: uf.finger, opacity: UPCOMING_OPACITY[upcoming.length] })
  }

  // drawn back to front: resting fingers, far notes, near notes, then the next one on top
  const markers = [...ghosts.filter((g) => !used.has(spot(g.string, g.fret))), ...upcoming.reverse(), ...next]
  return {
    markers,
    window: pos !== null ? { from: pos, to: pos + 3 } : null,
    arrow: shift && shift.kind === 'shift' ? { from: shift.from, to: shift.to, label: 'Move to fret ' + shift.to } : null,
  }
}

/** Listen mode has no judge: the note coming up is the first one not yet a moment past its onset. */
export function nextAtBeat(chart: Chart, beat: number, lag = 0.15): ChartEvent | null {
  for (const ev of chart.events) if (ev.kind !== 'rest' && ev.beat + lag > beat) return ev
  return null
}
