// Fretboard markers for jamming: scale, position box, chord tones, next chord, phrase and played notes.
import type { Marker } from '../components/Fretboard'
import type { Chord, FretPos } from './theory'
import { nearestPosition, pc, positionsFor } from './theory'

export function jamMarkers(o: {
  scalePcs: number[]
  chord: Chord | null
  nextChord: Chord | null
  lo: number // position box, first and last fret
  hi: number
  phrase: FretPos[]
  ptr: number // the phrase note to play now
  played?: { midi: number; t: number }[]
}): Marker[] {
  const m: Marker[] = []
  const chordPcs = o.chord?.tones ?? []
  for (const p of positionsFor(o.scalePcs, 0, 22)) {
    const inBox = p.fret >= o.lo && p.fret <= o.hi
    if (!inBox) m.push({ ...p, kind: 'scale', opacity: 0.55 })
  }
  for (const p of positionsFor([...new Set([...o.scalePcs, ...chordPcs])], o.lo, o.hi)) {
    const k = pc(p.midi)
    m.push({ ...p, kind: k === o.chord?.root ? 'root' : chordPcs.includes(k) ? 'chord' : 'box' })
  }
  if (o.nextChord) for (const p of positionsFor(o.nextChord.tones, o.lo, o.hi)) m.push({ ...p, kind: 'next' })
  o.phrase.forEach((p, i) => {
    if (i > o.ptr && i <= o.ptr + 2) m.push({ ...p, kind: 'upcoming', label: String(i + 1), opacity: i === o.ptr + 1 ? 1 : 0.6 })
  })
  if (o.phrase[o.ptr]) m.push({ ...o.phrase[o.ptr], kind: 'target' })
  const now = performance.now()
  for (const n of (o.played ?? []).slice(-6)) {
    const fp = nearestPosition(n.midi, o.lo + 2)
    if (fp) m.push({ ...fp, kind: 'played', opacity: Math.max(0.15, 1 - (now - n.t) / 3000) })
  }
  return m
}
