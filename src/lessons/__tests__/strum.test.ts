// Strum timing: a strum played on the beat, with the last chord still ringing, must be measured on the beat.
// Week 1 showed every chord lesson about 75-170 ms early while single notes were on time; these tests replay
// that through the real detector, input and judge.
import { describe, expect, it } from 'vitest'
import type { AudioClock } from '../clock'
import { engine } from '../../audio/engine'
import { LESSONS } from '../data'
import { buildChart } from '../charts'
import { LessonInput } from '../input'
import { CHROMA_MIN_FRAMES, Judge, STRUM_SHIFT_MS, WINDOWS } from '../judge'
import { CONF_LOW } from '../chroma'
import type { Chart, ChordEv, InputOnset, JudgeResult } from '../types'
import { chartOf, chord, frames, onset } from './fixtures'
import { mean, onsetsOf, simulate, strum } from './strumSim'
import type { Pluck } from './strumSim'

const START = 2 // audio time of beat 0

/** A lesson strummed by the simulator: every strum's first string `firstAtMs` from its beat. */
function play(id: string, speed: number, gapMs: number, o: { firstAtMs?: number; rolloff?: number; onTick?: (j: Judge, now: number) => void } = {}) {
  const lesson = LESSONS.find((l) => l.id === id)!
  const chart = buildChart(lesson)
  const bpm = Math.round(lesson.bpm * speed)
  const spb = 60 / bpm
  const plucks: Pluck[] = []
  const strums = new Map<number, number>()
  for (const e of chart.events) {
    if (e.kind !== 'chord') continue
    const t = START + e.beat * spb + (o.firstAtMs ?? 0) / 1000
    strums.set(e.id, t)
    plucks.push(...strum(e, t, gapMs))
  }
  const s = simulate({ chart, bpm, plucks, start: START, rolloff: o.rolloff, onTick: o.onTick })
  const errs = s.results.filter((r) => r.errMs !== null).map((r) => r.errMs!)
  return { chart, strums, summary: s, errs, mean: mean(errs) }
}

describe('what the detector hears from a ringing chord', () => {
  it('re-triggers between strums, with no new string played', () => {
    const e = buildChart(LESSONS.find((l) => l.id === 'w4-01')!).events[0] as ChordEv
    const ons = onsetsOf([...strum(e, 1, 25), ...strum(e, 2, 25)], [], 3)
    const between = ons.filter((o) => o.t > 1.05 && o.t < 1.95)
    // These are what the judge used to take for the next strum: the earliest attack in its window.
    expect(between.length).toBeGreaterThanOrEqual(3)
  })
})

describe('strums on the beat over a ringing chord', () => {
  // The lessons from the week-1 data, at the speeds played (0.6-0.8), with slow to quick strums.
  const cases: [string, number][] = [
    ['w4-01', 0.7], // Power Pair: quarter-note downs
    ['w3-06', 0.6], // Downstroke Lock: quarters, then 8ths
    ['w3-09', 0.7], // Open A, D, E: downs, then down-ups
    ['w3-01', 0.8], // Strum Engine: downs, then 8th down-ups
  ]
  for (const [id, speed] of cases) {
    for (const gap of [10, 25, 40]) {
      it(`${id} at ${speed}, strings ${gap} ms apart: the mean error is the strum's own timing`, () => {
        const { errs, mean: m, summary } = play(id, speed, gap)
        expect(errs.length).toBe(summary.results.length) // every strum heard
        // first string on the beat = STRUM_SHIFT_MS late by the app's own rule
        expect(Math.abs(m - STRUM_SHIFT_MS)).toBeLessThan(15)
        for (const e of errs) expect(Math.abs(e - STRUM_SHIFT_MS)).toBeLessThan(40)
      })
    }
  }

  it('real early and late strums are still measured as early and late', () => {
    expect(play('w4-01', 0.7, 25, { firstAtMs: -100 }).mean).toBeLessThan(-70)
    expect(play('w4-01', 0.7, 25, { firstAtMs: 80 }).mean).toBeGreaterThan(70)
  })

  it('a softer, rounder tone (fewer re-triggers) measures the same', () => {
    expect(Math.abs(play('w3-09', 0.7, 25, { rolloff: 2 }).mean - STRUM_SHIFT_MS)).toBeLessThan(15)
  })

  it('the ringing chord between strums is not counted as extra strums', () => {
    expect(play('w3-09', 0.7, 25).summary.extras).toBe(0)
  })

  it('the chord check listens after the real strum, so the last chord does not blur it', () => {
    // The check averages 170 ms analyser frames from 170 ms after the matched onset. Matched to a
    // re-trigger 100-200 ms early, its first frames heard mostly the chord before: an "unsure" check.
    // A soft attack held while the window is open opens a window too, which moves when a clearer strum comes:
    // what counts is when the last window opened.
    const opened = new Map<number, number>()
    let open = new Set<number>()
    const r = play('w3-09', 0.7, 25, {
      onTick: (j, now) => {
        const ids = j.chromaWindows(now)
        for (const id of ids) if (!open.has(id)) opened.set(id, now)
        open = new Set(ids)
      },
    })
    expect(opened.size).toBe(r.chart.events.filter((e) => e.kind === 'chord' && e.chroma).length)
    // 170 ms after the matched onset, which is within 40 ms of the strum (the timing tests above)
    for (const [id, t] of opened) expect(t - r.strums.get(id)!).toBeGreaterThanOrEqual(0.12)
  })
})

describe('Judge: picking the strum among attacks', () => {
  const SPB = 0.5
  const C = [0, 4, 7]
  const judgeFor = (c: Chart) =>
    new Judge(c, { start: 0, secPerBeat: SPB, windows: WINDOWS.normal, octaveOk: false, restGate: () => 0.01, listenBars: [], swing: false })
  // A chord at beat 2 (1 s), ringing at 0.05 and decaying; the strum at `strumT` lifts it to 0.12.
  const ringing = (strumT: number | null) => {
    const fs = frames(0, 200, null, 0.05).map((f) => ({ ...f, rms: 0.05 * Math.exp(-f.t / 3) }))
    return strumT === null ? fs : fs.map((f) => (f.t > strumT ? { ...f, rms: 0.12 } : f))
  }
  const attack = (t: number): InputOnset => ({ ...onset(t, null, 'attack'), peak: 0.05, strength: 2 })

  it('a re-trigger before the strum does not take its place', () => {
    const j = judgeFor(chartOf([chord(0, 2, 'C', C)]))
    for (const f of ringing(1)) j.frame(f)
    j.onset(attack(0.85))
    j.onset(attack(1))
    const out = j.tick(1.2)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ eventId: 0, verdict: 'perfect', errMs: STRUM_SHIFT_MS })
  })

  it('with no clear jump in level, the sharpest attack counts when the window closes', () => {
    const j = judgeFor(chartOf([chord(0, 2, 'C', C)]))
    const fs = ringing(null).map((f) => (f.t > 1.02 && f.t < 1.1 ? { ...f, rms: f.rms * 1.3 } : f)) // a soft strum
    for (const f of fs) j.frame(f)
    j.onset(attack(0.9))
    j.onset({ ...attack(1.02), strength: 12 })
    j.onset(attack(1.12)) // its later strings, after the refractory
    expect(j.tick(1.2)).toEqual([]) // still waiting for a clearer one
    const out = j.tick(2)
    expect(out[0]).toMatchObject({ eventId: 0, errMs: 20 + STRUM_SHIFT_MS })
  })

  it('a soft strum held until its window closes still gets a full chord check', () => {
    // A softer upstroke over the ringing downstroke: the level lifts only 1.3 times, so the strike waits for the
    // window to close (about 0.4 s later with wide windows and chords 0.6 s apart). The chord check listens
    // from 170 ms after the strike all the same, fed frame by frame as run.ts does.
    const c = chartOf([chord(0, 2, 'C', C, { chroma: true }), chord(1, 4, 'C', C, { chroma: true })])
    const j = new Judge(c, { start: 0, secPerBeat: 0.3, windows: { perfect: 160, good: 280, ok: 440, lateExtra: 20 }, octaveOk: false, restGate: () => 0.01, listenBars: [], swing: false })
    for (const f of frames(0, 200, null, 0.05)) j.frame(f.t > 0.555 && f.t < 0.65 ? { ...f, rms: 0.065 } : f)
    j.onset({ ...attack(0.55), strength: 12 }) // 50 ms early
    const on = new Float32Array(12)
    for (const p of C) on[p] = 1
    const out: JudgeResult[] = []
    let fed = 0
    for (let n = 1; n / 60 < 1.1; n++) {
      const t = n / 60
      out.push(...j.tick(t))
      const ids = j.chromaWindows(t)
      if (ids.includes(0)) fed++
      if (ids.length) j.addChroma(ids, on)
    }
    const r = out.find((x) => x.eventId === 0)!
    expect(r.errMs).toBe(-50 + STRUM_SHIFT_MS)
    expect(fed).toBeGreaterThanOrEqual(CHROMA_MIN_FRAMES)
    expect(r.chordConf).toBeGreaterThanOrEqual(CONF_LOW)
    expect(r.chordOk).toBe(true)
  })

  it('nothing in the window but the ring is still heard, as before', () => {
    const j = judgeFor(chartOf([chord(0, 2, 'C', C)]))
    for (const f of ringing(null)) j.frame(f)
    j.onset(attack(0.95))
    const s = j.finish()
    expect(s.results[0]).toMatchObject({ eventId: 0, errMs: -50 + STRUM_SHIFT_MS })
  })

  it('a strum from quiet, or a key or autoplay hit, counts at once', () => {
    const j = judgeFor(chartOf([chord(0, 2, 'C', C), chord(1, 4, 'C', C)]))
    for (const f of frames(0.5, 40, null, 0.001)) j.frame(f)
    j.onset(attack(1))
    expect(j.tick(1.13)[0]).toMatchObject({ eventId: 0, verdict: 'perfect' })
    j.onset(onset(2, null, 'key'))
    expect(j.tick(2.01)[0]).toMatchObject({ eventId: 1, verdict: 'perfect' })
  })
})

describe('LessonInput: a re-trigger must not hide the strum', () => {
  // Frames every 1/60 s at a steady ringing level; one detector onset per call.
  function drive(strums: boolean, levels: (t: number) => number, attacks: { t: number; ratio: number }[]) {
    let now = 0
    const clock = { now: () => now, fromPerf: () => now } as unknown as AudioClock
    const input = new LessonInput({ clock, offsetMs: 0, pitchLagMs: 35, onsetRatio: 1.4, refractoryMs: 90, strums, keyboard: false, useEngine: true })
    const out: InputOnset[] = []
    input.onOnset((o) => out.push(o))
    input.start()
    try {
      for (let n = 1; n < 120; n++) {
        now = n / 60
        engine.level.emit(levels(now))
        const a = attacks.find((x) => x.t <= now && x.t > now - 1 / 60)
        if (a) engine.onset.emit({ ratio: a.ratio, energy: 1, ageSec: now - a.t })
        engine.pitch.emit(null)
      }
    } finally {
      input.stop()
    }
    return out.map((o) => Math.round(o.t * 1000))
  }
  const ring = (strumT: number) => (t: number) => (t > strumT ? 0.12 : 0.05)

  it('a stronger attack inside the refractory replaces a re-trigger that never lifted the level', () => {
    expect(drive(true, ring(1), [{ t: 0.95, ratio: 2 }, { t: 1, ratio: 40 }])).toEqual([1000])
  })

  it('or follows it, when the re-trigger was already sent', () => {
    expect(drive(true, ring(0.987), [{ t: 0.9, ratio: 2 }, { t: 0.987, ratio: 40 }])).toEqual([900, 987])
  })

  it('single-note lessons keep the old refractory', () => {
    expect(drive(false, ring(1), [{ t: 0.95, ratio: 2 }, { t: 1, ratio: 40 }])).toEqual([950])
  })

  it('the strings of one strum do not move the strum', () => {
    // about as sharp as the first string
    expect(drive(true, ring(2), [{ t: 0.95, ratio: 18 }, { t: 0.99, ratio: 23 }])).toEqual([950])
    // far sharper, but the first string had already lifted the level
    expect(drive(true, ring(0.95), [{ t: 0.95, ratio: 5 }, { t: 1, ratio: 40 }])).toEqual([950])
  })
})
