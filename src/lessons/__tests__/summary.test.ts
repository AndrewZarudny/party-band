// The short summary at the top of "Your progress": competence feedback that agrees with the review brake.
import { describe, expect, it } from 'vitest'
import type { LessonRecord, Progress } from '../types'
import type { SkillStats } from '../../skills/data'
import { emptyStats } from '../../skills/data'
import { PLAN_PATH, lessonById } from '../data'
import { newProgress } from '../progress'
import { isReviewItem, reviewBrake, strugglingList } from '../review'
import { progressSummary } from '../metrics'
import { rec } from './fixtures'

/** Review items on the plan's path, in order. */
const ITEMS = PLAN_PATH.filter((id) => {
  const l = lessonById(id)
  return !!l && isReviewItem(l)
})
const title = (id: string) => lessonById(id)!.title

/** Passed at 70%; a session best of `best`, then a cold start at `cold` BPM that was not clean, scoring `score`. */
function failing(score: number, best = 70, cold = 50): LessonRecord {
  return rec({
    passedAt: 1,
    passedSpeed: 0.7,
    plays: 4,
    stars: 1,
    best: 70,
    review: { step: 0, due: 99, coldPasses: 0, lastColdS: 0, learned: false, coldSpeed: 0.6 },
    hist: [
      { s: 1, d: '2026-11-04', best },
      { s: 2, d: '2026-11-05', cold: { s: 2, d: '2026-11-05', bpm: cold, speed: 0.7, clean: false, score, tab: 'hidden' } },
    ],
  })
}

/** Clean from cold at full tempo in two sessions. */
function learned(): LessonRecord {
  return rec({
    passedAt: 1,
    passedSpeed: 1,
    plays: 6,
    stars: 2,
    best: 90,
    review: { step: 2, due: 99, coldPasses: 2, lastColdS: 3, learned: true, learnedAt: 1 },
    hist: [
      { s: 1, d: '2026-11-04', best: 80 },
      { s: 2, d: '2026-11-05', best: 80, cold: { s: 2, d: '2026-11-05', bpm: 80, speed: 1, clean: true, score: 92, tab: 'hidden' } },
      { s: 3, d: '2026-11-06', cold: { s: 3, d: '2026-11-06', bpm: 80, speed: 1, clean: true, score: 95, tab: 'hidden' } },
    ],
  })
}

function changes(best: Record<string, number>): SkillStats {
  const s = emptyStats()
  let n = 0
  for (const [pair, score] of Object.entries(best)) {
    s.best[`changes:${pair}`] = score
    s.history.push({ id: `c${n++}`, game: 'changes', at: n, score, detail: pair })
  }
  return s
}

const text = (lines: { label: string; text: string }[]) => lines.map((l) => `${l.label}: ${l.text}`)

describe('progressSummary', () => {
  it('shows week-1 shaped data plainly: none learned yet, the biggest gap, changes near 60, review first', () => {
    const p = newProgress()
    const scores = [8, 32, 12, 20, 16, 24, 28, 10]
    scores.forEach((s, i) => (p.lessons[ITEMS[i]] = failing(s, 60, 50)))
    // One gap is wider than the rest: the session best was 80, the cold start 48.
    p.lessons[ITEMS[3]] = failing(20, 80, 48)
    // Passed, not cold-tested yet: counted as passed, never as struggling.
    for (const id of ITEMS.slice(8, 11)) p.lessons[id] = rec({ passedAt: 1, passedSpeed: 0.8, plays: 2 })
    const lines = progressSummary(p, changes({ 'A-D': 52, 'A-E': 59, 'D-E': 47 }))

    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.length).toBeLessThanOrEqual(4)
    expect(text(lines)).toEqual([
      'Sticking: 0 of 11 lessons in review learned so far. Learned means clean from cold at full tempo in 2 separate sessions.',
      `Biggest gap: ${title(ITEMS[3])}, 80 BPM at best in a session vs 48 from cold, not clean yet.`,
      'Chord changes: A-E 59, A-D 52, D-E 47 a minute at best. A pair is done at 60.',
      "Next: Review before new lessons. 8 lessons aren't sticking yet; new ones come once a few pass their cold start.",
    ])
    // It agrees with the brake on the daily plan.
    expect(reviewBrake(p)).toBe(true)
    expect(strugglingList(p)).toHaveLength(8)
  })

  it('names the least sticky item by its cold score when no gap can be measured', () => {
    const p = newProgress()
    p.lessons[ITEMS[0]] = failing(30, 50, 50)
    p.lessons[ITEMS[1]] = failing(8, 50, 55)
    const lines = progressSummary(p, emptyStats())
    expect(text(lines)).toEqual([
      'Sticking: 0 of 2 lessons in review learned so far. Learned means clean from cold at full tempo in 2 separate sessions.',
      `Furthest to go: ${title(ITEMS[1])}: the last cold start, at 55 BPM, scored 8.`,
      'Next: 2 lessons to firm up in your review steps, alongside new lessons.',
    ])
    expect(reviewBrake(p)).toBe(false)
  })

  it('has a gentle start when nothing is passed or played yet', () => {
    const lines = progressSummary(newProgress(), emptyStats())
    expect(text(lines)).toEqual([
      'Sticking: Nothing to measure yet. Pass a lesson with notes, chords or rhythm, and a cold start in a later session shows what stuck.',
      'Next: Start with the first open lesson on the map.',
    ])
  })

  it('names what it counts: Tap In and the jams are passed on the map but have no cold start', () => {
    const p = newProgress()
    p.lessons['w1-01'] = rec({ passedAt: 1, plays: 1 })
    p.lessons['w2-05'] = rec({ passedAt: 1, plays: 2 })
    expect(text(progressSummary(p, emptyStats()))[0]).toBe(
      'Sticking: Nothing to measure yet. Pass a lesson with notes, chords or rhythm, and a cold start in a later session shows what stuck.',
    )
    p.lessons[ITEMS[0]] = failing(20)
    expect(text(progressSummary(p, emptyStats()))[0]).toMatch(/^Sticking: 0 of 1 lesson in review learned so far\./)
  })

  it('says so when everything passed is learned, and when every pair played is at 60', () => {
    const p: Progress = newProgress()
    for (const id of ITEMS.slice(0, 3)) p.lessons[id] = learned()
    const lines = progressSummary(p, changes({ 'A-D': 61, 'A-E': 60 }))
    expect(text(lines)).toEqual([
      'Sticking: All 3 lessons in review are learned: clean from cold at full tempo.',
      "Chord changes: Every pair you've played is at 60 a minute or more.",
      'Next: Something new: everything you passed has stuck.',
    ])
  })

  it('never uses streak or guilt words', () => {
    const p = newProgress()
    const scores = [8, 12, 20]
    scores.forEach((s, i) => (p.lessons[ITEMS[i]] = failing(s)))
    for (const l of progressSummary(p, changes({ 'A-E': 40 }))) expect(`${l.label} ${l.text}`).not.toMatch(/streak|missed|behind|fail|should have/i)
  })
})
