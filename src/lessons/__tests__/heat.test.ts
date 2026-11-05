import { describe, expect, it } from 'vitest'
import type { HeatCell, Lesson, Progress } from '../types'
import { HALF_LIFE_DAYS, MAX_CELLS, dayNum, decayed, normalizeHeat, noteNameRows, recordHeat, spotCopy, spotFor, spotLabel, timingRows, topSpots } from '../heat'
import { DRILL_START, drillLesson, drillSpec } from '../drill'
import { LESSONS, lessonById, validateLessons } from '../data'
import { buildChart } from '../charts'
import { newProgress } from '../progress'
import { jr } from './fixtures'

const now = new Date('2026-11-05T12:00:00')
const today = dayNum(now)
const P0 = newProgress()
const notesLesson = LESSONS.find((l) => l.type === 'notes' && !l.calls)!
const chordsLesson = LESSONS.find((l) => l.type === 'chords')!
const cell = (n: number, o: Partial<HeatCell> = {}): HeatCell => ({ n, bad: 0, wrong: 0, early: 0, late: 0, err: 0, d: today, l: 'w1-02', ...o })
const LEAK = /\b\d\.\d+\b|NaN|undefined|null|Infinity/

describe('recordHeat', () => {
  it('counts notes per string and fret: tries, slips and wrong notes', () => {
    const c = buildChart(notesLesson)
    const notes = c.events.filter((e) => e.kind === 'note')
    const rs = notes.map((e, i) => (i % 5 === 0 ? jr(e.id, 'note', 'miss', null) : i % 5 === 1 ? jr(e.id, 'note', 'wrong', 10) : jr(e.id, 'note', 'good', 0)))
    const p = recordHeat(P0, notesLesson, c, rs, { sourceId: notesLesson.id, calibrated: true, now })
    const want: Record<string, { n: number; bad: number; wrong: number }> = {}
    notes.forEach((e, i) => {
      const k = `n:${e.string}.${e.fret}`
      want[k] = want[k] ?? { n: 0, bad: 0, wrong: 0 }
      want[k].n++
      if (i % 5 < 2) want[k].bad++
      if (i % 5 === 1) want[k].wrong++
    })
    for (const [k, w] of Object.entries(want)) expect(p.heat!.cells[k]).toMatchObject({ ...w, d: today, l: notesLesson.id })
    const graded = rs.filter((r) => r.errMs !== null && r.verdict !== 'wrong')
    expect(p.heat!.cells['t:notes'].n).toBe(graded.length)
    expect(Object.keys(p.heat!.cells).some((k) => k.startsWith('c:'))).toBe(false)
  })

  it('adds no timing cell without a calibration', () => {
    const c = buildChart(notesLesson)
    const rs = c.events.filter((e) => e.kind === 'note').map((e) => jr(e.id, 'note', 'good', 0))
    const p = recordHeat(P0, notesLesson, c, rs, { sourceId: notesLesson.id, calibrated: false, now })
    expect(p.heat!.cells['t:notes']).toBeUndefined()
  })

  it('a chord that rang wrong counts as bad and wrong; muted strums get no cell', () => {
    const c = buildChart(chordsLesson)
    const rs = c.events.filter((e) => e.kind !== 'rest').map((e, i) => jr(e.id, e.kind, 'good', 0, e.kind === 'chord' && i % 3 === 0 ? { chordOk: false } : {}))
    const p = recordHeat(P0, chordsLesson, c, rs, { sourceId: chordsLesson.id, calibrated: true, now })
    const cells = Object.entries(p.heat!.cells).filter(([k]) => k.startsWith('c:'))
    const rang = rs.filter((r) => r.chordOk === false).length
    expect(cells.reduce((a, [, x]) => a + x.bad, 0)).toBe(rang)
    expect(cells.reduce((a, [, x]) => a + x.wrong, 0)).toBe(rang)
    expect(cells.some(([k]) => k === 'c:mute')).toBe(false)
    expect(Object.keys(p.heat!.cells).filter((k) => k.startsWith('t:'))).toEqual(['t:chords'])
  })

  it('sync and improv runs add nothing', () => {
    for (const l of [lessonById('w1-01')!, LESSONS.find((x) => x.type === 'improv')!]) {
      expect(recordHeat(P0, l, buildChart(l), [], { sourceId: l.id, calibrated: true, now })).toBe(P0)
    }
  })
})

describe('fading', () => {
  const c = buildChart(notesLesson)
  const e = c.events.find((x) => x.kind === 'note')!
  const k = e.kind === 'note' ? `n:${e.string}.${e.fret}` : ''
  const base: Progress = {
    ...P0,
    heat: {
      v: 1,
      cells: {
        [k]: cell(10, { bad: 4, wrong: 2, d: today - 20, l: notesLesson.id }),
        'n:5.14': cell(8, { bad: 8, d: today - 20 }),
        'n:4.13': cell(8, { bad: 8, d: today - 61 }),
        'n:3.13': cell(0.5, { d: today - 40 }),
      },
    },
  }

  it('halves every 20 days and drops cells over 60 days or faded under 0.3', () => {
    const dec = decayed(base.heat, now)
    expect(dec['n:5.14'].n).toBeCloseTo(4)
    expect(dec['n:5.14'].bad).toBeCloseTo(4)
    expect(dec['n:4.13']).toBeUndefined()
    expect(dec['n:3.13']).toBeUndefined()
  })

  it('only touched cells are faded and re-dated on record', () => {
    const same = c.events.filter((x) => x.kind === 'note' && e.kind === 'note' && x.string === e.string && x.fret === e.fret)
    const rs = same.map((x) => jr(x.id, 'note', 'good', 0))
    const p = recordHeat(base, notesLesson, c, rs, { sourceId: notesLesson.id, calibrated: false, now })
    expect(p.heat!.cells[k].n).toBeCloseTo(5 + same.length)
    expect(p.heat!.cells[k].bad).toBeCloseTo(2)
    expect(p.heat!.cells[k].d).toBe(today)
    expect(p.heat!.cells['n:5.14']).toMatchObject({ n: 8, d: today - 20 })
    expect(p.heat!.cells['n:4.13']).toBeUndefined()
    const later = recordHeat(p, notesLesson, c, rs, { sourceId: notesLesson.id, calibrated: false, now: new Date(now.getTime() + HALF_LIFE_DAYS * 86400000) })
    expect(later.heat!.cells[k].n).toBeCloseTo((5 + same.length) / 2 + same.length, 1)
    for (const x of Object.values(later.heat!.cells)) for (const v of Object.values(x)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
  })
})

describe('MAX_CELLS', () => {
  it('trims to the heaviest cells on record', () => {
    const cells: Record<string, HeatCell> = {}
    let i = 0
    for (let s = 0; s < 6 && i < MAX_CELLS; s++) for (let f = 0; f <= 24 && i < MAX_CELLS; f++, i++) cells[`n:${s}.${f}`] = cell(2 + (i % 7), { bad: 1 })
    const full: Progress = { ...P0, heat: { v: 1, cells } }
    const c = buildChart(chordsLesson)
    const rs = c.events.filter((e) => e.kind === 'chord').map((e) => jr(e.id, 'chord', 'miss', null))
    const p = recordHeat(full, chordsLesson, c, rs, { sourceId: chordsLesson.id, calibrated: false, now })
    const keys = Object.keys(p.heat!.cells)
    expect(keys).toHaveLength(MAX_CELLS)
    const minKept = Math.min(...keys.map((x) => p.heat!.cells[x].n))
    const dropped = Object.keys(cells).filter((x) => !p.heat!.cells[x])
    expect(Math.max(0, ...dropped.map((x) => cells[x].n))).toBeLessThanOrEqual(minKept)
  })

  it('normalizeHeat caps, clamps and drops junk', () => {
    expect(normalizeHeat(null)).toBeUndefined()
    expect(normalizeHeat({ v: 2, cells: {} })).toBeUndefined()
    const h = normalizeHeat({ v: 1, cells: { 'n:0.0x': cell(3), 'c:Am': cell(3, { bad: 9, wrong: 9, err: -5 }), 'n:1.1': { n: -1 }, 'x:1': cell(3) } })!
    expect(Object.keys(h.cells)).toEqual(['c:Am'])
    expect(h.cells['c:Am']).toMatchObject({ bad: 3, wrong: 3, err: -5 })
  })
})

describe('spots', () => {
  const cells: Record<string, HeatCell> = {
    'n:3.7': cell(20, { bad: 10, wrong: 8 }),
    'n:0.0': cell(10, { bad: 6 }),
    'n:5.12': cell(12, { late: 5 }),
    'c:G': cell(15, { bad: 9, wrong: 9 }),
    'c:Am': cell(10, { bad: 4 }),
    'c:D': cell(30, { early: 9 }),
    't:notes': cell(40, { err: -40 * 60, early: 30 }),
    't:rhythm': cell(30, { err: 30 * 50, late: 20 }),
    't:chords': cell(30, { err: 30 * 10 }), // a small lean: no spot
    'n:1.1': cell(3, { bad: 3 }), // too few tries
    'n:2.2': cell(30, { bad: 1 }), // clean
  }
  const h = { v: 1 as const, cells }

  it('topSpots: at most 5, worst first, thin and clean cells left out', () => {
    const all = topSpots(h, now, 50)
    const top = topSpots(h, now)
    expect(top).toHaveLength(5)
    expect(top.map((s) => s.key)).toEqual(all.slice(0, 5).map((s) => s.key))
    for (let i = 1; i < top.length; i++) expect(top[i - 1].score).toBeGreaterThanOrEqual(top[i].score)
    expect(all.map((s) => s.key)).not.toContain('n:1.1')
    expect(all.map((s) => s.key)).not.toContain('n:2.2')
    expect(all.map((s) => s.key)).not.toContain('t:chords')
  })

  it('names the right problem for each spot', () => {
    const by = Object.fromEntries(topSpots(h, now, 50).map((s) => [s.key, s.problem]))
    expect(by).toMatchObject({ 'c:G': 'muddy', 'n:3.7': 'wrong', 'n:0.0': 'miss', 'n:5.12': 'late', 'c:D': 'early', 't:notes': 'early', 't:rhythm': 'late' })
  })

  it('spot sentences never show string.fret notation, NaN or undefined', () => {
    const keys = ['n:0.0', 'n:0.5', 'n:5.15', 'n:3.12', 'c:G', 'c:F#m7', 'c:Bb', 't:notes', 't:chords', 't:rhythm']
    for (const k of keys) {
      expect(spotLabel(k)).not.toMatch(LEAK)
      for (const pr of ['wrong', 'miss', 'early', 'late', 'muddy'] as const)
        for (const ms of [null, 42.6, -61]) {
          const c = spotCopy(k, pr, ms)
          expect(c.text).not.toMatch(LEAK)
          expect(c.advice).not.toMatch(LEAK)
        }
    }
    expect(spotLabel('n:3.7')).toBe('G string fret 7')
    expect(spotLabel('n:0.0')).toBe('low E string, open')
  })

  it('guards against empty cells', () => {
    expect(spotFor('t:notes', cell(0))).toBeNull()
    expect(timingRows({}).every((r) => r.meanMs === null && r.n === 0)).toBe(true)
    expect(noteNameRows({}).every((r) => r.rate === 0)).toBe(true)
  })
})

describe('drills', () => {
  const problems = ['wrong', 'miss', 'early', 'late', 'muddy'] as const
  const chordSrc = new Map<string, Lesson>()
  for (const l of LESSONS) for (const b of l.chordBars ?? []) if (b.chord !== 'mute' && !chordSrc.has(b.chord)) chordSrc.set(b.chord, l)
  const keys: [string, Lesson | undefined][] = []
  for (let s = 0; s < 6; s++) for (let f = 0; f <= 15; f++) keys.push([`n:${s}.${f}`, notesLesson])
  for (const [sym, l] of chordSrc) keys.push([`c:${sym}`, l])
  keys.push(['c:C', undefined], ['c:Em', undefined], ['t:notes', notesLesson], ['t:chords', notesLesson], ['t:rhythm', notesLesson])

  it('every drill chart is a valid 2-bar lesson that plays its spot', () => {
    const bad: string[] = []
    for (const [key, src] of keys)
      for (const pr of problems) {
        const d = drillLesson(key, pr, src)
        if (!d) {
          bad.push(`${key}/${pr}: null`)
          continue
        }
        LESSONS.push(d)
        try {
          bad.push(...validateLessons().filter((m) => m.startsWith(d.id + ':') && !/listed 0 times/.test(m)))
        } finally {
          LESSONS.pop()
        }
        const c = buildChart(d)
        if (d.bars !== 2 || c.bars !== 2) bad.push(`${key}/${pr}: bars`)
        if (d.bpm < 60 || d.bpm > 80) bad.push(`${key}/${pr}: bpm ${d.bpm}`)
        if (!c.events.some((e) => e.kind !== 'rest')) bad.push(`${key}/${pr}: nothing to judge`)
        if (/\b\d\.\d+\b/.test(d.title + d.goal + d.tips.join(' '))) bad.push(`${key}/${pr}: notation leak`)
        const m = /^n:(\d)\.(\d+)$/.exec(key)
        if (m && !c.events.some((e) => e.kind === 'note' && e.string === +m[1] && e.fret === +m[2])) bad.push(`${key}/${pr}: target note missing`)
        if (key.startsWith('c:') && !c.events.some((e) => e.kind === 'chord' && e.symbol === key.slice(2))) bad.push(`${key}/${pr}: target chord missing`)
      }
    expect(bad).toEqual([])
  })

  it('no drill above fret 15', () => {
    expect(drillLesson('n:2.16', 'miss', notesLesson)).toBeNull()
    expect(drillLesson('x:1', 'miss', notesLesson)).toBeNull()
  })

  it('drillSpec builds a loop from a heat cell, with a fallback lesson', () => {
    const p: Progress = { ...P0, heat: { v: 1, cells: { 'n:2.7': cell(20, { bad: 10, wrong: 9, l: notesLesson.id }), 'c:G': cell(20, { bad: 10, wrong: 9, l: 'gone' }) } } }
    const ds = drillSpec(p, 'n:2.7', now)!
    expect(ds).toMatchObject({ kind: 'drill', fromBar: 0, toBar: 1, startSpeed: DRILL_START, targetSpeed: 1, sourceId: notesLesson.id, drillKey: 'n:2.7' })
    expect(drillSpec(p, 'c:G', now)).toBeNull()
    expect(drillSpec(p, 'c:G', now, chordsLesson.id)?.sourceId).toBe(chordsLesson.id)
  })
})
