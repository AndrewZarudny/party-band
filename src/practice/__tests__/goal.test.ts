import { describe, expect, it } from 'vitest'
import { DEFAULT_GOAL, GOAL_CHOICES, goalFraction, parseGoal, reachedGoal, ringDash, sessionGoal, wholeMin } from '../goal'

describe('parseGoal', () => {
  it('reads the stored minutes when they are one of the choices', () => {
    for (const m of GOAL_CHOICES) expect(parseGoal(JSON.stringify({ min: m }))).toBe(m)
  })

  it('falls back to 30 minutes for anything missing, unreadable or not a choice', () => {
    expect(DEFAULT_GOAL).toBe(30)
    for (const raw of [null, '', 'nope', '{', 'null', '[]', '30', '{"min":"30"}', '{"min":25}', '{"min":0}', '{"min":-15}', '{"min":90}', '{}'])
      expect(parseGoal(raw)).toBe(30)
  })
})

describe('the goal before one is picked', () => {
  const lessons = (sessionMin: unknown) => JSON.stringify({ v: 1, xp: 120, lessons: {}, sessionMin })

  it('starts at the lesson session length, 20 or 30 minutes', () => {
    expect(sessionGoal(lessons(20))).toBe(20)
    expect(sessionGoal(lessons(30))).toBe(30)
    expect(parseGoal(null, sessionGoal(lessons(20)))).toBe(20)
  })

  it('keeps an explicit pick, whatever the session length', () => {
    expect(parseGoal(JSON.stringify({ min: 45 }), sessionGoal(lessons(20)))).toBe(45)
    expect(parseGoal(JSON.stringify({ min: 30 }), sessionGoal(lessons(20)))).toBe(30)
    expect(parseGoal(JSON.stringify({ min: 15 }), sessionGoal(lessons(30)))).toBe(15)
  })

  it('falls back to 30 when the lessons data is missing, unreadable or has another length', () => {
    for (const raw of [null, '', 'nope', '{', 'null', '[]', '20', lessons('20'), lessons(25), lessons(45), lessons(null), JSON.stringify({ v: 1 })])
      expect(sessionGoal(raw)).toBe(30)
  })

  it('uses the session length when the stored goal itself is unreadable', () => {
    expect(parseGoal('{"min":25}', sessionGoal(lessons(20)))).toBe(20)
    expect(parseGoal('{', 20)).toBe(20)
  })
})

describe('goal helpers', () => {
  it('works out how far a day is towards the goal, never past 1', () => {
    expect(goalFraction(0, 30)).toBe(0)
    expect(goalFraction(900, 30)).toBe(0.5)
    expect(goalFraction(1800, 30)).toBe(1)
    expect(goalFraction(5000, 30)).toBe(1)
    expect(goalFraction(-5, 30)).toBe(0)
  })

  it('marks a day as reaching the goal only once the full minutes are in', () => {
    expect(reachedGoal(1799, 30)).toBe(false)
    expect(reachedGoal(1800, 30)).toBe(true)
    expect(reachedGoal(2400, 30)).toBe(true)
    // A day without practice is simply not reached: nothing is counted against it.
    expect(reachedGoal(0, 15)).toBe(false)
  })

  it('leaves the ring visibly open until the goal is met', () => {
    // Drawn length = the dash plus the round ends (about 5.1 of the ring's 100 units).
    expect(100 - ringDash(1799, 30) - 5.1).toBeGreaterThanOrEqual(3)
    expect(100 - ringDash(1720, 30) - 5.1).toBeGreaterThanOrEqual(3)
    expect(ringDash(1800, 30)).toBe(100)
    expect(ringDash(0, 30)).toBe(0)
    expect(ringDash(1, 30)).toBeGreaterThan(0)
    expect(ringDash(900, 30)).toBeLessThan(ringDash(1200, 30))
  })

  it('shows whole minutes, so the top bar never says 30 / 30 before the goal is met', () => {
    expect(wholeMin(1799)).toBe(29)
    expect(wholeMin(59)).toBe(0)
    expect(wholeMin(-1)).toBe(0)
  })
})
