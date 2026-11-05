import { describe, expect, it } from 'vitest'
import { LESSONS } from '../data'
import { buildChart } from '../charts'
import { assignFingering } from '../fingering'
import { barAt, beatToPoint, overviewLayout } from '../ui/teach/layout'
import { easeIn, easeInOut, easeOut, easeOutBack, Glide, pendulum } from '../ui/teach/motion'
import { BASICS, basicsCard, basicsFor, strums } from '../ui/teach/basics'
import { DemoClock } from '../ui/teach/clock'
import type { LeadVoice } from '../synth'
import { loopBeat, phraseLabel, stepCaption, stepsOf } from '../ui/teach/phrase'

const lesson = (id: string) => {
  const l = LESSONS.find((x) => x.id === id)
  if (!l) throw new Error('no lesson ' + id)
  return l
}

describe('overviewLayout', () => {
  it('fits 2, 3 or 4 bars per row by width', () => {
    expect(overviewLayout(8, 375).barsPerRow).toBe(2)
    expect(overviewLayout(8, 600).barsPerRow).toBe(3)
    expect(overviewLayout(8, 800).barsPerRow).toBe(4)
    expect(overviewLayout(8, 375).rows).toBe(4)
  })
  it('gives equal bar widths inside 8 px padding', () => {
    const l = overviewLayout(5, 600)
    expect(l.bars[0].x).toBe(8)
    expect(l.bars[0].w).toBeCloseTo((600 - 16) / 3)
    expect(l.bars[3]).toMatchObject({ row: 1, x: 8 })
    expect(l.height).toBe(2 * l.rowH)
  })
})

describe('beatToPoint', () => {
  const l = overviewLayout(8, 375)
  it('puts beat 0 at the first bar plus 10', () => {
    expect(beatToPoint(l, 0)).toEqual({ row: 0, x: l.bars[0].x + 10 })
  })
  it('puts beat 6 in the middle of bar 1 on row 0', () => {
    const b = l.bars[1]
    const p = beatToPoint(l, 6)
    expect(p.row).toBe(0)
    expect(p.x).toBeCloseTo(b.x + 10 + 0.5 * (b.w - 16))
  })
  it('clamps beats outside the chart', () => {
    expect(beatToPoint(l, -5)).toEqual(beatToPoint(l, 0))
    const last = l.bars[7]
    expect(beatToPoint(l, 999)).toEqual({ row: 3, x: last.x + 10 + (last.w - 16) })
  })
})

describe('barAt', () => {
  const l = overviewLayout(5, 375)
  it('finds the bar under a point', () => {
    expect(barAt(l, 20, 10)).toBe(0)
    expect(barAt(l, l.bars[1].x + 5, 50)).toBe(1)
    expect(barAt(l, 20, l.rowH * 2 + 5)).toBe(4)
  })
  it('misses the gutters, the empty slot and below the last row', () => {
    expect(barAt(l, 3, 10)).toBeNull()
    expect(barAt(l, 372, 10)).toBeNull()
    expect(barAt(l, l.bars[1].x + 5, l.rowH * 2 + 5)).toBeNull() // row 2 has one bar
    expect(barAt(l, 20, l.rowH * 3 + 1)).toBeNull()
  })
})

describe('motion', () => {
  it('swings the pendulum through the string on each grid slot', () => {
    const g = 0.4
    const a = pendulum(0, g, 30)
    expect(a.y).toBeCloseTo(0)
    expect(a.dir).toBe('D')
    expect(pendulum(g / 2, g, 30).y).toBeCloseTo(30)
    const c = pendulum(g, g, 30)
    expect(c.y).toBeCloseTo(0)
    expect(c.dir).toBe('U')
    expect(pendulum(2 * g, g, 30).dir).toBe('D')
  })
  it('eases from 0 to 1, and the back ease overshoots then settles', () => {
    for (const e of [easeIn, easeOut, easeInOut]) {
      expect(e(0)).toBe(0)
      expect(e(1)).toBe(1)
      expect(e(0.5)).toBeGreaterThan(0)
      expect(e(0.5)).toBeLessThan(1)
    }
    expect(easeOut(0.3)).toBeGreaterThan(0.3) // fast start
    expect(easeIn(0.3)).toBeLessThan(0.3) // slow start
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 2)
    expect(easeOutBack(1)).toBeCloseTo(1)
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map((k) => easeOutBack(k)))).toBeGreaterThan(1)
  })
  it('glides to a new target over its time, from wherever it was', () => {
    const gl = new Glide(0)
    gl.set(10, 1, 1, (k) => k)
    expect(gl.at(1)).toBe(0)
    expect(gl.at(1.5)).toBeCloseTo(5)
    expect(gl.at(3)).toBe(10)
    gl.set(0, 1.5, 1, (k) => k) // retarget mid-way: starts from 5
    expect(gl.at(1.5)).toBeCloseTo(5)
    expect(gl.at(2)).toBeCloseTo(2.5)
  })
})

describe('basicsFor', () => {
  const pick = (id: string) => {
    const l = lesson(id)
    const chart = buildChart(l)
    return basicsFor(l, chart, assignFingering(l, chart))
  }
  it('picks the two cards each lesson needs most', () => {
    expect(pick('w1-03')).toEqual(['fretMute', 'grip'])
    expect(pick('w4-03')).toEqual(['pickMute', 'fret'])
    expect(pick('w5-03')).toEqual(['wrist', 'fret'])
    expect(pick('w1-04')).toEqual(['fretMute', 'fret'])
  })
  it('the wrist card talks about the elbow for strumming lessons only', () => {
    const strum = (id: string) => strums(buildChart(lesson(id)))
    expect(strum('w3-01')).toBe(true)
    expect(strum('w5-03')).toBe(false)
    expect(basicsCard('wrist', true).copy).toMatch(/elbow/)
    expect(basicsCard('wrist', true).copy).not.toMatch(/still/)
    expect(basicsCard('wrist', false)).toBe(BASICS.wrist)
    expect(basicsCard('grip', true)).toBe(BASICS.grip)
  })
  it('never gives more than two', () => {
    for (const l of LESSONS) {
      if (l.type === 'sync') continue
      const chart = buildChart(l)
      expect(basicsFor(l, chart, assignFingering(l, chart)).length).toBeLessThanOrEqual(2)
    }
  })
})

describe('demo phrase words', () => {
  it('captions each step with finger, fret and stroke', () => {
    const l = lesson('w5-01')
    const chart = buildChart(l)
    const steps = stepsOf(chart, assignFingering(l, chart), 0, 2)
    expect(steps.map((s, i) => stepCaption(s, i + 1))).toEqual(['1. Index, fret 5, down', '2. Pinky, fret 8, down'])
  })
  it('says "no pick" for a hammer and names open strings and chords', () => {
    const w6 = lesson('w6-01')
    const c6 = buildChart(w6)
    const s6 = stepsOf(c6, assignFingering(w6, c6))
    expect(stepCaption(s6[1], 2)).toBe('2. Ring, fret 7, hammer (no pick)')
    const w1 = lesson('w1-02')
    const c1 = buildChart(w1)
    expect(stepCaption(stepsOf(c1, assignFingering(w1, c1))[0], 1)).toBe('1. Open low E string, down')
    const w3 = lesson('w3-05')
    const c3 = buildChart(w3)
    expect(stepCaption(stepsOf(c3, assignFingering(w3, c3))[0], 1)).toBe('1. G chord, strum down')
  })
  it('reads a phrase aloud, naming the string only when it changes', () => {
    const l = lesson('w2-01')
    const chart = buildChart(l)
    const label = phraseLabel(stepsOf(chart, assignFingering(l, chart), 0, 2))
    expect(label).toBe('First phrase: index on low E fret 5, pick down; middle on fret 6, pick down')
  })
  it('loops the phrase with one beat of silence', () => {
    const spb = 0.5
    expect(loopBeat(0, spb, 0, 6)).toEqual({ beat: 0, gap: false, pass: 0 })
    expect(loopBeat(3.1, spb, 0, 6).gap).toBe(true) // beat 6.2: the silent beat
    const next = loopBeat(3.5, spb, 0, 6) // 7 beats in = the top of pass 2
    expect(next.pass).toBe(1)
    expect(next.beat).toBeCloseTo(0)
    expect(loopBeat(1, spb, 4, 12).beat).toBe(6) // a phrase that starts mid-chart
  })
})

describe('DemoClock sound', () => {
  it('sends each note once per pass, even after hundreds of notes', () => {
    const l = lesson('w5-01')
    const chart = buildChart(l)
    const clock = new DemoClock(chart, assignFingering(l, chart), 120)
    const ctx = { currentTime: 0 }
    clock.setAudio(ctx as unknown as AudioContext)
    clock.beat() // starts the loop
    const sent: string[] = []
    const lead = { note: (at: number, midi: number) => sent.push(`${at.toFixed(4)}:${midi}`) } as unknown as LeadVoice
    for (let t = 0; t < 300; t += 1 / 60) {
      ctx.currentTime = t
      clock.schedule(lead)
    }
    expect(sent.length).toBeGreaterThan(300)
    expect(new Set(sent).size).toBe(sent.length)
  })
})