import { describe, expect, it } from 'vitest'
import type { LessonRecord, Prefs } from '../types'
import { autoSpeed, cleanSpeed, nextSpeed, slowerSpeed, speedFor, speedLimits } from '../speed'
import { lessonById } from '../data'
import { lesson, rec, result } from './fixtures'

const NOTES = lesson({ pass: 60, stars: [60, 80, 95] }) // up 90, down 50
const JAM = lesson({ type: 'improv', pass: 50, stars: [50, 70, 88] }) // up 50 (88 above full speed), down 35
const prefs = (speedPick: Prefs['speedPick'] = null) => ({ speedPick }) as Prefs

/** Plays scores in a row from a fresh record, as applyResult stores the step. */
function walk(l = NOTES, runs: [number, boolean][], start?: LessonRecord) {
  let r: LessonRecord | undefined = start
  const out: { played: number; next: number; miss: number; overdrive: boolean; top: number }[] = []
  for (const [score, passed] of runs) {
    const played = autoSpeed(l, r)
    const s = nextSpeed(l, r, result({ score, passed, speed: played }))
    r = { ...(r ?? rec()), speed: s.speed, miss: s.miss, overdrive: s.overdrive || undefined, topSpeed: s.top || undefined }
    if (passed && r.passedAt === undefined) r.passedAt = 1
    out.push({ played, next: s.speed, miss: s.miss, overdrive: s.overdrive, top: s.top })
  }
  return out
}

describe('autoSpeed', () => {
  it('starts lessons at 85%, jams at full speed', () => {
    expect(autoSpeed(NOTES, undefined)).toBe(0.85)
    expect(autoSpeed(JAM, undefined)).toBe(1)
  })

  it('starts at 70% after two fails, and at 100% for a lesson passed before Auto existed', () => {
    expect(autoSpeed(NOTES, rec({ plays: 2, fails: 2 }))).toBe(0.7)
    expect(autoSpeed(NOTES, rec({ plays: 3, passedAt: 1 }))).toBe(1)
  })

  it('a stored speed is snapped and capped (115% only with overdrive)', () => {
    expect(autoSpeed(NOTES, rec({ speed: 1.12 }))).toBe(1)
    expect(autoSpeed(NOTES, rec({ speed: 1.12, overdrive: true }))).toBe(1.1)
    expect(autoSpeed(NOTES, rec({ speed: 0.2 }))).toBe(0.6)
  })
})

describe('speedFor, slowerSpeed, cleanSpeed', () => {
  it('a manual pick wins only for its own lesson; the sync lesson is always full speed', () => {
    const w102 = lessonById('w1-02')!
    const w103 = lessonById('w1-03')!
    expect(speedFor(w102, undefined, prefs({ lessonId: 'w1-02', speed: 0.7 }))).toBe(0.7)
    expect(speedFor(w103, undefined, prefs({ lessonId: 'w1-02', speed: 0.7 }))).toBe(0.85)
    expect(speedFor(lessonById('w1-01')!, rec({ speed: 0.7 }), prefs())).toBe(1)
  })

  it('steps 15% slower within 60..100%', () => {
    expect(slowerSpeed(0.85)).toBe(0.7)
    expect(slowerSpeed(0.7)).toBe(0.6)
    expect(slowerSpeed(1.15)).toBe(1)
  })

  it('cleans stored values', () => {
    expect(cleanSpeed(3)).toBe(1.15)
    expect(cleanSpeed(0.849999)).toBe(0.85)
    expect(cleanSpeed('x')).toBeUndefined()
    expect(cleanSpeed(NaN)).toBeUndefined()
  })
})

describe('nextSpeed', () => {
  it('uses 90 / pass-10 (at most 60) for lessons, pass / pass-15 for jams', () => {
    expect(speedLimits(NOTES)).toEqual({ up: 90, down: 50 })
    expect(speedLimits(lesson({ pass: 75 }))).toEqual({ up: 90, down: 60 })
    expect(speedLimits(JAM)).toEqual({ up: 50, down: 35 })
  })

  it('climbs 5% per strong pass up to 100%, and overdrive opens at 95+ on full speed', () => {
    const w = walk(NOTES, [
      [92, true],
      [91, true],
      [80, true],
      [90, true],
      [94, true],
      [96, true],
      [97, true],
      [99, true],
      [99, true],
    ])
    expect(w.map((x) => x.next)).toEqual([0.9, 0.95, 0.95, 1, 1, 1.05, 1.1, 1.15, 1.15])
    expect(w.map((x) => x.overdrive)).toEqual([false, false, false, false, false, true, true, true, true])
    expect(w.map((x) => x.top)).toEqual([0.85, 0.9, 0.95, 0.95, 1, 1, 1.05, 1.1, 1.15])
  })

  it('a near miss needs two fails in a row (−5%), a bad run slows 10% at once, floor 60%', () => {
    const w = walk(NOTES, [
      [55, false],
      [55, false],
      [49, false],
      [10, false],
      [10, false],
    ])
    expect(w.map((x) => [x.played, x.next, x.miss])).toEqual([
      [0.85, 0.85, 1],
      [0.85, 0.8, 0],
      [0.8, 0.7, 0],
      [0.7, 0.6, 0],
      [0.6, 0.6, 0],
    ])
  })

  it('a pass resets the miss count', () => {
    const w = walk(NOTES, [
      [55, false],
      [70, true],
      [55, false],
    ])
    expect(w.map((x) => x.miss)).toEqual([1, 0, 1])
    expect(w.map((x) => x.next)).toEqual([0.85, 0.85, 0.85])
  })

  it('steps from the speed played (a manual pick), not from Auto', () => {
    const s = nextSpeed(NOTES, rec({ speed: 1, passedAt: 1 }), result({ score: 95, passed: true, speed: 0.7 }))
    expect(s.speed).toBe(0.75)
    expect(s.topBefore).toBe(1)
    expect(s.top).toBe(1)
  })

  it('jams: any pass speeds up under full speed', () => {
    expect(nextSpeed(JAM, rec({ speed: 0.9 }), result({ score: 50, passed: true, speed: 0.9 })).speed).toBe(0.95)
    expect(nextSpeed(JAM, rec({ speed: 0.9 }), result({ score: 36, passed: false, speed: 0.9 })).speed).toBe(0.9)
  })

  it('jams at full speed: overdrive and faster need the 3-star score; far under the pass mark slows', () => {
    const w = walk(JAM, [
      [60, true],
      [70, true],
      [88, true],
      [60, true],
      [30, false],
    ])
    expect(w.map((x) => x.played)).toEqual([1, 1, 1, 1.05, 1.05])
    expect(w.map((x) => x.next)).toEqual([1, 1, 1.05, 1.05, 0.95])
    expect(w[2].overdrive).toBe(true)
  })
})
