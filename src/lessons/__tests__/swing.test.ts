import { describe, expect, it } from 'vitest'
import type { Autoplay, Chart } from '../types'
import { SWING, swungBeat } from '../clock'
import { Judge, WINDOWS } from '../judge'
import { LessonRun } from '../run'
import { chartOf, lesson, note, onset } from './fixtures'

describe('swungBeat', () => {
  it('pushes off-beat 8ths by SWING / 2 of a beat when the feel swings', () => {
    expect(SWING / 2).toBeCloseTo(0.165)
    expect(swungBeat(0.5, true)).toBeCloseTo(0.665)
    expect(swungBeat(3.5, true)).toBeCloseTo(3.665)
  })

  it('leaves on-beats, 16ths and straight feels alone', () => {
    for (const b of [0, 1, 2, 7]) expect(swungBeat(b, true)).toBe(b)
    for (const b of [0.25, 0.75, 1.25]) expect(swungBeat(b, true)).toBe(b)
    expect(swungBeat(0.5, false)).toBe(0.5)
  })

  it('works on count-in (negative) beats', () => {
    expect(swungBeat(-0.5, true)).toBeCloseTo(-0.335)
    expect(swungBeat(-1, true)).toBe(-1)
  })
})

describe('Judge on the swung grid', () => {
  // 60 BPM: one beat a second, so the push is 165 ms
  const chart = () => chartOf([note(0, 0.5, 0, 0)])
  const judgeFor = (c: Chart, swing: boolean) =>
    new Judge(c, { start: 0, secPerBeat: 1, windows: WINDOWS.normal, octaveOk: false, restGate: () => 0.01, listenBars: [], swing })

  it('an off-beat hit at the swung time is perfect', () => {
    const j = judgeFor(chart(), true)
    j.onset(onset(0.665, 40))
    expect(j.tick(0.7)[0]).toMatchObject({ verdict: 'perfect', errMs: 0 })
  })

  it('the same hit at the straight time is about 165 ms early', () => {
    const j = judgeFor(chart(), true)
    j.onset(onset(0.5, 40))
    const r = j.tick(0.6)[0]
    expect(r.errMs).toBe(-165)
    expect(r.verdict).not.toBe('perfect')
  })

  it('without swing nothing changes', () => {
    const j = judgeFor(chart(), false)
    j.onset(onset(0.5, 40))
    expect(j.tick(0.6)[0]).toMatchObject({ verdict: 'perfect', errMs: 0 })
  })
})

describe('LessonRun swing', () => {
  const blues = lesson({ backing: { feel: 'blues', chords: ['A7'] } })
  const pop = lesson({ backing: { feel: 'pop', chords: ['A'] } })

  it('swings with a swinging band feel, or in shuffle mode', () => {
    const base = { speed: 1, easyTiming: false, backingOn: true, keyboard: true }
    expect(new LessonRun({ ...base, lesson: blues }).swing).toBe(true)
    expect(new LessonRun({ ...base, lesson: pop }).swing).toBe(false)
    expect(new LessonRun({ ...base, lesson: pop, shuffle: true }).swing).toBe(true)
    expect(new LessonRun({ ...base, lesson: lesson(), shuffle: true }).swing).toBe(true)
  })

  it('plans autoplay hits on the swung grid', () => {
    const chart = chartOf([note(0, 0, 0, 0), note(1, 0.5, 0, 2), note(2, 1, 0, 3)])
    const run = new LessonRun({ lesson: blues, chart, speed: 1, easyTiming: false, backingOn: false, keyboard: true })
    const inside = run as unknown as { clock: { timeOfBeat: (b: number) => number }; planAutoplay: (m: Autoplay) => { t: number }[] }
    inside.clock = { timeOfBeat: (b) => b } // one second a beat
    const ts = inside.planAutoplay('perfect').map((p) => p.t)
    expect(ts[0]).toBeCloseTo(0)
    expect(ts[1]).toBeCloseTo(0.665)
    expect(ts[2]).toBeCloseTo(1)
  })
})
