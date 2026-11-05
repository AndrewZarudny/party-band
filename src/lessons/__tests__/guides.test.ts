import { describe, expect, it } from 'vitest'
import type { Chart, Lesson, NoteEv } from '../types'
import { LESSONS } from '../data'
import { buildChart } from '../charts'
import { assignFingering } from '../fingering'
import { guideMarkers, nextAtBeat } from '../guides'

const byId = (id: string): Lesson => {
  const l = LESSONS.find((x) => x.id === id)
  if (!l) throw new Error('no lesson ' + id)
  return l
}

function setup(id: string) {
  const lesson = byId(id)
  const chart = buildChart(lesson)
  return { lesson, chart, f: assignFingering(lesson, chart) }
}

const notesOf = (c: Chart) => c.events.filter((e): e is NoteEv => e.kind === 'note')

describe('guideMarkers', () => {
  it('w5-01, next = event 1: pinky on low E 8, the other fingers resting at 5 6 7, window 5..8', () => {
    const { chart, f } = setup('w5-01')
    const gv = guideMarkers(chart, f, 1)
    const next = gv.markers.filter((m) => m.kind === 'next')
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ string: 0, fret: 8, finger: 4 })
    const ghosts = gv.markers.filter((m) => m.kind === 'ghost').map((m) => [m.string, m.fret, m.finger])
    expect(ghosts).toEqual([
      [0, 5, 1],
      [0, 6, 2],
      [0, 7, 3],
    ])
    expect(gv.window).toEqual({ from: 5, to: 8 })
    expect(gv.arrow).toBeNull()
    // the next marker is drawn last, on top
    expect(gv.markers[gv.markers.length - 1].kind).toBe('next')
  })

  it('shows at most 3 upcoming notes, fading, never on the next marker spot', () => {
    for (const id of ['w5-01', 'w2-02', 'w2-01', 'w6-05']) {
      const { chart, f } = setup(id)
      for (let i = 0; i < chart.events.length; i++) {
        const ev = chart.events[i]
        if (ev.kind !== 'note' || ev.hidden) continue
        const gv = guideMarkers(chart, f, i)
        const up = gv.markers.filter((m) => m.kind === 'upcoming')
        expect(up.length).toBeLessThanOrEqual(3)
        for (const u of up) {
          expect(u.string === ev.string && u.fret === ev.fret).toBe(false)
          expect(u.finger).toBeDefined()
        }
        // nearest is the most opaque
        const ops = up.map((u) => u.opacity ?? 1)
        expect([...ops].sort((a, b) => a - b)).toEqual(ops)
      }
    }
  })

  it('an open next note shows finger 0 and no resting fingers', () => {
    let found = false
    for (const lesson of LESSONS) {
      if (lesson.type !== 'notes') continue
      const chart = buildChart(lesson)
      const open = notesOf(chart).find((n) => n.fret === 0 && !n.hidden)
      if (!open) continue
      const gv = guideMarkers(chart, assignFingering(lesson, chart), open.id)
      const next = gv.markers.find((m) => m.kind === 'next')
      expect(next).toMatchObject({ string: open.string, fret: 0, finger: 0 })
      expect(gv.markers.some((m) => m.kind === 'ghost')).toBe(false)
      found = true
      break
    }
    expect(found).toBe(true)
  })

  it('w2-02, next = event 7: an arrow down to fret 1', () => {
    const { chart, f } = setup('w2-02')
    expect(guideMarkers(chart, f, 7).arrow).toEqual({ from: 5, to: 1, label: 'Move to fret 1' })
  })

  it('a slide target gets no arrow (the slide mark already says it)', () => {
    const { chart, f } = setup('w6-02')
    const ev = chart.events[1]
    expect(ev.kind === 'note' && ev.tech).toBe('slide')
    const gv = guideMarkers(chart, f, 1)
    expect(gv.arrow).toBeNull()
    expect(gv.window).toEqual({ from: 5, to: 8 })
  })

  it('nothing to show without a next event', () => {
    const { chart, f } = setup('w5-01')
    expect(guideMarkers(chart, f, null)).toEqual({ markers: [], window: null, arrow: null })
  })

  it('a chord in a notes lesson marks each fretted string with its finger', () => {
    const { chart, f } = setup('w4-04')
    const ch = chart.events.find((e) => e.kind === 'chord')
    if (!ch || ch.kind !== 'chord') return
    const gv = guideMarkers(chart, f, ch.id)
    const next = gv.markers.filter((m) => m.kind === 'next')
    expect(next.length).toBe(ch.frets.filter((x) => x >= 0).length)
    for (const m of next) expect(m.finger).toBeDefined()
  })
})

describe('nextAtBeat (listen mode)', () => {
  it('moves on a moment after each onset and skips rests', () => {
    const { chart } = setup('w5-01')
    const n = notesOf(chart)
    expect(nextAtBeat(chart, -2)?.id).toBe(n[0].id)
    expect(nextAtBeat(chart, n[0].beat + 0.05)?.id).toBe(n[0].id)
    expect(nextAtBeat(chart, n[0].beat + 0.2)?.id).toBe(n[1].id)
    expect(nextAtBeat(chart, chart.totalBeats + 1)).toBeNull()
  })
})
