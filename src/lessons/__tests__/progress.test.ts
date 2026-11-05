import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyResult,
  dayKey,
  importProgress,
  isUnlocked,
  levelFor,
  loadProgress,
  newProgress,
  nextLesson,
  recordSkip,
  reviewDue,
  saveProgress,
  streakStatus,
  worldUnlocked,
} from '../progress'
import { lessonById } from '../data'
import { at, rec, result } from './fixtures'

const by = (id: string) => lessonById(id)!
const DAY = at('2026-11-04')
const ctx = { age: null }

describe('applyResult', () => {
  it('a first clear gives play, first clear, star, daily and streak XP', () => {
    const p = recordSkip(newProgress(), 'w1-01', DAY)
    const o = applyResult(p, by('w1-02'), result({ score: 92, stars: 2, passed: true, speed: 1 }), DAY, ctx)
    // skill round(40 * (0.4 + 0.6 * 0.92)) = 38; + first clear 20 + stars 2 * 10 + first win 40 = 118; streak day 1 x1.05
    expect(o.xp).toBe(124)
    expect(o.progress.xp).toBe(124)
    expect(o.progress.daily).toEqual({ day: '2026-11-04', xp: 124, passes: 1 })
    expect(o.lines.map((l) => l.label)).toEqual(['Play', 'New stars', 'First clear', 'First win today', 'Streak', 'Total'])
    expect(o.lines[o.lines.length - 1]).toEqual({ label: 'Total', value: '+124' })
  })

  it('slower practice and easy timing scale the XP', () => {
    const p = recordSkip(newProgress(), 'w1-01', DAY)
    const o = applyResult(p, by('w1-02'), result({ score: 92, stars: 2, passed: true, speed: 0.85, easyTiming: true }), DAY, ctx)
    expect(o.xp).toBe(Math.round(118 * 1.05 * 0.8 * 0.75))
    expect(o.lines.map((l) => l.label)).toContain('Slower practice')
    expect(o.lines.map((l) => l.label)).toContain('Easy timing')
  })

  it('a failed run gives practice XP (at least 10) and counts a fail', () => {
    const p = recordSkip(newProgress(), 'w1-01', DAY)
    const o = applyResult(p, by('w1-02'), result({ score: 10, stars: 0, passed: false, playedSec: 5 }), DAY, ctx)
    expect(o.xp).toBe(10)
    expect(o.lines).toEqual([
      { label: 'Practice', value: '+10' },
      { label: 'Total', value: '+10' },
    ])
    const r = o.progress.lessons['w1-02']
    expect(r).toMatchObject({ plays: 1, fails: 1, best: 10, stars: 0 })
    expect(r.passedAt).toBeUndefined()
    expect(o.progress.streak.days).toBe(0) // under 20 s and failed: not a practice day
  })

  it('replays the same day give less, and stars only count once', () => {
    let p = recordSkip(newProgress(), 'w1-01', DAY)
    const first = applyResult(p, by('w1-02'), result({ score: 92, stars: 2, passed: true }), DAY, ctx)
    p = first.progress
    const again = applyResult(p, by('w1-02'), result({ score: 92, stars: 2, passed: true }), DAY, ctx)
    expect(again.xp).toBeLessThan(first.xp)
    expect(again.lines.map((l) => l.label)).not.toContain('New stars')
    expect(again.lines.map((l) => l.label)).not.toContain('First clear')
    expect(again.progress.lessons['w1-02'].playsToday).toBe(2)
  })

  it('keeps the best score and stars, and unlocks the next lesson', () => {
    const p = recordSkip(newProgress(), 'w1-01', DAY)
    expect(isUnlocked(p, 'w1-03')).toBe(false)
    const o = applyResult(p, by('w1-02'), result({ score: 85, stars: 2, passed: true }), DAY, ctx)
    expect(o.unlocked).toEqual(['w1-03'])
    const o2 = applyResult(o.progress, by('w1-02'), result({ score: 70, stars: 1, passed: true }), DAY, ctx)
    expect(o2.progress.lessons['w1-02']).toMatchObject({ best: 85, stars: 2, plays: 2 })
    expect(o2.unlocked).toEqual([])
  })

  it('stores the speed trainer step on the record; the sync lesson gets none', () => {
    const p = recordSkip(newProgress(), 'w1-01', DAY)
    const o = applyResult(p, by('w1-02'), result({ score: 92, passed: true, speed: 0.85 }), DAY, ctx)
    expect(o.speed).toEqual({ played: 0.85, next: 0.9, topBefore: 0, topAfter: 0.85 })
    expect(o.progress.lessons['w1-02']).toMatchObject({ speed: 0.9, miss: 0, topSpeed: 0.85 })
    const s = applyResult(newProgress(), by('w1-01'), result({ lessonId: 'w1-01', score: 90, passed: true }), DAY, ctx)
    expect(s.speed).toBeNull()
    expect(s.progress.lessons['w1-01'].speed).toBeUndefined()
  })

  it('moves the review box on a pass on or after the due day, back to 0 on a failed review', () => {
    let p = recordSkip(newProgress(), 'w1-01', at('2026-11-01'))
    p = applyResult(p, by('w1-02'), result({ score: 92, passed: true }), at('2026-11-01'), ctx).progress
    expect(p.lessons['w1-02'].box).toBe(0)
    expect(reviewDue(p.lessons['w1-02'], '2026-11-01')).toBeNull()
    expect(reviewDue(p.lessons['w1-02'], '2026-11-02')).toBe(0)
    expect(reviewDue(p.lessons['w1-02'], '2026-11-04')).toBe(2)
    p = applyResult(p, by('w1-02'), result({ score: 92, passed: true }), at('2026-11-02'), ctx).progress
    expect(p.lessons['w1-02'].box).toBe(1)
    p = applyResult(p, by('w1-02'), result({ score: 20, passed: false }), at('2026-11-03'), ctx).progress
    expect(p.lessons['w1-02'].box).toBe(0)
  })

  it('never changes the progress it was given', () => {
    const p = recordSkip(newProgress(), 'w1-01', DAY)
    const before = JSON.stringify(p)
    applyResult(p, by('w1-02'), result({ score: 92, passed: true }), DAY, ctx)
    expect(JSON.stringify(p)).toBe(before)
  })

  it('picks fun lines once and remembers their facts', () => {
    const p = recordSkip(newProgress(), 'w1-01', DAY)
    const o = applyResult(p, by('w1-02'), result({ score: 92, passed: true, at: 123 }), DAY, ctx)
    expect(o.factLines.length).toBeGreaterThan(0)
    expect(o.factLines.length).toBeLessThanOrEqual(2)
    const ids = o.factLines.flatMap((l) => (l.factId ? [l.factId] : []))
    expect(o.progress.recentFacts).toEqual(ids)
  })
})

describe('streak', () => {
  it('counts consecutive days and breaks after a gap', () => {
    let p = recordSkip(newProgress(), 'w1-01', at('2026-11-01'))
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) p = applyResult(p, by('w1-02'), result({ score: 92, passed: true }), at(d), ctx).progress
    expect(p.streak.days).toBe(3)
    expect(streakStatus(p, at('2026-11-04'))).toEqual({ days: 3, alive: true, away: 1 })
    expect(streakStatus(p, at('2026-11-06')).alive).toBe(false)
    const o = applyResult(p, by('w1-02'), result({ score: 92, passed: true }), at('2026-11-06'), ctx)
    expect(o.progress.streak.days).toBe(1)
    expect(o.streakNote).toMatch(/missed you/)
  })

  it('the practice day starts at 4 am', () => {
    expect(dayKey(new Date('2026-11-05T03:59:00'))).toBe('2026-11-04')
    expect(dayKey(new Date('2026-11-05T04:00:00'))).toBe('2026-11-05')
  })
})

describe('levels and unlocks', () => {
  it('levels need more XP each time', () => {
    expect(levelFor(0)).toEqual({ level: 1, into: 0, need: 100 })
    expect(levelFor(100)).toEqual({ level: 2, into: 0, need: 146 })
    expect(levelFor(245).level).toBe(2)
    expect(levelFor(246).level).toBe(3)
  })

  it('nextLesson: Tap In first, then on through the map; a skipped Tap In never blocks', () => {
    let p = newProgress()
    expect(nextLesson(p)).toBe('w1-01')
    expect(isUnlocked(p, 'w1-02')).toBe(false)
    p = recordSkip(p, 'w1-01', DAY)
    expect(nextLesson(p)).toBe('w1-02')
    p = applyResult(p, by('w1-02'), result({ score: 92, passed: true }), DAY, ctx).progress
    expect(nextLesson(p)).toBe('w1-03')
  })

  it('a world opens when the previous boss is passed', () => {
    const p = newProgress()
    expect(worldUnlocked(p, 1)).toBe(true)
    expect(worldUnlocked(p, 2)).toBe(false)
    p.lessons['w1-04'] = rec({ passedAt: 1, stars: 1 })
    expect(worldUnlocked(p, 2)).toBe(true)
    expect(isUnlocked(p, 'w2-01')).toBe(true)
    expect(isUnlocked(p, 'w2-02')).toBe(false)
  })
})

describe('saved progress', () => {
  beforeEach(() => localStorage.clear())

  it('fills fields an old save lacks', () => {
    const old = { v: 1, xp: 50, lessons: { 'w1-02': { best: 80, stars: 2, plays: 3 } } }
    const p = importProgress(JSON.stringify(old))!
    expect(p.xp).toBe(50)
    expect(p.plan).toBeNull()
    expect(p.planStreak).toEqual({ days: 0, last: '' })
    expect(p.heat).toBeUndefined()
    expect(p.recentFacts).toEqual([])
    expect(p.dinoName).toBe('Pebble')
    expect(p.lessons['w1-02']).toEqual(rec({ best: 80, stars: 2, plays: 3 }))
  })

  it('cleans bad stored values', () => {
    const p = importProgress(
      JSON.stringify({
        v: 1,
        xp: -5,
        lessons: { 'w1-02': { best: 'x', stars: 7, speed: 3, topSpeed: 'x', miss: -4, box: 9, loops: 2.6 }, junk: 5 },
        dailyGoal: 999,
        dinoName: '   ',
        cosmetics: ['shades', 'cape'],
        recentFacts: ['a', 3, 'b'],
        plan: { day: '2026-11-04', steps: [{ kind: 'new', lessonId: 'nope' }, { kind: 'jam', lessonId: 'w2-05', state: 'weird' }] },
      }),
    )!
    expect(p.xp).toBe(0)
    expect(p.lessons.junk).toBeUndefined()
    expect(p.lessons['w1-02']).toMatchObject({ best: 0, stars: 3, speed: 1.15, miss: 0, box: 4, loops: 3 })
    expect(p.lessons['w1-02'].topSpeed).toBeUndefined()
    expect(p.dailyGoal).toBe(100)
    expect(p.dinoName).toBe('Pebble')
    expect(p.cosmetics).toEqual(['shades'])
    expect(p.recentFacts).toEqual(['a', 'b'])
    expect(p.plan?.steps).toHaveLength(1)
    expect(p.plan?.steps[0]).toMatchObject({ kind: 'jam', lessonId: 'w2-05', state: 'todo' })
  })

  it('refuses things that are not progress', () => {
    expect(importProgress('nope')).toBeNull()
    expect(importProgress('[]')).toBeNull()
    expect(importProgress(JSON.stringify({ v: 2, xp: 1, lessons: {} }))).toBeNull()
  })

  it('round-trips through storage, and keeps a corrupt save as a backup', () => {
    const p = applyResult(recordSkip(newProgress(), 'w1-01', DAY), by('w1-02'), result({ score: 92, passed: true }), DAY, ctx).progress
    saveProgress(p)
    expect(loadProgress()).toEqual(p)
    localStorage.setItem('lessons-progress', '{broken')
    expect(loadProgress().xp).toBe(0)
    expect(localStorage.getItem('lessons-progress-bak')).toBe('{broken')
  })
})
