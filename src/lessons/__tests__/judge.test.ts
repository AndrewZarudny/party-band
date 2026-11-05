import { describe, expect, it } from 'vitest'
import type { Chart } from '../types'
import { Judge, WINDOWS, evidenceFor, voteMidi, windowsFor } from '../judge'
import { chartOf, chord, frames, note, onset } from './fixtures'

const SPB = 0.5
const judgeFor = (chart: Chart, o: { octaveOk?: boolean; listenBars?: number[] } = {}) =>
  new Judge(chart, { start: 0, secPerBeat: SPB, windows: WINDOWS.normal, octaveOk: o.octaveOk ?? false, restGate: () => 0.01, listenBars: o.listenBars ?? [] })

// Three notes a second apart: wide enough that no window is shrunk.
const three = () => chartOf([note(0, 0, 0, 0), note(1, 2, 1, 0), note(2, 4, 2, 0)])

describe('windowsFor', () => {
  it('widens for easy timing and no calibration, capped at 2x', () => {
    expect(windowsFor('normal', false, true)).toEqual(WINDOWS.normal)
    expect(windowsFor('normal', true, true).ok).toBeCloseTo(WINDOWS.normal.ok * 1.5)
    expect(windowsFor('normal', true, false).ok).toBeCloseTo(WINDOWS.normal.ok * 2)
    expect(windowsFor('tight', true, false).lateExtra).toBe(WINDOWS.tight.lateExtra)
  })
})

describe('Judge hits', () => {
  it('grades a hit on the beat perfect', () => {
    const j = judgeFor(three())
    j.onset(onset(0, 40))
    const out = j.tick(0.01)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ eventId: 0, verdict: 'perfect', errMs: 0, pitchOk: true, credit: 1 })
  })

  it('grades good, early and late by the windows (late side gets lateExtra)', () => {
    const j = judgeFor(three())
    j.onset(onset(1 + 0.1, 45)) // +100 ms, minus 20 lateExtra = 80: good
    j.onset(onset(-0.15, 40)) // -150 ms: ok, early
    j.onset(onset(2 + 0.17, 50)) // +170 ms - 20 = 150: ok, late
    const out = j.tick(3)
    const by = new Map(out.map((r) => [r.eventId, r]))
    expect(by.get(0)).toMatchObject({ verdict: 'early', grade: 'ok', errMs: -150 })
    expect(by.get(1)).toMatchObject({ verdict: 'good', errMs: 100 })
    expect(by.get(2)).toMatchObject({ verdict: 'late', grade: 'ok', errMs: 170 })
  })

  it('reports a miss once the late window and the vote time have passed', () => {
    const j = judgeFor(three())
    // late bound = 0 + (180 + 20) ms; then 120 ms for the vote
    expect(j.tick(0.3)).toEqual([])
    const out = j.tick(0.33)
    expect(out[0]).toMatchObject({ eventId: 0, verdict: 'miss', credit: 0, errMs: null })
  })

  it('a wrong note is held, then reported wrong with little credit', () => {
    const j = judgeFor(three())
    j.onset(onset(0, 41))
    expect(j.tick(0.01)).toEqual([])
    const out = j.tick(0.25) // hold 120 ms + vote 120 ms
    expect(out[0]).toMatchObject({ eventId: 0, verdict: 'wrong', pitchOk: false, played: 41, credit: 0.15 })
  })

  it('the right note inside the hold replaces the wrong one, keeping the closer timing', () => {
    const j = judgeFor(three())
    j.onset(onset(-0.02, 41))
    j.tick(-0.01)
    j.onset(onset(0.05, 40))
    const out = j.tick(0.06)
    expect(out[0]).toMatchObject({ eventId: 0, verdict: 'perfect', errMs: -20, pitchOk: true })
    expect(j.tick(0.5).some((r) => r.eventId === 0)).toBe(false)
  })

  it('counts an onset far from any note as an extra', () => {
    const j = judgeFor(three())
    j.onset(onset(0.6, 40))
    j.tick(0.7)
    expect(j.extras).toBe(1)
  })

  it('counts playing in a listen bar, and ignores that onset', () => {
    const c = chartOf([note(0, 4, 0, 0)], 2)
    const j = judgeFor(c, { listenBars: [0] })
    j.onset(onset(0.5, 40))
    j.tick(0.6)
    expect(j.listenViolations).toBe(1)
    expect(j.extras).toBe(0)
  })

  it('finish() closes every open event as a miss', () => {
    const j = judgeFor(three())
    j.onset(onset(0, 40))
    const s = j.finish()
    expect(s.results.map((r) => r.verdict)).toEqual(['perfect', 'miss', 'miss'])
  })
})

describe('octave slips', () => {
  // The pitch tracker heard an octave up on a low string.
  const heardOctave = (c: Chart, eventMidi: number, o: { octaveOk?: boolean } = {}) => {
    const j = judgeFor(c, o)
    for (const f of frames(0, 12, eventMidi + 12)) j.frame(f)
    j.onset(onset(0, eventMidi + 12, 'attack'))
    return j.tick(0.5)
  }

  it('accepts an octave jump on the low E and A strings, marked as a slip', () => {
    const out = heardOctave(chartOf([note(0, 0, 0, 0)]), 40)
    expect(out[0]).toMatchObject({ verdict: 'perfect', octaveSlip: true })
  })

  it('does not accept it on higher strings', () => {
    const out = heardOctave(chartOf([note(0, 0, 3, 0)]), 55)
    expect(out[0]).toMatchObject({ verdict: 'wrong' })
  })

  it('does not accept it when the lesson plays that octave on purpose', () => {
    const c = chartOf([note(0, 0, 0, 0), note(1, 4, 2, 2)]) // D string fret 2 = E an octave up
    expect(heardOctave(c, 40)[0]).toMatchObject({ eventId: 0, verdict: 'wrong' })
  })

  it('octaveOk lessons take any octave, without a slip mark', () => {
    const out = heardOctave(chartOf([note(0, 0, 3, 0)]), 55, { octaveOk: true })
    expect(out[0].verdict).toBe('perfect')
    expect(out[0].octaveSlip).toBeUndefined()
  })
})

describe('evidence for ringing strings', () => {
  // The vote hears the old string (A, 45) longer, but the new note (E, 40) shows clearly after it settles.
  const ringing = (t: number) => [...frames(t, 8, 45), ...frames(t + 0.08, 4, 40)]

  it('voteMidi takes the most common pitch; evidenceFor counts only settled frames', () => {
    const fs = ringing(1)
    const o = onset(1, 45, 'attack')
    expect(voteMidi(fs, o).midi).toBe(45)
    const ev = evidenceFor(fs, o, 40)
    expect(ev.n).toBe(7)
    expect(ev.exact).toBeCloseTo(4 / 7)
  })

  it('accepts the expected note when it shows up clearly', () => {
    const j = judgeFor(chartOf([note(0, 2, 0, 0)]))
    for (const f of ringing(1)) j.frame(f)
    j.onset(onset(1, 45, 'attack'))
    expect(j.tick(1.5)[0]).toMatchObject({ verdict: 'perfect', pitchOk: true })
  })

  it('does not use that evidence for a repeated note (the last one may still ring)', () => {
    const j = judgeFor(chartOf([note(0, 0, 0, 0), note(1, 2, 0, 0)]))
    j.onset(onset(0, 40))
    j.tick(0.01)
    for (const f of ringing(1)) j.frame(f)
    j.onset(onset(1, 45, 'attack'))
    const out = j.tick(1.5)
    expect(out.find((r) => r.eventId === 1)).toMatchObject({ verdict: 'wrong' })
  })
})

describe('rests', () => {
  const restChart = () => chartOf([note(0, 0, 0, 0), { id: 1, kind: 'rest', beat: 2, dur: 2 }])

  it('a quiet rest is a clean stop', () => {
    const j = judgeFor(restChart())
    for (const f of frames(1.1, 80, null, 0.001)) j.frame(f)
    const out = j.tick(2.1)
    expect(out.find((r) => r.eventId === 1)).toMatchObject({ verdict: 'clean-stop', credit: 1 })
  })

  it('a rest with the string still sounding is ringing', () => {
    const j = judgeFor(restChart())
    for (const f of frames(1.1, 80, 40, 0.1)) j.frame(f)
    const out = j.tick(2.1)
    expect(out.find((r) => r.eventId === 1)).toMatchObject({ verdict: 'ringing', credit: 0 })
  })
})

describe('settled / takeSettled', () => {
  const C = [0, 4, 7]

  it('a chord with a chroma check is reported at the strike but settles only after the check', () => {
    const c = chartOf([chord(0, 0, 'C', C, { chroma: true })])
    const j = judgeFor(c)
    j.onset(onset(0, null))
    const r = j.tick(0.01)[0]
    expect(r).toMatchObject({ verdict: 'perfect', chordOk: null })
    expect(j.settled(0)).toBe(false)
    expect(j.takeSettled()).toEqual([])

    const off = new Float32Array(12)
    for (const p of [1, 6, 10]) off[p] = 1
    for (const dt of [0.2, 0.25, 0.3, 0.35, 0.4]) j.addChroma(j.chromaWindows(dt), off)
    j.tick(0.3)
    expect(j.settled(0)).toBe(false)
    j.tick(0.5)
    expect(r.chordOk).toBe(false)
    expect(r.credit).toBeCloseTo(0.7)
    expect(j.settled(0)).toBe(true)
    expect(j.takeSettled()).toEqual([0])
    expect(j.takeSettled()).toEqual([])
  })

  it('a ringing chord that matches passes the check', () => {
    const j = judgeFor(chartOf([chord(0, 0, 'C', C, { chroma: true })]))
    j.onset(onset(0, null))
    const r = j.tick(0.01)[0]
    const on = new Float32Array(12)
    for (const p of C) on[p] = 1
    for (const dt of [0.2, 0.25, 0.3, 0.35, 0.4]) j.addChroma(j.chromaWindows(dt), on)
    j.tick(0.5)
    expect(r.chordOk).toBe(true)
    expect(r.credit).toBe(1)
  })

  it('a chord without a check is settled at once and never listed by takeSettled', () => {
    const j = judgeFor(chartOf([chord(0, 0, 'C', C)]))
    j.onset(onset(0, null))
    j.tick(0.01)
    expect(j.settled(0)).toBe(true)
    j.tick(1)
    expect(j.takeSettled()).toEqual([])
  })

  it('an unplayed event is not settled', () => {
    const j = judgeFor(three())
    expect(j.settled(0)).toBe(false)
  })
})
