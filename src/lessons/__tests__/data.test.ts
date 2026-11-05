import { describe, expect, it } from 'vitest'
import { GROWTH, LEGACY_IDS, LESSONS, ORDER, PLAN_LESSONS, PLAN_PATH, STAGES, TWELVE_A7, TWELVE_E7, checkpointOf, lessonById, stageOf, validateLessons, whereLabel } from '../data'
import { buildChart } from '../charts'
import { FEELS } from '../../music/parts'

describe('lesson data', () => {
  it('validateLessons finds no problems', () => {
    expect(validateLessons()).toEqual([])
  })

  it('every stage lists known lessons, its checkpoint last and the only boss', () => {
    for (const s of STAGES) {
      for (const id of [...s.core, ...s.extra]) expect(lessonById(id), id).toBeDefined()
      const cp = checkpointOf(s)
      if (s.weeks) expect(lessonById(cp ?? '')?.boss).toBe(true)
      for (const id of [...s.core, ...s.extra]) expect(!!lessonById(id)?.boss, id).toBe(id === cp)
    }
    expect(LESSONS.filter((l) => l.boss).map((l) => l.id)).toEqual(['w3-07', 'w3-10', 'w5-07', 'w6-05', 'w8-03', 'w8-12'])
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s builds a sound chart', (_id, l) => {
    const c = buildChart(l)
    expect(c.lessonId).toBe(l.id)
    expect(c.bars).toBe(l.bars)
    expect(c.totalBeats).toBe(l.bars * 4)
    expect(c.chordTimeline).toHaveLength(c.bars)
    c.events.forEach((e, i) => {
      expect(e.id).toBe(i)
      expect(e.beat).toBeGreaterThanOrEqual(0)
      expect(e.beat).toBeLessThan(c.totalBeats)
      if (i > 0) expect(e.beat).toBeGreaterThanOrEqual(c.events[i - 1].beat)
      if (e.kind === 'note') {
        expect(e.string).toBeGreaterThanOrEqual(0)
        expect(e.string).toBeLessThanOrEqual(5)
        expect(e.fret).toBeLessThanOrEqual(15)
      }
    })
    for (const b of c.listenBars) expect(b).toBeLessThan(c.bars)
    if (l.type === 'notes' || l.type === 'chords' || l.type === 'rhythm') expect(c.events.some((e) => e.kind !== 'rest')).toBe(true)
    // the same lesson always gives the same chart (seeded phrases)
    expect(buildChart(l)).toEqual(c)
  })

  it('only the sync lesson has no band', () => {
    expect(LESSONS.filter((l) => !l.backing).map((l) => l.id)).toEqual(['w1-01'])
  })
})

// The 37 lessons before the jam library and the blues/rock material: none may disappear (saved progress keys on them)
const OLD_IDS = [
  'w1-01', 'w1-02', 'w1-03', 'w1-04', 'w2-01', 'w2-02', 'w2-03', 'w2-05', 'w2-04',
  'w3-01', 'w3-02', 'w3-03', 'w3-05', 'w3-04', 'w4-01', 'w4-02', 'w4-03', 'w4-04',
  'w5-01', 'w5-02', 'w5-03', 'w5-04', 'w5-06', 'w6-01', 'w6-02', 'w6-03', 'w6-04', 'w6-05',
  'w7-01', 'w7-02', 'w7-03', 'w7-04', 'w8-01', 'w8-02', 'w8-03', 'w8-04', 'w8-05',
]
const NEW_IDS = ['w1-05', 'w2-06', 'w2-07', 'w3-06', 'w3-07', 'w3-09', 'w3-10', 'w4-05', 'w4-06', 'w5-11', 'w5-07', 'w5-08', 'w5-09',
  'w7-05', 'w8-06', 'w8-07', 'w8-08', 'w8-09', 'w8-10', 'w8-11', 'w8-12']

describe('blues and rock material', () => {
  it('keeps every old lesson id on the map, and no id moved', () => {
    expect(OLD_IDS).toHaveLength(37)
    for (const id of [...OLD_IDS, ...NEW_IDS]) expect(ORDER).toContain(id)
    expect(ORDER).toHaveLength(LESSONS.length)
    expect(new Set(ORDER).size).toBe(ORDER.length)
    expect(LEGACY_IDS).toEqual({})
  })

  it('the map follows the 12-week plan: each stage in the stated order', () => {
    const stage = (id: number) => STAGES.find((s) => s.id === id)!
    expect(STAGES.map((s) => s.weeks)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], null])
    expect(stage(1).core).toEqual(['w1-01', 'w1-05', 'w4-01', 'w3-06', 'w3-07'])
    expect(stage(1).extra).toEqual(['w1-02', 'w1-03', 'w2-01', 'w3-02', 'w1-04', 'w2-05', 'w8-01'])
    expect(stage(2).core).toEqual(['w3-09', 'w2-06', 'w2-03', 'w3-10'])
    expect(stage(2).extra).toEqual(['w3-01'])
    expect(stage(3).core).toEqual(['w5-01', 'w5-11', 'w7-02', 'w5-07'])
    expect(stage(3).extra).toEqual(['w5-02', 'w5-03', 'w5-04', 'w7-01', 'w7-03', 'w8-02', 'w5-06'])
    expect(stage(4).core).toEqual(['w6-01', 'w6-02', 'w6-03', 'w6-04', 'w3-05', 'w2-07', 'w7-05', 'w6-05'])
    expect(stage(4).extra).toEqual(['w3-04', 'w7-04'])
    expect(stage(5).core).toEqual(['w5-08', 'w5-09', 'w8-06', 'w8-07', 'w8-10', 'w8-03'])
    expect(stage(5).extra).toEqual(['w4-02', 'w4-05', 'w4-06', 'w8-04'])
    expect(stage(6).core).toEqual(['w8-11', 'w8-08', 'w8-09', 'w8-12'])
    expect(stage(6).extra).toEqual(['w4-03', 'w4-04', 'w8-05'])
    expect(stage(7).core).toEqual([])
    expect(stage(7).extra).toEqual(['w2-02', 'w2-04', 'w3-03'])
    expect(LESSONS).toHaveLength(OLD_IDS.length + NEW_IDS.length)
  })

  it('the plan lists are derived from the stages', () => {
    expect(PLAN_LESSONS).toEqual(STAGES.filter((s) => s.weeks).map((s) => s.core.filter((id) => id !== 'w1-01')))
    expect(PLAN_PATH[0]).toBe('w1-01')
    expect(PLAN_PATH).toContain('w8-03')
    expect(PLAN_PATH.some((id) => lessonById(id)?.free)).toBe(false)
    expect(GROWTH).toEqual(['w3-07', 'w3-10', 'w5-07', 'w6-05', 'w8-03', 'w8-12', 'w7-04', 'w8-05'])
  })

  it('the required path matches the plan: ear echo without bends in weeks 5–6, bent licks by ear after Bend to Pitch, Em in weeks 7–8', () => {
    const echoes = (ids: string[]) => ids.filter((id) => lessonById(id)?.calls)
    expect(echoes(PLAN_LESSONS[2])).toEqual(['w7-02'])
    for (const id of echoes(PLAN_LESSONS[2])) for (const c of lessonById(id)!.calls!.calls) expect(c, id).not.toContain('^')
    expect(echoes(PLAN_LESSONS[3])).toEqual(['w7-05'])
    expect(PLAN_PATH.indexOf('w6-03')).toBeLessThan(PLAN_PATH.indexOf('w7-05'))
    expect(PLAN_LESSONS[3].some((id) => lessonById(id)?.chordBars?.some((b) => b.chord === 'Em'))).toBe(true)
    // The octave shape that later tips lean on is required, before box 1
    expect(PLAN_PATH.indexOf('w2-03')).toBeGreaterThan(-1)
    expect(PLAN_PATH.indexOf('w2-03')).toBeLessThan(PLAN_PATH.indexOf('w5-01'))
  })

  it('where a lesson sits: plan lesson, checkpoint, optional extra', () => {
    expect(stageOf('w4-01')).toMatchObject({ core: true, pos: 2 })
    expect(stageOf('w2-03')?.stage.id).toBe(2)
    expect(whereLabel('w4-01')).toBe('Weeks 1–2, lesson 3')
    expect(whereLabel('w3-07')).toBe('Weeks 1–2 checkpoint')
    expect(whereLabel('w2-03')).toBe('Weeks 3–4, lesson 3')
    expect(whereLabel('w5-07')).toBe('Weeks 5–6 checkpoint')
    expect(whereLabel('w3-01')).toBe('Weeks 3–4 · optional extra')
    expect(whereLabel('w3-03')).toBe('Optional extra')
  })

  it('new lessons sit at 60–95 BPM, in A or E', () => {
    for (const id of NEW_IDS) {
      const l = lessonById(id)!
      expect(l.bpm, id).toBeGreaterThanOrEqual(60)
      expect(l.bpm, id).toBeLessThanOrEqual(95)
      if (l.improv) expect([9, 4], id).toContain(l.improv.key)
    }
  })

  it('free lessons are jams and never bosses', () => {
    const free = LESSONS.filter((l) => l.free)
    expect(free.map((l) => l.id)).toEqual(['w8-06', 'w8-07', 'w8-08', 'w8-09', 'w8-10', 'w8-11'])
    for (const l of free) {
      expect(l.boss).toBeFalsy()
      expect(l.type).toBe('improv')
    }
  })

  it('the boogie is judged as two-note shapes, by pitch', () => {
    const c = buildChart(lessonById('w3-07')!)
    const chords = c.events.filter((e) => e.kind === 'chord')
    expect(chords).toHaveLength(96)
    for (const e of chords) {
      expect(e.power).toBe(true)
      expect(e.chroma).toBe(false)
      expect(e.pcs).toHaveLength(2)
    }
    // A6 = open A plus F# on the D string; lowest string first
    const a6 = chords.find((e) => e.symbol === 'A6')!
    expect(a6.pcs).toEqual([9, 6])
    expect(chords.find((e) => e.symbol === 'E5')!.pcs).toEqual([4, 11])
  })

  it('slow blues exists and swings; the 12-bars are right', () => {
    expect(FEELS.slowblues.swing).toBe(true)
    expect(lessonById('w8-08')!.backing!.feel).toBe('slowblues')
    expect(TWELVE_A7).toEqual(['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'])
    expect(TWELVE_E7).toHaveLength(12)
    expect(TWELVE_E7[8]).toBe('B7')
  })
})
