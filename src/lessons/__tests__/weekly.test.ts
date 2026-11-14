import { beforeEach, describe, expect, it } from 'vitest'
import type { Lesson, LessonRecord, Progress, SessionDay } from '../types'
import { newProgress } from '../progress'
import { lessonById } from '../data'
import { dismissWeekly, lastWeekKey, weekFocus, weeklyDue, weeklyFacts } from '../weekly'
import { saveCheckIn } from '../checkin'
import { at, rec } from './fixtures'

const NOW = at('2026-11-16') // a Monday: last week is 2026-11-09 to 15
const day = (d: string, sec = 1800): SessionDay => ({ day: d, sec, set: false, counted: true, pocket: false })
const passed = (o: Partial<LessonRecord> = {}) => rec({ passedAt: 1, plays: 10, stars: 2, best: 85, lastPlayed: at('2026-11-12').getTime(), ...o })

function player(): Progress {
  const p = newProgress()
  p.sessions = { log: [day('2026-11-10'), day('2026-11-12', 2400)], before: 0 }
  return p
}

describe('the weekly review', () => {
  beforeEach(() => localStorage.clear())

  it('last week is the Monday-to-Sunday week before', () => {
    expect(lastWeekKey(NOW)).toBe('2026-11-09')
  })

  it('focus: a plateau before a near third star, at most two', () => {
    const p = player()
    p.lessons['w1-04'] = passed({ best: 91, flat: 21 }) // plateau (and 4 from its third star)
    p.lessons['w1-03'] = passed({ best: 92 }) // 3 from its third star
    p.lessons['w1-05'] = passed({ best: 70 })
    const f = weekFocus(p, NOW)
    expect(f.map((x) => x.id)).toEqual(['w1-04', 'w1-03'])
    expect(f[0].why).toBe('no new best in 21 runs')
  })

  it("facts: last week's sessions and minutes, and the same focus", () => {
    const p = player()
    p.lessons['w1-04'] = passed({ best: 91, flat: 21 })
    const f = weeklyFacts(p, NOW, 'Andy')
    expect(f.lastWeek).toMatchObject({ sessions: 2, minutes: 70 })
    expect(f.focusThisWeek[0]).toEqual({ lesson: (lessonById('w1-04') as Lesson).title, why: 'no new best in 21 runs' })
  })

  it('shown when last week had practice, until dismissed; not after an empty week', () => {
    const p = player()
    expect(weeklyDue(p, NOW)).toBe(true)
    dismissWeekly(NOW)
    expect(weeklyDue(p, NOW)).toBe(false)
    expect(weeklyDue({ ...p, sessions: { log: [], before: 0 } }, at('2026-11-23'))).toBe(false)
  })
})

describe('the weekly review reads the check-ins', () => {
  beforeEach(() => localStorage.clear())
  it("last week's check-ins, in the player's words; not this week's or older ones", () => {
    saveCheckIn({ day: '2026-11-02', feel: 'easy', note: 'old' })
    saveCheckIn({ day: '2026-11-10', feel: 'hard', note: 'barre chords hurt' })
    saveCheckIn({ day: '2026-11-16', feel: 'right', note: 'this week' })
    expect(weeklyFacts(player(), NOW, null).checkIns).toEqual([{ day: '2026-11-10', felt: 'too hard', note: 'barre chords hurt' }])
  })
})

describe('the weekly review knows your jamming', () => {
  beforeEach(() => localStorage.clear())
  it("last week's jams in the Jam tab, against the week before", () => {
    const j = (day: string, chordPct: number, outPct: number) => ({ at: at(day).getTime(), notes: 100, chordPct, outPct, sec: 300 })
    localStorage.setItem('jam-history', JSON.stringify([j('2026-11-04', 20, 30), j('2026-11-10', 30, 12), j('2026-11-12', 40, 8), j('2026-11-16', 50, 5)]))
    expect(weeklyFacts(player(), NOW, null).jamming).toEqual({
      jams: 2,
      minutes: 10,
      chordTonesPercent: 35,
      outsidePercent: 10,
      weekBefore: { jams: 1, chordTonesPercent: 20, outsidePercent: 30 },
    })
  })
  it('no jams last week: nothing', () => {
    expect(weeklyFacts(player(), NOW, null).jamming).toBeNull()
  })
})
