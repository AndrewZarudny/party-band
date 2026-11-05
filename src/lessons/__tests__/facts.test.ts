import { describe, expect, it } from 'vitest'
import type { PickInput } from '../facts/pick'
import { FACTS, RECENT_MAX, factById, pickLines, pushRecent, validateFacts } from '../facts/pick'
import { emptyCounts } from '../scoring'
import { result } from './fixtures'

const LEAK = /NaN|undefined|Infinity|\[object|null/

function input(o: { bpm?: number; spread?: number | null; mean?: number | null; score?: number; passed?: boolean; age?: number | null; at?: number; hour?: number; streak?: number; type?: PickInput['lessonType']; prev?: boolean } = {}): PickInput {
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
  const streak = o.streak ?? 1
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
    streak: { before: streak - 1, after: streak, counted: true },
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
        for (const score of [40, 75, 86, 97]) out.push(input({ bpm, spread, mean, score, age, at: at++, hour: at % 24, streak: 1 + (at % 9), prev: at % 2 === 0 }))
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
