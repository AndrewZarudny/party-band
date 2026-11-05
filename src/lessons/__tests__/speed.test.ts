import { describe, expect, it } from 'vitest'
import type { LessonRecord, Prefs } from '../types'
import { autoSpeed, bpmAt, cleanSpeed, earnedTop, isCleanRun, nextSpeed, slowerSpeed, snapSpeed, speedFor, tempoStep } from '../speed'
import { lessonById } from '../data'
import { lesson, rec, result } from './fixtures'

const L80 = lesson({ bpm: 80, pass: 60, stars: [60, 80, 95] }) // tempo step 0.04
const JAM = lesson({ type: 'improv', pass: 50, stars: [50, 70, 88] })
const prefs = (speedPick: Prefs['speedPick'] = null) => ({ speedPick }) as Prefs

/** Plays runs in a row as applyResult stores the step. A run is [score, share of events good or better]. */
function walk(l = L80, runs: [number, number][], start?: LessonRecord) {
  let r: LessonRecord | undefined = start
  const out: { played: number; next: number; earned: boolean; trial: string | null; overdrive: boolean; top: number }[] = []
  for (const [score, share] of runs) {
    const played = autoSpeed(l, r)
    const passed = score >= l.pass
    const s = nextSpeed(l, r, result({ score, passed, speed: played, cleanShare: share }))
    // every run under the trainer leaves a session history entry (applyResult), so the record is never legacy
    r = { ...(r ?? rec()), speed: s.speed, overdrive: s.overdrive || undefined, topSpeed: s.top || undefined, trial: s.trial, hist: r?.hist ?? [] }
    if (passed && r.passedAt === undefined) r.passedAt = 1
    out.push({ played, next: s.speed, earned: s.earned, trial: s.trial ? `${s.trial.speed}:${s.trial.first ? 'y' : 'n'}:${s.trial.clean}` : null, overdrive: s.overdrive, top: s.top })
  }
  return out
}

describe('autoSpeed', () => {
  it('starts lessons at 85%, jams at full speed', () => {
    expect(autoSpeed(L80, undefined)).toBe(0.85)
    expect(autoSpeed(JAM, undefined)).toBe(1)
  })

  it('starts at 70% after two fails, and at 100% for a lesson passed before Auto existed', () => {
    expect(autoSpeed(L80, rec({ plays: 2, fails: 2 }))).toBe(0.7)
    expect(autoSpeed(L80, rec({ plays: 3, passedAt: 1 }))).toBe(1)
  })

  it('a stored speed is snapped to 0.01 and capped (115% only with overdrive)', () => {
    expect(autoSpeed(L80, rec({ speed: 1.12 }))).toBe(1)
    expect(autoSpeed(L80, rec({ speed: 1.123, overdrive: true }))).toBe(1.12)
    expect(autoSpeed(L80, rec({ speed: 0.2 }))).toBe(0.6)
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

  it('cleans stored values; old 0.05-grid values stay valid', () => {
    expect(cleanSpeed(3)).toBe(1.15)
    expect(cleanSpeed(0.849999)).toBe(0.85)
    expect(cleanSpeed(0.9)).toBe(0.9)
    expect(cleanSpeed('x')).toBeUndefined()
    expect(cleanSpeed(NaN)).toBeUndefined()
  })
})

describe('tempo steps', () => {
  it('is about 3 BPM, snapped to the 0.01 grid', () => {
    expect(tempoStep(lesson({ bpm: 80 }))).toBe(0.04)
    expect(tempoStep(lesson({ bpm: 60 }))).toBe(0.05)
    expect(tempoStep(lesson({ bpm: 95 }))).toBe(0.03)
    expect(snapSpeed(0.85 + 0.04)).toBe(0.89)
    expect(bpmAt(L80, 0.85)).toBe(68)
  })
})

describe('isCleanRun', () => {
  it('needs a pass with 90% of events good or better; jams need 2 stars; sync never', () => {
    expect(isCleanRun(L80, result({ passed: true, cleanShare: 0.9 }))).toBe(true)
    expect(isCleanRun(L80, result({ passed: true, cleanShare: 0.89 }))).toBe(false)
    expect(isCleanRun(L80, result({ passed: false, cleanShare: 1 }))).toBe(false)
    expect(isCleanRun(L80, result({ passed: true }))).toBe(false)
    expect(isCleanRun(JAM, result({ passed: true, score: 70 }))).toBe(true)
    expect(isCleanRun(JAM, result({ passed: true, score: 69 }))).toBe(false)
    expect(isCleanRun(lesson({ type: 'sync' }), result({ passed: true, cleanShare: 1 }))).toBe(false)
  })
})

describe('nextSpeed: clean-pass speed trainer', () => {
  it('earns a tempo after a clean first run plus two more, then goes up one step', () => {
    const w = walk(L80, [
      [90, 1],
      [92, 0.95],
      [95, 0.95],
      [90, 1],
    ])
    expect(w.map((x) => x.played)).toEqual([0.85, 0.85, 0.85, 0.89])
    expect(w.map((x) => x.trial)).toEqual(['0.85:y:1', '0.85:y:2', null, '0.89:y:1'])
    expect(w.map((x) => x.earned)).toEqual([false, false, true, false])
    expect(w[2]).toMatchObject({ next: 0.89, top: 0.85 })
  })

  it('a first try that is not clean goes one step down and closes the trial', () => {
    const w = walk(L80, [[80, 0.8]])
    expect(w[0]).toMatchObject({ played: 0.85, next: 0.81, trial: null, earned: false, top: 0 })
  })

  it('two clean runs then one that is not clean keeps the trial open at the same tempo', () => {
    const w = walk(L80, [
      [90, 1],
      [90, 1],
      [80, 0.8],
      [90, 1],
    ])
    expect(w.map((x) => x.next)).toEqual([0.85, 0.85, 0.85, 0.89])
    expect(w[2].trial).toBe('0.85:y:2')
    expect(w[3].earned).toBe(true)
  })

  it('a run far under the pass mark inside a trial drops two steps', () => {
    const w = walk(L80, [
      [90, 1],
      [40, 0.3],
    ])
    expect(w[1]).toMatchObject({ next: 0.77, trial: null })
    // as the first run of a trial it is just "not clean": one step
    expect(walk(L80, [[40, 0.3]])[0].next).toBe(0.81)
  })

  it('no 90% rule: a high score that is not clean never speeds up', () => {
    const w = walk(L80, [[92, 0.85]])
    expect(w[0].next).toBeLessThan(w[0].played)
  })

  it('overdrive opens when 100% is earned with a top score; Auto may then go past 100%', () => {
    const w = walk(
      L80,
      [
        [96, 1],
        [97, 1],
        [98, 1],
        [99, 1],
      ],
      rec({ speed: 1, passedAt: 1 }),
    )
    expect(w.map((x) => x.played)).toEqual([1, 1, 1, 1.04])
    expect(w[2]).toMatchObject({ earned: true, overdrive: true, next: 1.04, top: 1 })
  })

  it('without overdrive the next speed stops at 100%', () => {
    const s = nextSpeed(L80, rec({ trial: { speed: 0.98, first: true, clean: 2 } }), result({ score: 90, passed: true, speed: 0.98, cleanShare: 1 }))
    expect(s).toMatchObject({ earned: true, speed: 1, top: 0.98 })
  })

  it('steps from the speed played (a manual pick), not from Auto; a pass from before the trainer counts as 100% earned', () => {
    const s = nextSpeed(L80, rec({ passedAt: 1 }), result({ score: 95, passed: true, speed: 0.7, cleanShare: 1 }))
    expect(s.speed).toBe(0.7)
    expect(s.trial).toEqual({ speed: 0.7, first: true, clean: 1 })
    expect(s.topBefore).toBe(1)
    expect(s.top).toBe(1)
    // with session history the record is from the trainer: nothing earned yet
    expect(nextSpeed(L80, rec({ passedAt: 1, speed: 0.85, hist: [] }), result({ speed: 0.85 })).topBefore).toBe(0)
    expect(earnedTop(rec({ passedAt: 1, speed: 0.85 }))).toBe(1)
    expect(earnedTop(rec({ passedAt: 1, topSpeed: 0.9 }))).toBe(0.9)
    expect(earnedTop(rec({ plays: 2 }))).toBe(0)
  })

  it('jams: any pass speeds up under full speed', () => {
    expect(nextSpeed(JAM, rec({ speed: 0.9 }), result({ score: 50, passed: true, speed: 0.9 })).speed).toBe(0.95)
    expect(nextSpeed(JAM, rec({ speed: 0.9 }), result({ score: 36, passed: false, speed: 0.9 })).speed).toBe(0.9)
  })

  it('jams at full speed: overdrive and faster need the 3-star score; far under the pass mark slows', () => {
    const w = walk(JAM, [
      [60, 0],
      [70, 0],
      [88, 0],
      [60, 0],
      [30, 0],
    ])
    expect(w.map((x) => x.played)).toEqual([1, 1, 1, 1.05, 1.05])
    expect(w.map((x) => x.next)).toEqual([1, 1, 1.05, 1.05, 0.95])
    expect(w[2].overdrive).toBe(true)
  })
})
