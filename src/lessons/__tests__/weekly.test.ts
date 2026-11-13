import { beforeEach, describe, expect, it } from 'vitest'
import type { Lesson, LessonRecord, Progress, SessionDay } from '../types'
import { newProgress } from '../progress'
import { lessonById } from '../data'
import { dismissWeekly, lastWeekKey, weekFocus, weeklyDue, weeklyFacts } from '../weekly'
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
