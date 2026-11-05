import { describe, expect, it } from 'vitest'
import type { Chart, ChartFingering, Lesson, NoteFingering, Prefs } from '../types'
import { LESSONS, lessonById } from '../data'
import { buildChart } from '../charts'
import { sliceChart } from '../loop'
import { seq, seqBeats } from '../seq'
import { CHORD_FINGERS, assignFingering, chordFingering, firstPhrase, fingeringFor, guidesOn, handFrame, strokeAt, validateFingering } from '../fingering'

const L = (id: string): Lesson => {
  const l = lessonById(id)
  if (!l) throw new Error('no lesson ' + id)
  return l
}
const notes = (f: ChartFingering): NoteFingering[] => f.events.filter((e): e is Extract<typeof e, { kind: 'note' }> => e.kind === 'note')
const fing = (id: string) => notes(assignFingering(L(id)))
const fingers = (id: string) => fing(id).map((n) => n.finger)
const shifts = (id: string) =>
  fing(id).flatMap((n, i) => (n.shift ? [{ i, ...n.shift }] : []))

describe('chordFingering', () => {
  it('returns the table for every listed shape', () => {
    expect(Object.keys(CHORD_FINGERS)).toHaveLength(14)
    for (const [key, cf] of Object.entries(CHORD_FINGERS)) {
      const frets = key.split(',').map((x) => (x === 'x' ? -1 : Number(x)))
      expect(chordFingering(frets)).toEqual(cf)
    }
    expect(chordFingering([0, 2, 2, 0, 0, 0]).fingers).toEqual([0, 2, 3, 0, 0, 0])
    expect(chordFingering([-1, -1, -1, 5, 5, 5])).toEqual({ fingers: [null, null, null, 1, 1, 1], barre: { fret: 5, from: 3, to: 5 } })
    expect(chordFingering([3, 2, 0, 0, 0, 3]).fingers).toEqual([2, 1, 0, 0, 0, 3])
  })

  it('falls back to one finger per fret for power chords', () => {
    expect(chordFingering([3, 5, 5, -1, -1, -1]).fingers).toEqual([1, 3, 4, null, null, null])
    expect(chordFingering([5, 7, 7, -1, -1, -1]).fingers).toEqual([1, 3, 4, null, null, null])
    expect(chordFingering([8, 10, 10, -1, -1, -1]).fingers).toEqual([1, 3, 4, null, null, null])
    expect(chordFingering([-1, 5, 7, 7, -1, -1]).fingers).toEqual([null, 1, 3, 4, null, null])
  })

  it('w3-07 boogie: fifths on the index at fret 2, sixths with the ring or pinky at fret 4', () => {
    const chords = assignFingering(L('w3-07')).events.filter((e): e is Extract<typeof e, { kind: 'chord' }> => e.kind === 'chord')
    const evs = buildChart(L('w3-07')).events.filter((e) => e.kind === 'chord')
    expect(chords.length).toBe(evs.length)
    let fifths = 0
    let sixths = 0
    evs.forEach((e, i) => {
      if (e.kind !== 'chord') return
      const s = e.frets.findIndex((f) => f > 0)
      const f = chords[i].fingering.fingers[s]
      if (e.frets[s] === 2) {
        fifths++
        expect(f).toBe(1)
      } else {
        sixths++
        expect(e.frets[s]).toBe(4)
        expect([3, 4]).toContain(f)
      }
    })
    expect(fifths).toBeGreaterThan(0)
    expect(sixths).toBeGreaterThan(0)
  })

  it('uses a barre when more than four strings are fretted', () => {
    expect(chordFingering([1, 3, 3, 2, 1, 1])).toEqual({ fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1, from: 0, to: 5 } })
  })

  it('the fallback reproduces the standard open shapes', () => {
    for (const key of ['3,2,0,0,0,3', 'x,x,0,2,3,2', 'x,3,2,0,1,0', 'x,0,2,2,1,0', '0,2,2,1,0,0', 'x,0,2,2,2,0']) {
      const frets = key.split(',').map((x) => (x === 'x' ? -1 : Number(x)))
      // 12 frets up misses the table but keeps the rule's relative result
      const up = frets.map((f) => (f > 0 ? f + 12 : f))
      expect(chordFingering(up).fingers).toEqual(CHORD_FINGERS[key].fingers)
    }
  })
})

describe('assignFingering: fixtures (1.8)', () => {
  it('w2-01 Spider Walk', () => {
    const f = assignFingering(L('w2-01'))
    expect(notes(f).map((n) => n.finger)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4])
    expect(f.startPos).toBe(5)
    expect(shifts('w2-01')).toEqual([])
  })

  it('w5-01 Meet the Box', () => {
    expect(fingers('w5-01')).toEqual([1, 4, 1, 3, 1, 3, 1, 3, 1, 4, 1, 4, 1, 4, 1, 3, 1, 3, 1, 3, 1, 4, 1])
  })

  it('w2-02 One-String Song', () => {
    expect(fingers('w2-02')).toEqual([1, 1, 2, 4, 4, 2, 1, 3, 1, 1, 3, 3, 3, 1, 1])
    expect(fing('w2-02').map((n) => n.pos)).toEqual([5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 3, 3, 3, 3])
    expect(shifts('w2-02')).toEqual([{ i: 7, from: 5, to: 1, kind: 'shift' }, { i: 11, from: 1, to: 3, kind: 'shift' }])
  })

  it('w5-04 LICK_A', () => {
    expect(fingers('w5-04').slice(0, 6)).toEqual([1, 4, 1, 3, 1, 3])
  })

  it('w6-02 Slide Over', () => {
    const f = assignFingering(L('w6-02'))
    expect(notes(f).map((n) => n.finger)).toEqual([3, 3, 3, 3, 3, 3, 3, 3])
    expect(notes(f).map((n) => n.pos)).toEqual([3, 5, 5, 7, 6, 8, 5, 3])
    expect(shifts('w6-02')).toEqual([
      { i: 1, from: 3, to: 5, kind: 'slide' },
      { i: 3, from: 5, to: 7, kind: 'slide' },
      { i: 4, from: 7, to: 6, kind: 'shift' },
      { i: 5, from: 6, to: 8, kind: 'slide' },
      { i: 6, from: 8, to: 5, kind: 'shift' },
      { i: 7, from: 5, to: 3, kind: 'slide' },
    ])
    expect(f.startPos).toBe(3)
  })

  it('w6-03 Bend to Pitch', () => {
    const n = fing('w6-03')
    expect(n.map((x) => x.finger)).toEqual([3, 3, 3, 3, 3, 3, 3, 3])
    expect(n.map((x) => x.pos)).toEqual([7, 5, 7, 5, 8, 6, 8, 6])
    expect(n.map((x) => x.shift?.kind)).toEqual([undefined, 'shift', 'shift', 'shift', 'shift', 'shift', 'shift', 'shift'])
  })

  it('w6-05 Say It With Feeling', () => {
    expect(fingers('w6-05')).toEqual([1, 3, 1, 3, 3, 1, 3, 3, 3, 2, 1, 3, 1, 3, 3, 3, 1, 3, 1, 3])
    expect(shifts('w6-05')).toEqual([
      { i: 8, from: 5, to: 7, kind: 'slide' },
      { i: 10, from: 7, to: 5, kind: 'shift' },
      { i: 14, from: 5, to: 6, kind: 'shift' },
      { i: 16, from: 6, to: 5, kind: 'shift' },
    ])
  })

  it('w2-03 Octave Hunter with @1 roots', () => {
    expect(fingers('w2-03')).toEqual([1, 3, 1, 3, 1, 3, 1, 3, 1, 3])
    expect(shifts('w2-03').map(({ i, from, to }) => ({ i, from, to }))).toEqual([
      { i: 2, from: 5, to: 8 },
      { i: 4, from: 8, to: 3 },
      { i: 8, from: 3, to: 5 },
    ])
  })

  it('w4-03 Chug & Riff', () => {
    const f = fingers('w4-03')
    expect(f.slice(0, 16)).toEqual(Array(16).fill(0))
    // index on 3, ring on 5 (the power-chord pair), index drops to A string fret 2
    expect(f.slice(16, 24)).toEqual([0, 0, 1, 0, 3, 0, 1, 0])
    expect(f.slice(24)).toEqual([0, 0, 1, 0, 1, 0])
    expect(shifts('w4-03')).toEqual([{ i: 28, from: 3, to: 2, kind: 'shift' }])
  })

  it('w4-02 Power Moves', () => {
    const chart = buildChart(L('w4-02'))
    const f = assignFingering(L('w4-02'), chart)
    const chords = f.events.flatMap((e, i) => (e.kind === 'chord' ? [{ e, beat: chart.events[i].beat }] : []))
    const firstOfBar = (bar: number) => chords.find((c) => c.beat >= bar * 4)?.e
    expect([0, 1, 2, 3].map((b) => firstOfBar(b)?.pos)).toEqual([3, 5, 8, 5])
    expect(firstOfBar(0)?.shift).toBeUndefined()
    expect(firstOfBar(1)?.shift).toEqual({ from: 3, to: 5, kind: 'shift' })
    expect(firstOfBar(2)?.shift).toEqual({ from: 5, to: 8, kind: 'shift' })
    expect(firstOfBar(3)?.shift).toEqual({ from: 8, to: 5, kind: 'shift' })
    expect(chords.filter((c) => c.e.shift)).toHaveLength(3)
  })

  it('w4-04: the riff then G5 is a shift', () => {
    const f = assignFingering(L('w4-04'))
    const g5 = f.events.find((e) => e.kind === 'chord')
    expect(g5?.kind === 'chord' && g5.shift).toEqual({ from: 2, to: 3, kind: 'shift' })
  })

  it('w6-05 bar 4: the ring finger stays on fret 8 after the bend', () => {
    const chart = buildChart(L('w6-05'))
    const f = assignFingering(L('w6-05'), chart)
    const at = (beat: number) => {
      const i = chart.events.findIndex((e) => e.kind === 'note' && Math.abs(e.beat - beat) < 1e-9)
      const ef = f.events[i]
      return ef.kind === 'note' ? ef : null
    }
    expect(at(24)).toMatchObject({ finger: 3, pos: 6 })
    expect(at(26)).toMatchObject({ finger: 3, pos: 6 })
    expect(at(26)?.shift).toBeUndefined()
  })

  it('w7-04 call 3: the hammered note is not picked', () => {
    const chart = buildChart(L('w7-04'))
    const f = assignFingering(L('w7-04'), chart)
    const k = chart.calls.findIndex((c) => c.tech === 'hammer')
    expect(k).toBeGreaterThan(0)
    expect(chart.calls[k]).toMatchObject({ string: 3, fret: 7 })
    expect(f.calls[k].pick).toBeNull()
    expect(f.calls[k].legato).toBe(true)
    expect(f.calls[k - 1].pick).not.toBeNull()
  })

  it('w7-01: the D string fret 7 call and answers use the ring finger', () => {
    const f = assignFingering(L('w7-01'))
    expect(new Set(notes(f).map((n) => n.finger))).toEqual(new Set([3]))
    expect(new Set(f.calls.map((n) => n.finger))).toEqual(new Set([3]))
  })
})

describe('picks (2.2)', () => {
  const picks = (id: string) => fing(id).map((n) => n.pick)

  it('w2-02 is all down except the and of beat 13', () => {
    expect(picks('w2-02')).toEqual(Array.from({ length: 15 }, (_, i) => (i === 13 ? 'U' : 'D')))
  })

  it('LICK_A is D U D U D D', () => {
    expect(picks('w5-04').slice(0, 6)).toEqual(['D', 'U', 'D', 'U', 'D', 'D'])
  })

  it('w5-03 Threes alternates strictly', () => {
    const p = picks('w5-03')
    expect(p).toEqual(p.map((_, i) => (i % 2 === 0 ? 'D' : 'U')))
  })

  it('w6-02 picks only the slide sources', () => {
    expect(picks('w6-02')).toEqual(['D', null, 'D', null, 'D', null, 'D', null])
  })

  it('w6-05 legato targets are not picked', () => {
    const n = fing('w6-05')
    n.forEach((x, i) => {
      if ([1, 8, 18].includes(i)) {
        expect(x.pick).toBeNull()
        expect(x.legato).toBe(true)
      } else expect(x.pick).not.toBeNull()
    })
  })

  it('w4-03 and w4-04 are all downstrokes; P notes are palm muted', () => {
    for (const id of ['w4-03', 'w4-04']) {
      const f = assignFingering(L(id))
      for (const e of f.events) if (e.kind !== 'rest') expect(e.pick).toBe('D')
    }
    const chart = buildChart(L('w4-03'))
    const f = assignFingering(L('w4-03'), chart)
    chart.events.forEach((e, i) => {
      const ef = f.events[i]
      if (e.kind === 'note' && ef.kind === 'note') expect(ef.palmMute).toBe(e.tech === 'pm')
    })
    expect(notes(f).filter((n) => n.palmMute).length).toBeGreaterThan(0)
  })

  it('w3-02 bar 3: D, D(x), U, D, D(x), U', () => {
    const chart = buildChart(L('w3-02'))
    const f = assignFingering(L('w3-02'), chart)
    const bar3 = chart.events.flatMap((e, i) => {
      const ef = f.events[i]
      return e.beat >= 8 && e.beat < 12 && ef.kind !== 'rest' ? [`${ef.pick}${e.kind === 'mute' ? 'x' : ''}`] : []
    })
    expect(bar3).toEqual(['D', 'Dx', 'U', 'D', 'Dx', 'U'])
  })
})

describe('strokeAt', () => {
  it('follows the grid', () => {
    expect(strokeAt(0, 0.5, 'grid')).toBe('D')
    expect(strokeAt(0.5, 0.5, 'grid')).toBe('U')
    expect(strokeAt(1.5, 0.5, 'grid')).toBe('U')
    expect(strokeAt(0.25, 0.25, 'grid')).toBe('U')
    expect(strokeAt(0.5, 0.5, 'down')).toBe('D')
  })

  it('uses 16ths only when an onset needs them', () => {
    expect(assignFingering(L('w5-03')).grid).toBe(0.5)
    const l: Lesson = { ...L('w2-01'), id: 'x-16', bars: 1, seq: '0.5 0.6 0.7 0.8', step: 0.25 }
    const f = assignFingering(l)
    expect(f.grid).toBe(0.25)
    expect(notes(f).map((n) => n.pick)).toEqual(['D', 'U', 'D', 'U'])
  })
})

describe('seq @finger', () => {
  it('parses a finger hint', () => {
    const it0 = seq('2.7@3*2', 1)[0]
    expect(it0).toMatchObject({ k: 'note', s: 2, f: 7, finger: 3, len: 2 })
    expect(seq('2.7@T', 1)[0]).toMatchObject({ finger: 'T', len: 1 })
    expect(seq('2.7', 1)[0]).not.toHaveProperty('finger')
  })

  it('rejects a bad finger', () => {
    expect(() => seq('2.7@5', 1)).toThrow('seq: bad token')
    expect(() => seqBeats('2.7@x', 1)).toThrow('seq: bad token')
  })

  it('does not change the length', () => {
    expect(seqBeats('0.5@1*2 2.7*2', 1)).toBe(seqBeats('0.5*2 2.7*2', 1))
  })
})

describe('firstPhrase', () => {
  const fp = (id: string) => firstPhrase(buildChart(L(id)))
  it('finds the demo phrase', () => {
    expect(fp('w5-04')).toEqual({ from: 0, to: 6 })
    expect(fp('w6-01')).toEqual({ from: 0, to: 3 })
    expect(fp('w3-05')).toEqual({ from: 4, to: 12 })
    expect(fp('w2-01')).toEqual({ from: 0, to: 8 })
    expect(fp('w1-02')).toEqual({ from: 0, to: 8 })
  })
})

describe('handFrame', () => {
  const frame = (id: string, beat: number) => {
    const chart = buildChart(L(id))
    return handFrame(chart, fingeringFor(L(id), chart), beat)
  }

  it('keeps the index anchored under the pinky (w5-01)', () => {
    const h = frame('w5-01', 1.2)
    expect(h.tips.map((t) => t.finger)).toEqual([1, 2, 3, 4])
    expect(h.tips[3]).toMatchObject({ string: 0, fret: 8, down: true, active: true })
    expect(h.tips[0]).toMatchObject({ string: 0, fret: 5, down: true, active: false })
    expect(h.tips[1]).toMatchObject({ fret: 6, down: false })
    expect(h.tips[2]).toMatchObject({ fret: 7, down: false })
    expect(h.pos).toBe(5)
    expect(h.eventId).toBe(1)
    expect(h.sinceBeat).toBeCloseTo(0.2)
  })

  it('pushes with the fingers behind a bend (w6-03)', () => {
    const h = frame('w6-03', 2.5)
    expect(h.tips[2]).toMatchObject({ string: 3, fret: 7, down: true, active: true })
    expect(h.tips[0]).toMatchObject({ string: 3, fret: 5, down: true, active: false })
    expect(h.tips[1]).toMatchObject({ string: 3, fret: 6, down: true, active: false })
  })

  it('is ready before the first note', () => {
    const h = frame('w5-01', -1)
    expect(h.eventId).toBeNull()
    expect(h.nextId).toBe(0)
    expect(h.sinceBeat).toBe(Infinity)
    expect(h.tips.every((t) => !t.down)).toBe(true)
    expect(h.tips).toHaveLength(4)
  })

  it('holds a chord shape with its barre', () => {
    const h = frame('w3-03', 1.1)
    expect(h.barre).toEqual({ fret: 5, from: 3, to: 5 })
    expect(h.tips[0]).toMatchObject({ fret: 5, down: true, active: true })
    expect(h.pick).toBe('D')
  })
})

describe('guidesOn', () => {
  const p = (guides: Prefs['guides']) => ({ guides }) as Prefs
  const w = (world: Lesson['world']) => ({ ...L('w1-02'), world })
  it('auto follows the world', () => {
    expect(guidesOn(p('auto'), w(3))).toBe(true)
    expect(guidesOn(p('auto'), w(7))).toBe(false)
    expect(guidesOn(p('off'), w(1))).toBe(false)
    expect(guidesOn(p('on'), w(8))).toBe(true)
  })
})

describe('every lesson', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s has a valid fingering', (_id, l) => {
    expect(validateFingering(l)).toEqual([])
    const chart: Chart = buildChart(l)
    const f = assignFingering(l, chart)
    expect(f.events).toHaveLength(chart.events.length)
    chart.events.forEach((e, i) => expect(f.events[i].kind).toBe(e.kind))
    expect(f.calls.length).toBe(chart.calls.length)
  })

  it('fingeringFor caches per chart', () => {
    const chart = buildChart(L('w5-01'))
    expect(fingeringFor(L('w5-01'), chart)).toBe(fingeringFor(L('w5-01'), chart))
  })

  it('validation flags a thumb hint', () => {
    const l: Lesson = { ...L('w2-01'), id: 'x-thumb', bars: 1, seq: '0.5@T 0.6 0.7 0.8', step: 1 }
    expect(validateFingering(l)).toEqual(['note 0: thumb is not used in beginner lessons'])
  })
})

describe('loop slices', () => {
  it('keep the @1 hints', () => {
    const l = L('w2-03')
    const sliced = sliceChart(buildChart(l), 1, 2, 2)
    const first = sliced.events[0]
    expect(first.kind === 'note' && first.finger).toBe(1)
    const f = assignFingering(l, sliced)
    expect(notes(f).map((n) => n.finger)).toEqual([1, 3, 1, 3, 1, 3, 1, 3])
  })
})
