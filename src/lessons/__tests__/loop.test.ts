import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { JudgeResult, LoopSpec, LoopSummary, Progress } from '../types'
import { LESSONS } from '../data'
import { buildChart } from '../charts'
import { FAST_PASSES, LOOP_MIN_SPEED, LOOP_REPS, LoopSession, REST_SEC, SLOW_PASSES, decideFast, hardRange, loopLesson, loopSpecFor, loopTitle, playable, recordLoop, sliceChart, slowSpeed, withCalls } from '../loop'
import type { LoopView } from '../loop'
import { LessonRun } from '../run'
import { drillLesson } from '../drill'
import { newProgress } from '../progress'
import { snapSpeed, tempoStep } from '../speed'
import { at, jr, rec, result } from './fixtures'

const notesL = LESSONS.find((l) => l.type === 'notes' && !l.calls && !l.seq?.includes('r'))!
const callsL = LESSONS.filter((l) => l.calls)
const improvL = LESSONS.filter((l) => l.type === 'improv')

describe('sliceChart and loopLesson', () => {
  const sample = [...LESSONS.filter((l) => l.type === 'notes').slice(0, 4), ...callsL.slice(0, 2), ...LESSONS.filter((l) => l.type === 'chords' || l.type === 'rhythm').slice(0, 4)]

  it('repeats the bars, re-based and renumbered in beat order, for every pass', () => {
    const bad: string[] = []
    for (const l of sample) {
      const chart = buildChart(l)
      const B = chart.bars
      const mid = Math.floor(B / 2)
      for (const [f0, t0] of [[0, 0], [0, Math.min(1, B - 1)], [mid, mid], [B - 1, B - 1]]) {
        const { from, to } = withCalls(chart, f0, t0)
        const tag = `${l.id} ${from}-${to}`
        const nb = to - from + 1
        const pb = 4 * nb
        const s = sliceChart(chart, from, to, LOOP_REPS)
        const src = chart.events.filter((e) => e.beat >= from * 4 && e.beat < (to + 1) * 4)
        const n = src.length
        if (s.events.length !== n * LOOP_REPS) bad.push(`${tag}: event count`)
        if (s.bars !== nb * LOOP_REPS || s.totalBeats !== pb * LOOP_REPS) bad.push(`${tag}: length`)
        if (!s.events.every((e, i) => e.id === i)) bad.push(`${tag}: ids`)
        for (let i = 1; i < s.events.length; i++) if (s.events[i].beat < s.events[i - 1].beat) bad.push(`${tag}: order`)
        for (let k = 0; k < LOOP_REPS; k++)
          for (let i = 0; i < n; i++) {
            const e = s.events[k * n + i]
            if (Math.abs(e.beat - (src[i].beat - from * 4 + k * pb)) > 1e-9 || e.kind !== src[i].kind) bad.push(`${tag}: pass ${k} event ${i}`)
          }
        if (s.chordTimeline.length !== s.bars || s.chordTimeline.some((c, i) => c.beat !== 4 * i)) bad.push(`${tag}: chord timeline`)
        if (s.listenBars.some((b) => b < 0 || b >= s.bars)) bad.push(`${tag}: listen bars`)
        const ll = loopLesson(l, from, to, LOOP_REPS)
        if (ll.bars !== nb * LOOP_REPS || ll.countInBeats !== 4) bad.push(`${tag}: loop lesson`)
        if (l.backing) for (let i = 0; i < nb; i++) if (ll.backing!.chords[i] !== l.backing.chords[(from + i) % l.backing.chords.length]) bad.push(`${tag}: band chord ${i}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('a call & response loop keeps the call with its answer', () => {
    for (const l of callsL.slice(0, 2)) {
      const c = buildChart(l)
      const call = c.listenBars[0]
      expect(withCalls(c, call + 1, call + 1)).toEqual({ from: call, to: call + 1 })
      expect(withCalls(c, call, call)).toEqual({ from: call, to: call + 1 })
    }
  })

  it('jams have no bar to loop', () => {
    for (const l of improvL) {
      const c = buildChart(l)
      for (let b = 0; b < c.bars; b++) expect(playable(c, b, b)).toBe(false)
      expect(hardRange(c, new Array(c.bars).fill(0.2))).toBeNull()
    }
  })

  it('hardRange takes the weakest bar and a weak bar after it, only under 90%', () => {
    const c = buildChart(notesL)
    const acc = new Array<number | null>(c.bars).fill(1)
    expect(hardRange(c, acc)).toBeNull()
    acc[1] = 0.5
    acc[2] = 0.8
    expect(hardRange(c, acc)).toEqual({ from: 1, to: 2 })
    acc[2] = 0.95
    expect(hardRange(c, acc)).toEqual({ from: 1, to: 1 })
    expect(loopTitle(1, 1)).toBe('Bar 2')
    expect(loopTitle(1, 2)).toBe('Bars 2–3')
  })
})

describe('loopSpecFor speed ramp', () => {
  // 70% of the run's speed (at least two tempo steps under it), up to full speed; far under full speed aims nearer
  const step = tempoStep(notesL)
  it.each([0.6, 0.7, 0.85, 1, 1.1])('a run at %s', (speed) => {
    const s = loopSpecFor(notesL, result({ speed }), 1, 1)
    const start = Math.max(LOOP_MIN_SPEED, Math.min(1, snapSpeed(Math.min(speed * 0.7, speed - 2 * step))))
    expect(s.startSpeed).toBeCloseTo(start)
    expect(s.startSpeed).toBeGreaterThanOrEqual(LOOP_MIN_SPEED)
    expect(s.startSpeed).toBeLessThan(speed)
    if (speed >= 0.8) expect(s.targetSpeed).toBe(1)
    else expect(s.targetSpeed).toBeCloseTo(Math.min(1, snapSpeed(Math.max(speed + 2 * step, start + 6 * step))))
    expect(s).toMatchObject({ kind: 'bars', fromBar: 1, toBar: 1, sourceId: notesL.id, title: 'Bar 2' })
  })
})

describe('recordLoop', () => {
  const sum = (clean: number, earned: number) => ({ passes: [], clean, topSpeed: earned, reached: false, earned, results: [], chart: buildChart(notesL), calibrated: false }) as LoopSummary
  const now = at('2026-03-04')

  it('counts a loop with a clean pass on the lesson record, and marks the day (not cold any more)', () => {
    const p: Progress = { ...newProgress(), lessons: { [notesL.id]: rec({ loops: 1, loopTop: 0.9 }) } }
    expect(recordLoop(p, notesL.id, sum(0, 0), now)).toBe(p)
    expect(recordLoop(p, 'nope', sum(2, 1), now)).toBe(p)
    const q = recordLoop(p, notesL.id, sum(2, 0.8), now)
    expect(q.lessons[notesL.id]).toMatchObject({ loops: 2, loopTop: 0.9, loopDay: '2026-03-04' })
    expect(recordLoop(p, notesL.id, sum(1, 0.95), now).lessons[notesL.id].loopTop).toBe(0.95)
    expect(p.lessons[notesL.id].loops).toBe(1)
  })
})

describe('decideFast', () => {
  const W = 0.8
  const T = 1
  const S = 0.04
  it.each([
    [[], null, false],
    [[false], 0.76, false],
    [[true], null, false],
    [[true, false], null, false],
    [[true, true, true], 0.84, true],
    [[true, false, true, true], 0.84, true],
    [[true, false, false, true], 0.8, false],
    [[true, true, false, false], 0.8, false],
  ] as [boolean[], number | null, boolean][])('%j -> %s', (passes, next, earned) => {
    const d = decideFast(passes, W, T, S)
    expect(d.earned).toBe(earned)
    if (next === null) expect(d.next).toBeNull()
    else expect(d.next).toBeCloseTo(next)
  })

  it('earned at the target is done; never under the loop floor; never over the target', () => {
    expect(decideFast([true, true, true], 1, 1, S)).toEqual({ next: 'done', earned: true })
    expect(decideFast([false], LOOP_MIN_SPEED, 1, S).next).toBe(LOOP_MIN_SPEED)
    expect(decideFast([true, true, true], 0.98, 1, S).next).toBe(1)
  })
})

// ---- LoopSession, driven by a fake run: no audio, results fed by hand ----

interface FakeJudge {
  results: Map<number, JudgeResult>
  pending: Set<number>
  settled: (id: number) => boolean
}
const inside = (r: LessonRun) => r as unknown as { judge: FakeJudge; endBeat: number }
const fakeJudge = (): FakeJudge => {
  const results = new Map<number, JudgeResult>()
  const pending = new Set<number>()
  return { results, pending, settled: (id) => results.has(id) && !pending.has(id) }
}
const OPTS = { easyTiming: false, backingOn: false, keyboard: true, mic: false, autoplay: null }
const timers: (() => void)[] = []

beforeAll(() => {
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: () => {},
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(LessonRun.prototype, 'start').mockImplementation(async function (this: LessonRun) {
    this.state = 'playing'
  })
  vi.spyOn(LessonRun.prototype, 'endAt').mockImplementation(function (this: LessonRun, beat: number) {
    if (beat >= this.lastBeat) return false
    inside(this).endBeat = beat
    return true
  })
})
afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Plays passes; share(pass, speed) is the share of good events in it. `keepRest`: end the last run, but leave its rest running. */
async function drive(spec: LoopSpec, share: (pass: number, speed: number) => number, maxPasses = 60, log: LoopView[] = [], o: { keepRest?: boolean } = {}) {
  const ses = new LoopSession(spec, OPTS)
  ses.onChange = (v) => log.push(v)
  const cur: { run: LessonRun | null; k: number } = { run: null, k: 0 }
  ses.onRun = (r) => {
    cur.run = r
    cur.k = 0
    inside(r).judge = fakeJudge()
  }
  timers.length = 0
  ses.start()
  await Promise.resolve()
  const pb = 4 * (spec.toBar - spec.fromBar + 1)
  const n = ses.chart.events.filter((e) => e.beat < pb).length
  let played = 0
  while (played < maxPasses && ses.view.phase !== 'done') {
    const run = cur.run!
    if ((cur.k + 1) * pb > run.lastBeat + 1e-9) {
      run.state = 'ended'
      run.onState?.('ended')
      while (timers.length) timers.shift()!()
      await Promise.resolve()
      continue
    }
    const good = Math.round(share(played, ses.view.speed) * n)
    for (let i = 0; i < n; i++) {
      const id = cur.k * n + i
      const e = ses.chart.events[id]
      const ok = i < good
      const r = jr(id, e.kind, e.kind === 'rest' ? (ok ? 'clean-stop' : 'miss') : ok ? 'good' : 'miss', ok ? 0 : null)
      inside(run).judge.results.set(id, r)
      run.onJudge?.(r, null)
    }
    cur.k++
    played++
  }
  if (o.keepRest && cur.run) {
    cur.run.state = 'ended'
    cur.run.onState?.('ended')
  }
  return ses
}

describe('LoopSession', () => {
  const drill = (start: number, target: number): LoopSpec => {
    const d = drillLesson('n:2.7', 'wrong', notesL)!
    return { kind: 'drill', lesson: d, fromBar: 0, toBar: 1, startSpeed: start, targetSpeed: target, title: 'x', sourceId: notesL.id }
  }
  /** The segments in order: 'F0.85' fast at 0.85, 'S0.76' slow, 'R' a rest. */
  const segments = (log: LoopView[]) => {
    const out: string[] = []
    for (const v of log) {
      const tag = v.phase === 'rest' ? 'R' : v.phase === 'idle' ? `${v.seg === 'fast' ? 'F' : 'S'}${v.speed}` : null
      if (tag && out[out.length - 1] !== tag) out.push(tag)
    }
    return out
  }

  it('earns a tempo with 3 clean passes; fast, slow, rest, then one step faster until done at the target', async () => {
    const spec = drill(0.85, 1)
    const step = tempoStep(spec.lesson)
    const log: LoopView[] = []
    const ses = await drive(spec, () => 1, 200, log)
    const w = [0.85, snapSpeed(0.85 + step), snapSpeed(0.85 + 2 * step)]
    expect(ses.view.phase).toBe('done')
    const fast = ses.view.passes.filter((p) => !p.slow)
    const slow = ses.view.passes.filter((p) => p.slow)
    expect(fast.slice(0, 6).map((p) => p.speed)).toEqual([w[0], w[0], w[0], w[1], w[1], w[1]])
    expect(slow.slice(0, SLOW_PASSES).map((p) => p.speed)).toEqual([slowSpeed(w[0], step), slowSpeed(w[0], step)])
    expect(segments(log).slice(0, 4)).toEqual([`F${w[0]}`, `S${slowSpeed(w[0], step)}`, 'R', `F${w[1]}`])
    const s = ses.summary()!
    expect(s.reached).toBe(true)
    expect(s.earned).toBe(1)
    expect(s.clean).toBe(fast.length)
  })

  it('a first pass that is not clean ends the fast segment; the next one is a step slower', async () => {
    const spec = drill(0.85, 1)
    const step = tempoStep(spec.lesson)
    const log: LoopView[] = []
    const ses = await drive(spec, (i) => (i === 0 ? 0.5 : 1), 4, log)
    const p = ses.view.passes
    expect(p[0]).toMatchObject({ speed: 0.85, clean: false })
    expect(p.slice(1, 3).every((x) => x.slow)).toBe(true)
    expect(p[3].speed).toBe(snapSpeed(0.85 - step))
    expect(segments(log)).toEqual(['F0.85', `S${slowSpeed(0.85, step)}`, 'R', `F${snapSpeed(0.85 - step)}`])
    expect(ses.summary()!.earned).toBe(0)
  })

  it('four passes without 3 clean: the same tempo again after slow passes and a rest', async () => {
    const seq = [1, 0.5, 0.5, 1]
    const ses = await drive(drill(0.85, 1), (i) => seq[i] ?? 1, FAST_PASSES + SLOW_PASSES + 1)
    const p = ses.view.passes
    expect(p.slice(0, 4).map((x) => x.clean)).toEqual([true, false, false, true])
    expect(p[FAST_PASSES + SLOW_PASSES].speed).toBe(0.85)
  })

  it('slow passes never decide anything and never count as clean', async () => {
    const seq = [0.5, 1, 1, 1]
    const ses = await drive(drill(0.85, 1), (i) => seq[i] ?? 1, 3)
    expect(ses.view.clean).toBe(0)
    expect(ses.summary()!.clean).toBe(0)
  })

  it('"Go now" ends a rest at once, and does nothing outside a rest', async () => {
    const seq = [0.5, 1, 1]
    const ses = await drive(drill(0.85, 1), (i) => seq[i] ?? 1, 3, [], { keepRest: true })
    expect(ses.view.phase).toBe('rest')
    expect(ses.view.restLeft).toBe(REST_SEC)
    ses.skipRest()
    expect(ses.view).toMatchObject({ phase: 'idle', seg: 'fast' })
    ses.skipRest()
    expect(ses.view).toMatchObject({ phase: 'idle', seg: 'fast' })
    ses.stop()
  })

  it.each(['fail', 'pass'] as const)('waits for a pending chord check before closing the pass (%s)', async (outcome) => {
    const src = LESSONS.find((l) => l.type === 'chords' && l.chordBars?.some((b) => b.chord !== 'mute'))!
    const sym = src.chordBars!.find((b) => b.chord !== 'mute')!.chord
    const dl = drillLesson('c:' + sym, 'muddy', src)!
    const ses = new LoopSession({ kind: 'drill', lesson: dl, fromBar: 0, toBar: 1, startSpeed: 0.85, targetSpeed: 1, title: 't', sourceId: src.id }, OPTS)
    const cur: { run: LessonRun | null } = { run: null }
    ses.onRun = (r) => {
      cur.run = r
      inside(r).judge = fakeJudge()
    }
    ses.start()
    await Promise.resolve()
    const run = cur.run!
    const j = inside(run).judge
    const n = ses.chart.events.filter((e) => e.beat < 8).length
    const chromaId = ses.chart.events.findIndex((e, i) => i < n && e.kind === 'chord' && e.chroma)
    expect(chromaId).toBeGreaterThanOrEqual(0)
    const rs: JudgeResult[] = []
    for (let i = 0; i < n; i++) {
      const e = ses.chart.events[i]
      const r = jr(i, e.kind, 'good', 0, i === chromaId ? { chordOk: null } : {})
      rs.push(r)
      j.results.set(i, r)
      if (i === chromaId) j.pending.add(i)
      run.onJudge?.(r, null)
    }
    expect(ses.view.next).toBeNull()
    expect(ses.view.passes).toHaveLength(0)
    rs[chromaId].chordOk = outcome === 'pass'
    j.pending.delete(chromaId)
    run.onSettle?.(chromaId)
    const p = ses.view.passes
    expect(p).toHaveLength(1)
    if (outcome === 'fail') {
      // a first pass that isn't clean decides at once: one step slower
      expect(p[0].clean).toBe(false)
      expect(p[0].acc).toBeCloseTo((n - 1) / n)
      expect(ses.view.next).toBeCloseTo(snapSpeed(0.85 - ses.step))
    } else {
      // clean, but one clean pass doesn't earn the tempo yet
      expect(p[0].clean).toBe(true)
      expect(ses.view.next).toBeNull()
      expect(ses.view.note).toMatch(/2 more clean/)
    }
  })
})
