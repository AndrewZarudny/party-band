import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { JudgeResult, LoopSpec, LoopSummary, Progress } from '../types'
import { LESSONS } from '../data'
import { buildChart } from '../charts'
import { LOOP_MIN_SPEED, LOOP_REPS, LoopSession, hardRange, loopLesson, loopSpecFor, loopTitle, playable, recordLoop, sliceChart, withCalls } from '../loop'
import { LessonRun } from '../run'
import { drillLesson } from '../drill'
import { newProgress } from '../progress'
import { jr, rec, result } from './fixtures'

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
  it.each([
    [0.6, 0.5, 0.8],
    [0.7, 0.5, 0.8],
    [0.85, 0.6, 1],
    [1, 0.7, 1],
    [1.1, 0.75, 1],
  ])('a run at %s loops from %s to %s', (speed, start, target) => {
    const s = loopSpecFor(notesL, result({ speed }), 1, 1)
    expect(s.startSpeed).toBeCloseTo(start)
    expect(s.targetSpeed).toBeCloseTo(target)
    expect(s.startSpeed).toBeGreaterThanOrEqual(LOOP_MIN_SPEED)
    expect(s.startSpeed).toBeLessThan(speed)
    expect(s).toMatchObject({ kind: 'bars', fromBar: 1, toBar: 1, sourceId: notesL.id, title: 'Bar 2' })
  })
})

describe('recordLoop', () => {
  const sum = (clean: number, topSpeed: number) => ({ passes: [], clean, topSpeed, reached: false, results: [], chart: buildChart(notesL), calibrated: false }) as LoopSummary

  it('counts a loop with a clean pass on the lesson record, nothing else', () => {
    const p: Progress = { ...newProgress(), lessons: { [notesL.id]: rec({ loops: 1, loopTop: 0.9 }) } }
    expect(recordLoop(p, notesL.id, sum(0, 0))).toBe(p)
    expect(recordLoop(p, 'nope', sum(2, 1))).toBe(p)
    const q = recordLoop(p, notesL.id, sum(2, 0.8))
    expect(q.lessons[notesL.id]).toMatchObject({ loops: 2, loopTop: 0.9 })
    expect(p.lessons[notesL.id].loops).toBe(1)
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

/** Plays passes; share(pass, speed) is the share of good events in it. */
async function drive(spec: LoopSpec, share: (pass: number, speed: number) => number, maxPasses = 60) {
  const ses = new LoopSession(spec, OPTS)
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
  return ses
}

describe('LoopSession', () => {
  it('clean passes go up 5% each until a clean pass at the target', async () => {
    const ses = await drive(loopSpecFor(notesL, result({ speed: 0.6 }), 1, 1), () => 1)
    expect(ses.view.passes.map((p) => p.speed)).toEqual([0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8])
    expect(ses.view.phase).toBe('done')
    const s = ses.summary()!
    expect(s).toMatchObject({ reached: true, clean: 7 })
    expect(s.topSpeed).toBeCloseTo(0.8)
  })

  it('three sloppy passes in a row ease off 5%, never under the 50% floor', async () => {
    const ses = await drive(loopSpecFor(notesL, result({ speed: 1 }), 1, 1), () => 0.4, 40)
    const sp = ses.view.passes.map((p) => p.speed)
    const drops: number[] = []
    for (let i = 1; i < sp.length; i++) if (sp[i] !== sp[i - 1]) drops.push(i)
    expect(drops.length).toBeGreaterThan(0)
    expect(drops.every((i, j) => i === 3 * (j + 1))).toBe(true)
    for (const i of drops) expect(sp[i - 1] - sp[i]).toBeCloseTo(0.05)
    expect(Math.min(...sp)).toBeGreaterThanOrEqual(LOOP_MIN_SPEED - 1e-9)
    expect(sp[sp.length - 1]).toBeCloseTo(LOOP_MIN_SPEED)
  })

  it('up twice, then eased after 3 sloppy passes', async () => {
    const seq = [1, 1, 0.3, 0.3, 0.3, 1]
    const ses = await drive(loopSpecFor(notesL, result({ speed: 1 }), 1, 1), (i) => seq[i] ?? 1, 6)
    expect(ses.view.passes.map((p) => p.speed)).toEqual([0.7, 0.75, 0.8, 0.8, 0.8, 0.75])
  })

  it('a drill ramps from 85% to 100%', async () => {
    const d = drillLesson('n:2.7', 'wrong', notesL)!
    const spec: LoopSpec = { kind: 'drill', lesson: d, fromBar: 0, toBar: 1, startSpeed: 0.85, targetSpeed: 1, title: 'x', sourceId: notesL.id }
    const ses = await drive(spec, () => 1)
    expect(ses.view.passes.map((p) => p.speed)).toEqual([0.85, 0.9, 0.95, 1])
    expect(ses.view.phase).toBe('done')
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
      expect(p[0].clean).toBe(false)
      expect(p[0].acc).toBeCloseTo((n - 1) / n)
      expect(ses.view.next).toBeNull()
    } else {
      expect(p[0].clean).toBe(true)
      expect(ses.view.next).toBeCloseTo(0.9)
    }
  })
})
