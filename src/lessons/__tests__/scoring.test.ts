import { describe, expect, it } from 'vitest'
import { ChainMeter, barAccuracy, buildResult, goodOrBetter, noteScore, starsFor } from '../scoring'
import { chartOf, jr, lesson, note } from './fixtures'
import type { JudgeResult } from '../types'

const L = lesson({ stars: [60, 80, 95], pass: 60 })

describe('starsFor', () => {
  it('counts the star marks reached', () => {
    expect(starsFor(L, 59, false, 1, true)).toBe(0)
    expect(starsFor(L, 60, true, 1, true)).toBe(1)
    expect(starsFor(L, 80, true, 1, true)).toBe(2)
    expect(starsFor(L, 95, true, 1, true)).toBe(3)
  })

  it('needs the extra for the 3rd star', () => {
    expect(starsFor(L, 99, true, 1, false)).toBe(2)
  })

  it('caps slower practice at 2 stars, overdrive keeps 3', () => {
    expect(starsFor(L, 99, true, 0.95, true)).toBe(2)
    expect(starsFor(L, 99, true, 1.1, true)).toBe(3)
  })

  it('a failed run gets no stars whatever the score', () => {
    expect(starsFor(L, 99, false, 1, true)).toBe(0)
  })
})

describe('noteScore', () => {
  const rs = (credits: number[]): JudgeResult[] => credits.map((c, i) => jr(i, 'note', 'good', 0, { credit: c }))

  it('is the mean credit in percent', () => {
    expect(noteScore(L, { results: rs([1, 1, 0.5, 0.5]), extras: 0, listenViolations: 0 })).toBe(75)
    expect(noteScore(L, { results: [], extras: 0, listenViolations: 0 })).toBe(0)
  })

  it('takes off extras (not on easy timing, at most 10) and listen violations (2 each, at most 10)', () => {
    const results = rs([1, 1, 1, 1])
    expect(noteScore(L, { results, extras: 3, listenViolations: 0 })).toBe(97)
    expect(noteScore(L, { results, extras: 30, listenViolations: 0 })).toBe(90)
    expect(noteScore(lesson({ timing: 'easy' }), { results, extras: 30, listenViolations: 0 })).toBe(100)
    expect(noteScore(L, { results, extras: 0, listenViolations: 2 })).toBe(96)
    expect(noteScore(L, { results, extras: 0, listenViolations: 9 })).toBe(90)
  })
})

describe('goodOrBetter and barAccuracy', () => {
  it('a hit with a failed chord or technique check is not good', () => {
    expect(goodOrBetter(jr(0, 'chord', 'perfect', 0, { chordOk: false }))).toBe(false)
    expect(goodOrBetter(jr(0, 'note', 'good', 0, { techOk: false }))).toBe(false)
    expect(goodOrBetter(jr(0, 'rest', 'clean-stop', null))).toBe(true)
    expect(goodOrBetter(jr(0, 'note', 'late', 50))).toBe(false)
  })

  it('gives the share per bar, null for an empty bar', () => {
    const c = chartOf([note(0, 0, 0, 0), note(1, 1, 0, 0), note(2, 8, 0, 0)], 3)
    const acc = barAccuracy(c, [jr(0, 'note', 'perfect', 0), jr(1, 'note', 'miss', null), jr(2, 'note', 'good', 0)])
    expect(acc).toEqual([0.5, null, 1])
  })
})

describe('ChainMeter', () => {
  it('counts the chain, breaks on a miss, calls milestones once', () => {
    const m = new ChainMeter()
    const words: (string | null)[] = []
    for (let i = 0; i < 8; i++) words.push(m.push(jr(i, 'note', 'perfect', 0), i))
    expect(words[7]).toBe('Hot!')
    m.push(jr(8, 'note', 'miss', null), 8)
    expect(m.chain).toBe(0)
    expect(m.best).toBe(8)
    expect(m.perfectRun).toBe(8)
    for (let i = 0; i < 8; i++) words.push(m.push(jr(i, 'note', 'good', 0), 9 + i))
    expect(words.filter((w) => w === 'Hot!')).toHaveLength(1)
  })
})

describe('buildResult', () => {
  const chain = new ChainMeter()
  const build = (results: JudgeResult[], speed = 1) => {
    const events = results.map((r) => note(r.eventId, r.eventId, 0, 0))
    return buildResult({ lesson: L, chart: chartOf(events, Math.max(1, Math.ceil(events.length / 4))), summary: { results, extras: 0, listenViolations: 0 }, improv: null, chain, bpm: 60, speed, easyTiming: false, secPerBeat: 1, playedSec: 10 })
  }

  it('gives mean error, spread and mean absolute error from 4 or more timed hits', () => {
    const r = build([jr(0, 'note', 'good', 10), jr(1, 'note', 'good', -10), jr(2, 'note', 'good', 20), jr(3, 'note', 'good', -20), jr(4, 'note', 'miss', null)])
    expect(r.meanErrMs).toBe(0)
    expect(r.spreadMs).toBe(16) // sqrt(250)
    expect(r.meanAbsErrMs).toBe(15)
  })

  it('leaves them null under 4 timed hits', () => {
    const r = build([jr(0, 'note', 'good', 10), jr(1, 'note', 'good', 30), jr(2, 'note', 'good', 50), jr(3, 'note', 'miss', null)])
    expect(r.meanErrMs).toBeNull()
    expect(r.spreadMs).toBeNull()
    expect(r.meanAbsErrMs).toBeNull()
  })

  it('a late mean shows the re-sync tip', () => {
    const rs = Array.from({ length: 12 }, (_, i) => jr(i, 'note', 'good', 60))
    const r = build(rs)
    expect(r.meanErrMs).toBe(60)
    expect(r.coachTip).toMatch(/60 ms late/)
    expect(r.clean).toBe(true)
    expect(r.passed).toBe(true)
  })

  it('finds the bar with the most slips, and a run with misses is not clean', () => {
    const rs = Array.from({ length: 12 }, (_, i) => jr(i, 'note', i >= 4 && i < 7 ? 'miss' : 'perfect', i >= 4 && i < 7 ? null : 0))
    const r = build(rs)
    expect(r.hardestBar).toBe(1)
    expect(r.clean).toBe(false)
    expect(r.counts.miss).toBe(3)
    expect(r.score).toBe(75)
  })
})
