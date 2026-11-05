import { describe, expect, it } from 'vitest'
import type { PickInput } from '../facts/pick'
import { FACTS, RECENT_MAX, factById, pickLines, pushRecent, validateFacts } from '../facts/pick'
import { emptyCounts } from '../scoring'
import { result } from './fixtures'

const LEAK = /NaN|undefined|Infinity|\[object|null/

function input(o: { bpm?: number; spread?: number | null; mean?: number | null; score?: number; passed?: boolean; age?: number | null; at?: number; hour?: number; session?: number; away?: number | null; type?: PickInput['lessonType']; prev?: boolean } = {}): PickInput {
  const counts = { ...emptyCounts(), perfect: 16, good: 4, miss: 1 }
  const score = o.score ?? 80
  const r = result({
    lessonId: 'w2-01',
    at: o.at ?? 1,
    bpm: o.bpm ?? 80,
    score,
    passed: o.passed ?? score >= 60,
    counts,
    bestChain: 14,
    spreadMs: o.spread === undefined ? 25 : o.spread,
    meanErrMs: o.mean === undefined ? -10 : o.mean,
    meanAbsErrMs: 30,
    calibrated: true,
  })
  const session = o.session ?? 1
  return {
    result: r,
    lessonType: o.type ?? 'notes',
    boss: false,
    step: 1,
    prev: o.prev ? { score: score - 10, spreadMs: 40, bpm: (o.bpm ?? 80) - 5, bestChain: 4 } : null,
    bestBefore: o.prev ? score - 10 : null,
    bestChainBefore: 4,
    flat: 0,
    failedBefore: false,
    firstBeatPass: false,
    passedBefore: 3,
    passedAfter: 4,
    sessions: { before: session - 1, after: session, counted: true },
    away: o.away === undefined ? null : o.away,
    weeks: 0,
    totalSecBefore: 0,
    totalSecAfter: 600,
    recent: [],
    age: o.age === undefined ? null : o.age,
    calibrated: true,
    hour: o.hour ?? 18,
  }
}

/** A wide sweep of runs for one age. */
function sweep(age: number | null): PickInput[] {
  const out: PickInput[] = []
  let at = 1
  for (const bpm of [45, 60, 72, 90, 110, 130, 150, 180])
    for (const spread of [null, 8, 18, 30, 45, 70])
      for (const mean of [null, -45, -12, 3, 25])
        for (const score of [40, 75, 86, 97]) out.push(input({ bpm, spread, mean, score, age, at: at++, hour: at % 24, session: 1 + (at % 30), away: at % 5 === 0 ? 9 : 1, prev: at % 2 === 0 }))
  return out
}
const idsOf = (xs: PickInput[]) => new Set(xs.flatMap((x) => pickLines(x).flatMap((l) => (l.factId ? [l.factId] : []))))

describe('facts.json', () => {
  it('validateFacts finds no problems', () => {
    expect(validateFacts()).toEqual([])
    expect(FACTS.length).toBeGreaterThan(0)
  })

  it('reports duplicates, missing sources and missing named facts', () => {
    const f = FACTS[0]
    const bad = validateFacts([f, { ...f, source_url: '' }])
    expect(bad).toContain(`duplicate id ${f.id}`)
    expect(bad).toContain(`${f.id} has no source_url`)
    expect(bad.some((m) => m.startsWith('rule names missing fact'))).toBe(true)
  })
})

describe('pickLines', () => {
  it('the same run always gives the same lines', () => {
    const x = input({ at: 42 })
    expect(pickLines(x)).toEqual(pickLines(x))
    expect(pickLines(x).length).toBeGreaterThan(0)
  })

  it('at most 2 lines, never two from one category, never broken text', () => {
    for (const x of sweep(30)) {
      const lines = pickLines(x)
      expect(lines.length).toBeLessThanOrEqual(2)
      for (const l of lines) {
        expect(l.text).not.toMatch(LEAK)
        expect(l.text.length).toBeGreaterThan(10)
      }
      const cats = lines.map((l) => (l.factId ? factById(l.factId)!.category : 'progress'))
      expect(new Set(cats).size).toBe(cats.length)
    }
  })

  it('skips facts shown lately when there is anything else', () => {
    const x = input({ at: 7 })
    const first = pickLines(x).flatMap((l) => (l.factId ? [l.factId] : []))
    const again = pickLines({ ...x, recent: first }).flatMap((l) => (l.factId ? [l.factId] : []))
    expect(again.some((id) => first.includes(id))).toBe(false)
  })

  it('age rules: no age-band comparisons for kids or teens, no "grown-up" lines for kids', () => {
    const adult = idsOf(sweep(30))
    const teen = idsOf(sweep(15))
    const kid = idsOf(sweep(9))
    // the adult sweep does reach these facts, so their absence below means something
    for (const id of ['tba-01', 'tba-12']) expect(adult.has(id)).toBe(true)
    for (const id of ['tba-01', 'tba-13']) {
      expect(teen.has(id)).toBe(false)
      expect(kid.has(id)).toBe(false)
    }
    for (const id of ['tba-08', 'tba-12']) expect(kid.has(id)).toBe(false)
  })

  it('the recent ring keeps the newest 10, without repeats', () => {
    const recent = Array.from({ length: RECENT_MAX }, (_, i) => `f${i}`)
    const next = pushRecent(recent, [
      { text: 'a', factId: 'f3' },
      { text: 'b', factId: 'new' },
      { text: 'c', factId: null },
    ])
    expect(next).toHaveLength(RECENT_MAX)
    expect(next.slice(-2)).toEqual(['f3', 'new'])
    expect(next.filter((id) => id === 'f3')).toHaveLength(1)
  })
})

describe('session milestones', () => {
  const texts = (x: PickInput) => pickLines({ ...x, recent: [] }).map((l) => l.text)
  const sweepSessions = (n: number, away: number | null) => Array.from({ length: 40 }, (_, i) => texts(input({ session: n, away, at: 1000 + i, bpm: 300, spread: null, mean: null })))

  it('SUE lines on sessions 19 and 28, never day counts or sleep claims', () => {
    expect(sweepSessions(19, 1).flat().some((t) => t.startsWith('Session 19!'))).toBe(true)
    expect(sweepSessions(28, 1).flat().some((t) => t.startsWith('28 sessions!'))).toBe(true)
    const all = [2, 7, 19, 28, 66].flatMap((n) => sweepSessions(n, 1)).flat()
    expect(all.some((t) => /every day|night's sleep|Nap tip|in a row|streak is/i.test(t))).toBe(false)
  })

  it('comeback lines only after 7 or more days away', () => {
    const back = sweepSessions(5, 9).flat()
    const near = sweepSessions(5, 2).flat()
    const comeback = /Welcome back|Missing a session|Good things come back/
    expect(back.some((t) => comeback.test(t))).toBe(true)
    expect(near.some((t) => comeback.test(t))).toBe(false)
    expect(back.some((t) => t.includes("Missing a day"))).toBe(false)
  })
})