// Fun lines after a lesson, built only from facts.json (sourced) and the run's own numbers. Pure.
// Rules: at most 2 lines (a performance or progress line, then a flavour line), no category twice,
// skip recently shown facts, timing lines only with enough graded hits.
import type { ExerciseType, FactLine, LastAttempt, LessonResult } from '../types'
import raw from './facts.json'

export type { FactLine }

export interface Fact {
  id: string
  category: string
  claim: string
  figure: string
  source_title: string
  source_url: string // one url, or several joined with ' ; '
  data: Record<string, unknown>
  caveat: string
  needsMetric?: string
}

export interface PickInput {
  result: LessonResult
  lessonType: ExerciseType
  boss: boolean
  step: number | null // beats per note unit (notes lessons)
  prev: LastAttempt | null // the previous run of this lesson
  bestBefore: number | null // best score before this run; null = first try
  bestChainBefore: number
  flat: number // runs in a row before this one with no new best
  failedBefore: boolean // earlier runs failed and the lesson was never passed
  firstBeatPass: boolean // first passed rhythm or sync lesson ever
  passedBefore: number // lessons passed before this run
  passedAfter: number
  streak: { before: number; after: number; counted: boolean } // counted = this run counted today
  totalSecBefore: number
  totalSecAfter: number
  recent: string[] // fact ids shown lately, oldest first
  age: number | null
  calibrated: boolean // a latency calibration was used, so meanErrMs means something
  hour: number // local hour, 0–23
}

export const RECENT_MAX = 10
export const MIN_GRADED = 12 // same as the re-sync threshold on the result card

export const FACTS: Fact[] = (raw as unknown as { facts: Fact[] }).facts
const BY_ID = new Map(FACTS.map((f) => [f.id, f]))

export const factById = (id: string): Fact | undefined => BY_ID.get(id)

/** Every fact id the rules below name (song tempos are matched by category). */
const USED_IDS = [
  'tba-01', 'tba-03', 'tba-04', 'tba-05', 'tba-07', 'tba-08', 'tba-09', 'tba-10', 'tba-11', 'tba-12', 'tba-13', 'tba-15', 'tba-19',
  'gl-01', 'gl-02', 'gl-04', 'gl-05', 'gl-06', 'gl-07', 'gl-08', 'gl-09', 'gl-11', 'gl-13', 'gl-14', 'gl-15', 'gl-16', 'gl-17', 'gl-18',
  'ps-sleep-walker2002', 'ps-sleep-walker2003-overnight', 'ps-within-session-walker2003', 'ps-doubling-training', 'ps-nap-nishida2007',
  'ps-micro-rest-bonstrup2019', 'ps-85-percent-rule', 'ps-external-focus-chua2021', 'ps-spaced-musicians-simmons2011',
  'ps-violinist-hours-ericsson1993', 'ps-habit-lally2010', 'ps-learning-curve-heathcote2000',
  'tn-heart-adult-rest', 'tn-heart-athlete-rest', 'tn-heart-target-zone', 'tn-walk-moderate', 'tn-run-elite-ultra', 'tn-march-quick-time',
  'tn-march-rifles', 'tn-cricket-dolbear', 'tn-hummingbird-heart', 'tn-hummingbird-wings', 'tn-elephant-heart', 'tn-mouse-heart',
  'tn-blue-whale-heart', 'tn-tapping-tempo-age',
  'dino-trex-growth-rate', 'dino-trex-teen-spurt', 'dino-sue-age', 'dino-sue-completeness', 'dino-trex-teeth', 'dino-trex-size-mass',
  'dino-trex-speed', 'dino-trex-bite', 'dino-stego-brain', 'dino-incubation', 'dino-earliest-dinosaurs', 'dino-nyasasaurus',
]

/** Dev check: ids unique, every named id exists, every fact has a source. Returns the problems found. */
export function validateFacts(facts: Fact[] = FACTS): string[] {
  const bad: string[] = []
  const seen = new Set<string>()
  for (const f of facts) {
    if (seen.has(f.id)) bad.push(`duplicate id ${f.id}`)
    seen.add(f.id)
    if (!f.source_url || !/^https?:\/\//.test(f.source_url)) bad.push(`${f.id} has no source_url`)
  }
  for (const id of USED_IDS) if (!seen.has(id)) bad.push(`rule names missing fact ${id}`)
  return bad
}

if (import.meta.env?.DEV) {
  const bad = validateFacts()
  if (bad.length) console.warn('facts.json:', bad)
}

// ---- helpers ------------------------------------------------------------------

type Rng = () => number

function seeded(seed: string): Rng {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const num = (o: unknown, key: string): number => {
  const v = o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined
  return typeof v === 'number' ? v : NaN
}
const arr = (o: unknown, key: string): unknown[] => {
  const v = o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined
  return Array.isArray(v) ? v : []
}
const d = (id: string) => BY_ID.get(id)?.data ?? {}
const r0 = (n: number) => Math.round(n)
const r1 = (n: number) => Math.round(n * 10) / 10
const fmt = (n: number) => n.toLocaleString('en-US')

interface Cand {
  slot: 'perf' | 'flav'
  pri: number
  cat: string
  factId: string | null
  text: string
}

// ---- candidates -----------------------------------------------------------------

function candidates(x: PickInput, rng: Rng): Cand[] {
  const out: Cand[] = []
  const one = (texts: string[]) => texts[Math.floor(rng() * texts.length)]
  const add = (slot: Cand['slot'], pri: number, id: string | null, texts: string[]) => {
    const f = id ? BY_ID.get(id) : null
    if (id && !f) return
    out.push({ slot, pri, cat: f ? f.category : 'progress', factId: id, text: one(texts) })
  }

  const r = x.result
  const bpm = r0(r.bpm)
  const graded = r.counts.perfect + r.counts.good + r.counts.early + r.counts.late
  const timed = graded >= MIN_GRADED
  const spread = timed ? r.spreadMs : null
  const mean = timed && x.calibrated ? r.meanErrMs : null
  const adultBands = x.age === null || x.age >= 18 // age-band comparisons
  const kid = x.age !== null && x.age < 12
  const prev = x.prev

  // ---- progress (this lesson has history) ----
  if (prev && x.bestBefore !== null) {
    const up = r.score - prev.score
    if (x.failedBefore && r.passed) {
      const yr = num(d('gl-11'), 'year')
      add('perf', 105, 'gl-11', [`Passed! Django Reinhardt relearned guitar after a fire in ${yr} hurt two of his fretting fingers. Persistence works.`])
    }
    if (r.score > x.bestBefore) add('perf', 100, null, [`New personal best on this lesson: ${r.score}%!`])
    else if (up >= 5) add('perf', 100, null, [`Up ${up} points from last time. That's the learning curve doing its thing.`])
    if (spread !== null && prev.spreadMs !== null && prev.spreadMs - spread >= 5) {
      add('perf', 100, null, [`Your timing was ${r0(prev.spreadMs - spread)} ms steadier than last time.`])
    }
    if (bpm > r0(prev.bpm)) {
      const s = arr(d('gl-02'), 'steps').map(Number)
      if (s.length === 3) add('perf', 100, 'gl-02', [`${bpm} BPM, up from ${r0(prev.bpm)}. Even the Guinness speed champ warmed up in steps: ${s[0]}, then ${s[1]}, then ${s[2]} bpm.`])
    }
    if (r.bestChain >= 8 && r.bestChain > x.bestChainBefore) add('perf', 100, null, [`Longest streak of good hits yet: ${r.bestChain} in a row.`])
    if (x.flat >= num(d('ps-learning-curve-heathcote2000'), 'plateauAttempts') && r.score <= x.bestBefore) {
      add('perf', 100, 'ps-learning-curve-heathcote2000', ["Gains get smaller as you improve. That's the normal shape of learning, not a wall. Try a slower tempo or a short break."])
    }
  }

  // ---- steadiness (spreadMs) ----
  if (spread !== null) {
    const m = d('tba-04').metronome
    const avg = r0(num(m, 'meanSpreadMs'))
    const lo = r0(num(m, 'typicalMinMs'))
    const hi = r0(num(m, 'typicalMaxMs'))
    const n = num(d('tba-04'), 'n')
    if (spread <= lo) {
      add('perf', 90, 'tba-04', [
        `Your timing spread was ${spread} ms. That's steadier than most adults in a ${n}-person online tapping study (average about ${avg} ms).`,
        `Rock steady: ${spread} ms of spread beats the typical adult tapper (about ${avg} ms).`,
      ])
    } else if (spread <= avg) {
      add('perf', 85, 'tba-04', [
        `${spread} ms of spread is right in line with the average adult in a big tapping study (about ${avg} ms). Solid!`,
        `About as steady as a typical grown-up tapping to a metronome (about ${avg} ms). Nice.`,
      ])
    } else if (spread <= hi) {
      add('perf', 70, 'tba-04', [`${spread} ms spread is inside the normal adult range in tapping tests (about ${lo}-${hi} ms). Keep it rolling.`])
    }

    // Timing age: only upward-looking bands, never for kids or teens.
    // The study measured SD of inter-tap intervals; for independent errors that is about √2 x our
    // asynchrony spread, so scale before matching a band.
    const iti = spread * Math.SQRT2
    const band = arr(d('tba-01'), 'bands').find((b) => {
      const mn = num(b, 'spreadMsMin')
      const mx = num(b, 'spreadMsMax')
      return (isNaN(mn) || iti >= mn) && (isNaN(mx) || iti < mx)
    })
    const group = band && typeof (band as { ageGroup?: unknown }).ageGroup === 'string' ? (band as { ageGroup: string }).ageGroup : null
    if (adultBands && group) {
      const top = arr(d('tba-01'), 'bands').map((b) => num(b, 'spreadMsMax')).filter((v) => !isNaN(v))
      const teen = r0(Math.min(...top) / Math.SQRT2) // in our spread units
      if (group === 'teen/young adult') {
        add('perf', 90, 'tba-01', ["Your spread is at the level of teens and young adults in a lifespan tapping study. That's the steadiest age group!"])
      } else if (spread <= avg && (group === '12-13' || group === '14-17')) {
        add('perf', 85, 'tba-01', [
          `Timing age: about ${group}, based on a lifespan tapping study. Steadiness keeps improving into your 20s.`,
          `Fun read-out: tapping-study 'timing age' about ${group}. The teen and young-adult level is under about ${teen} ms.`,
        ])
      } else if (spread > hi && spread < 60 && (group === '8-9' || group === '10-11')) {
        add('perf', 60, 'tba-01', [
          `Your steadiness is about where a typical ${group}-year-old lands in a tapping study, and timing keeps improving with practice.`,
          `Your steadiness matches a typical ${group}-year-old in a tapping study. Keep going, it climbs fast.`,
        ])
      }
    }
    if (spread >= 60 && !kid) add('perf', 60, 'tba-12', ["Timing is a skill people grow into. Even 10-year-olds aren't as consistent as adults yet. Every session moves you along."])

    // Rough interval CV against trained musicians (self-paced study, so only a range claim).
    // Interval SD is about √2 x asynchrony SD; the gap is the lesson's note step, not always one beat.
    const t15 = d('tba-15')
    const gap = (60000 / r.bpm) * (x.step !== null && x.step > 0 ? x.step : 1)
    const cv = (spread * Math.SQRT2) / gap
    const cvMax = Math.min(...arr(t15, 'musicianCv').map(Number))
    if (bpm >= num(t15, 'bpmMin') && bpm <= num(t15, 'bpmMax') && cv <= cvMax) {
      add('perf', 88, 'tba-15', [`Rough estimate from your spread: about ${(cv * 100).toFixed(1)}% variation in the gaps between notes, in the range trained musicians (about 10 years of lessons) showed in a self-paced tapping study.`])
    }
  }

  // ---- early or late (meanErrMs, calibrated only) ----
  if (mean !== null) {
    const a = Math.abs(mean)
    const t5 = d('tba-05')
    const t7 = d('tba-07')
    const lo7 = Math.abs(num(t7, 'typicalMeanErrMsMax'))
    const hi7 = Math.abs(num(t7, 'typicalMeanErrMsMin'))
    const t4avg = r0(num(d('tba-04').metronome, 'meanSpreadMs'))
    if (a <= num(t5, 'absMeanErrMsMax') && spread !== null && spread <= t4avg) {
      const pa = num(t5, 'absMeanErrMsMin')
      const pb = num(t5, 'absMeanErrMsMax')
      add('perf', 90, 'tba-05', [
        `Your average offset was ${a} ms, in the same ballpark as professional drummers in a lab study (about ${pa}-${pb} ms).`,
        `Dead centre: ${a} ms average offset. Pro drummers in a lab study landed within about ${pa}-${pb} ms.`,
      ])
    } else if (a < lo7) {
      add('perf', 75, 'tba-07', [`You sat closer to the beat than typical tappers, who usually land ${lo7}-${hi7} ms early.`])
    }
    const t8 = d('tba-08')
    if (!kid && mean >= num(t8, 'meanErrMsMin') && mean <= num(t8, 'meanErrMsMax')) {
      add('perf', 70, 'tba-08', ['Landing a hair early is a grown-up timing habit. Young kids rarely do it.'])
    }
    if (mean <= -lo7 && mean >= -hi7) {
      add('perf', 72, 'tba-07', [`Rushing a little ahead of the beat is normal: most people tap ${lo7}-${hi7} ms early. Try leaning back a touch.`])
    }
  }

  // Mean absolute offset against third-graders, only where the study measured (120 and 150 bpm).
  if (timed && x.calibrated && adultBands && r.meanAbsErrMs !== null) {
    const frac = r.meanAbsErrMs / (60000 / r.bpm)
    for (const p of arr(d('tba-13'), 'points')) {
      const pb = num(p, 'bpm')
      const pf = num(p, 'fraction')
      const label = (p as { ageGroup?: unknown }).ageGroup
      if (label === '3rd grade (~9)' && Math.abs(bpm - pb) <= 5 && Math.abs(frac - pf) <= 0.02) {
        add('perf', 55, 'tba-13', [`Your average distance from the beat was about ${r0(frac * 100)}% of a beat, close to typical third-graders (about 9) in a tapping study. It keeps shrinking with practice.`])
      }
    }
  }

  // ---- score, chain ----
  if (x.firstBeatPass) {
    const t = d('tba-11')
    const share = num(t, 'nonSynchronizers') / num(t, 'n')
    if (share > 0.3 && share < 0.4) add('perf', 80, 'tba-11', [`Keeping a beat is a real skill: in one study about a third of ${String(t.ageGroup)}-year-olds couldn't lock onto a drum beat. You just did.`])
  }
  const sue = num(d('dino-sue-completeness'), 'completenessPct')
  if (r.score >= num(d('dino-sue-completeness'), 'scoreMin')) {
    if (r.score <= sue + 2) add('perf', 78, 'dino-sue-completeness', [`${r.score}%, about as complete as SUE, the most complete T. rex ever found (about ${sue}%)!`])
    else add('perf', 78, 'dino-sue-completeness', [`${r.score}%, more complete than SUE, the most complete T. rex ever found (about ${sue}%)!`])
  }
  const sweet = d('ps-85-percent-rule')
  if (r.score >= num(sweet, 'scoreMin') && r.score <= num(sweet, 'scoreMax')) {
    add('perf', 65, 'ps-85-percent-rule', [
      "You're in the learning sweet spot: models of learning suggest about 85% correct is ideal.",
      `${r.score}%: close to the ~85% that learning models call the sweet spot.`,
    ])
  } else if (r.score > 95 && x.lessonType !== 'sync') {
    add('perf', 62, 'ps-85-percent-rule', ['Too easy? Learning models say about 85% right is the sweet spot. Try a notch more BPM.'])
  } else if (r.score < 70) {
    // Only a failed run gets "tough one"; sync lessons have a fixed tempo.
    if (!r.passed && x.lessonType !== 'sync') {
      add('perf', 60, 'ps-85-percent-rule', ['Tough one! Try a slower tempo. Learning models say about 85% right is the sweet spot.'])
    } else if (!r.passed) {
      add('perf', 60, 'ps-85-percent-rule', ['Tough one! Learning models say about 85% right is the sweet spot. Another go gets you closer.'])
    }
    add('perf', 60, 'dino-stego-brain', ['Stegosaurus had a walnut-sized brain and thrived for millions of years. Keep going!'])
  }
  if (prev && r.score > prev.score) {
    const g = num(d('ps-within-session-walker2003'), 'speedGainPct')
    add('perf', 64, 'ps-within-session-walker2003', [`Big early jumps are normal: in one study people got ${g}% faster within a single session.`])
  }
  const teeth = num(d('dino-trex-teeth'), 'teeth')
  if (r.bestChain >= teeth) add('perf', 82, 'dino-trex-teeth', [`A ${r.bestChain}-hit chain: at least one hit for every tooth in a T. rex smile (about ${teeth})!`])

  // ---- flavour: songs at this tempo ----
  for (const f of FACTS) {
    if (f.category !== 'song-tempos') continue
    const s = f.data
    const title = String(s.title) // shown in curly quotes: some titles end in an apostrophe
    const artist = String(s.artist)
    const songBpm = num(s, 'bpm')
    const part = typeof s.part === 'string' ? s.part : null // the tempo holds for part of the song only
    if (bpm >= num(s, 'matchMin') && bpm <= num(s, 'matchMax')) {
      add('flav', 40, f.id, part ? [
        `${bpm} BPM: about the tempo of ${part} “${title}” by ${artist}.`,
        `Same pulse as ${part} “${title}”. Your next jam is waiting.`,
      ] : [
        `${bpm} BPM: about the tempo of “${title}” by ${artist}.`,
        `You just played at “${title}” speed (${artist}, about ${songBpm} BPM).`,
        `Same pulse as “${title}”. Your next jam is waiting.`,
        `That's roughly the beat of ${artist}'s “${title}”.`,
      ])
    } else if (bpm >= num(s, 'altMin') && bpm <= num(s, 'altMax')) {
      const dbl = bpm > songBpm
      const other = r0(dbl ? songBpm * 2 : songBpm / 2)
      add('flav', 38, f.id, [`Feels like the groove of “${title}” (${songBpm} BPM, or ${other} counted in ${dbl ? 'double' : 'half'} time).`])
    }
  }

  // ---- flavour: tempo in nature ----
  const range = (id: string) => [num(d(id), 'perMinuteMin'), num(d(id), 'perMinuteMax')]
  const [aMin, aMax] = range('tn-heart-athlete-rest')
  if (bpm >= aMin && bpm < aMax) add('flav', 30, 'tn-heart-athlete-rest', [`Slow and steady, like a trained athlete's resting heart (${aMin}-${aMax} beats a minute).`])
  const [hMin, hMax] = range('tn-heart-adult-rest')
  if (bpm >= hMin && bpm <= hMax) add('flav', 30, 'tn-heart-adult-rest', [`You played at the pace of a calm, resting human heartbeat (${hMin}-${hMax} a minute).`])
  const [zMin, zMax] = range('tn-heart-target-zone')
  if (bpm >= zMin && bpm <= zMax) add('flav', 22, 'tn-heart-target-zone', [`That's inside a 30-year-old's exercise heart-rate zone (about ${zMin}-${zMax} a minute). Cardio for your fingers.`])
  for (const b of arr(d('tn-walk-moderate'), 'bands')) {
    if (bpm < num(b, 'triggerMin') || bpm > num(b, 'triggerMax')) continue
    const per = num(b, 'perMinute')
    const vig = String((b as { label?: unknown }).label).includes('vigorous')
    add('flav', 30, 'tn-walk-moderate', [vig ? `Power-walk tempo: about ${per} steps a minute counts as vigorous.` : `Brisk-walk tempo: about ${per} steps a minute counts as moderate exercise.`])
  }
  for (const b of arr(d('tn-march-quick-time'), 'bands')) {
    if (bpm < num(b, 'triggerMin') || bpm > num(b, 'triggerMax')) continue
    const per = num(b, 'perMinute')
    const label = String((b as { label?: unknown }).label)
    add('flav', 32, 'tn-march-quick-time', [
      label === 'quick time' ? `Parade-ready! ${per} is quick-march time in Canadian Armed Forces drill.` : `${per} paces a minute is ${label} in Canadian Armed Forces drill. Left, right!`,
    ])
  }
  const rifles = d('tn-march-rifles')
  if (bpm >= num(rifles, 'triggerMin') && bpm <= num(rifles, 'triggerMax')) {
    add('flav', 32, 'tn-march-rifles', [`Rifle-regiment speed: ${num(rifles, 'perMinute')} paces a minute on their own parades (Canadian drill).`])
  }
  const ultra = d('tn-run-elite-ultra')
  if (bpm >= num(ultra, 'perMinuteMin') && bpm <= num(ultra, 'perMinuteMax') + 2) {
    add('flav', 30, 'tn-run-elite-ultra', [`That's the footstep rate of an elite 100 km runner (about ${num(ultra, 'perMinuteMean')} steps a minute on average).`])
  }
  const cricket = d('tn-cricket-dolbear')
  if (bpm >= num(cricket, 'bpmMin') && bpm <= num(cricket, 'bpmMax')) {
    const tf = r0(bpm / 4 + 40)
    const tc = r0(((tf - 32) * 5) / 9)
    add('flav', 24, 'tn-cricket-dolbear', [`A cricket chirping at your tempo would suggest it's roughly ${tf} F (${tc} C) outside, by an 1897 rule of thumb.`])
  }
  const ratio = (id: string) => num(d(id), 'ratioBase')
  if (bpm >= 4) add('flav', 15, 'tn-blue-whale-heart', [`Your ${bpm} BPM is about ${r0(bpm / ratio('tn-blue-whale-heart'))}x a diving blue whale's heartbeat (as low as ${ratio('tn-blue-whale-heart')} a minute).`])
  if (bpm >= 45) add('flav', 15, 'tn-elephant-heart', [`About ${r1(bpm / ratio('tn-elephant-heart'))}x an elephant's resting heartbeat (about ${ratio('tn-elephant-heart')} a minute).`])
  if (bpm <= 275) add('flav', 15, 'tn-hummingbird-heart', [`A resting hummingbird's heart beats about ${r0(ratio('tn-hummingbird-heart') / bpm)}x faster than your tempo.`])
  if (bpm <= 290) {
    const [mMin, mMax] = range('tn-mouse-heart')
    add('flav', 14, 'tn-mouse-heart', [`A lab mouse's heart beats about ${r0(ratio('tn-mouse-heart') / bpm)}x faster than your tempo (roughly ${mMin}-${mMax} a minute).`])
  }
  add('flav', 14, 'tn-hummingbird-wings', [`A hovering hummingbird flaps about ${fmt(ratio('tn-hummingbird-wings'))} times a minute, about ${r0(ratio('tn-hummingbird-wings') / bpm)}x your beat.`])

  // Natural tapping tempo: tempo flavour, never a skill judgement.
  for (const b of arr(d('tba-09'), 'bands')) {
    if (bpm < num(b, 'bpmMin') || bpm > num(b, 'bpmMax')) continue
    const kids = String((b as { ageGroup?: unknown }).ageGroup).startsWith('children')
    add('flav', 25, 'tba-09', [kids ? "That's the speed young kids naturally tap at, pure energy!" : `${bpm} BPM is close to the natural tapping tempo of adults (about 100).`])
  }
  const t10 = d('tba-10')
  if (bpm >= num(t10, 'bpmMin') && bpm <= num(t10, 'bpmMax')) {
    add('flav', 23, 'tba-10', [`${bpm} BPM is about the natural tapping tempo of a typical ${String(t10.ageGroup)}-year-old (about ${r0(num(t10, 'grade3Bpm'))}).`])
  }
  for (const b of arr(d('tn-tapping-tempo-age'), 'bands')) {
    const g = String((b as { ageGroup?: unknown }).ageGroup)
    if (g === 'older adults' || bpm < num(b, 'perMinuteMin') || bpm > num(b, 'perMinuteMax')) continue
    add('flav', 22, 'tn-tapping-tempo-age', [g === 'adults' ? "Right in the zone where grown-ups naturally tap when nobody's counting." : `${bpm} BPM: about how fast kids aged 4-7 tap when left to their own rhythm.`])
  }
  const tspeed = d('dino-trex-speed')
  if (bpm >= num(tspeed, 'bpmMin')) add('flav', 25, 'dino-trex-speed', [`Your fingers were zippier than T. rex, which could probably only power-walk at about ${num(tspeed, 'kmhMin')}-${num(tspeed, 'kmhMax')} km/h.`])
  if (rng() < 0.1) {
    const rec = num(d('gl-01'), 'recordBpm')
    add('flav', 20, 'gl-01', [`${bpm} BPM is ${r0((bpm / rec) * 100)}% of the 2012 Guinness 'Flight of the Bumblebee' tempo (${rec}, in 16th notes). Plenty of room to grow!`])
  }
  if (x.step !== null && x.step > 0) {
    const ioi = (60000 / r.bpm) * x.step
    const t19 = d('tba-19')
    if (ioi <= num(t19, 'fastTriggerIoiMs')) {
      add('flav', 35, 'tba-19', [`You're nearing the speed limit of human beat-keeping: trained musicians top out around ${num(t19, 'fastestIoiMsMin')}-${num(t19, 'fastestIoiMsMax')} ms between notes.`])
    }
  }

  // ---- flavour: lesson type and context ----
  if (x.lessonType === 'sync') {
    add('flav', 45, 'gl-05', [`${fmt(num(d('gl-05'), 'participants'))} guitarists once played together in one square in Wroclaw (Guinness, ${num(d('gl-05'), 'year')}). You just joined the band.`])
    add('flav', 45, 'gl-09', [`Nearly half of new players (${num(d('gl-09'), 'playWithOthersPct')}%, Fender survey) start guitar to make music with others, like you just did.`])
  }
  if (x.lessonType === 'improv') {
    add('flav', 45, 'gl-18', ["Tommy Emmanuel never had formal music training and can't read music. He plays by ear, like you just did."])
    add('flav', 35, 'ps-micro-rest-bonstrup2019', [`Those pauses count: in one study almost all early learning showed up during ${num(d('ps-micro-rest-bonstrup2019'), 'restSec')}-second rests.`])
  }
  if (x.boss && r.passed) {
    const sm = d('dino-trex-size-mass')
    add('flav', 48, 'dino-trex-size-mass', [`Boss down! That was T. rex sized: about ${num(sm, 'lengthM')} m long and ${fmt(num(sm, 'massKgMin'))}-${fmt(num(sm, 'massKgMax'))} kg.`])
    add('flav', 48, 'dino-trex-bite', [`That was T. rex strength, a bite of up to ${fmt(num(d('dino-trex-bite'), 'newtonsMax'))} newtons!`])
    add('flav', 46, 'gl-17', ['Brian May built his own Red Special guitar at 16, from an old fireplace. Big wins start with small builds.'])
  }
  const slips = r.counts.wrong + r.counts.miss
  if (slips >= 3 && slips >= 0.25 * (graded + slips)) {
    add('flav', 40, 'ps-external-focus-chua2021', ['Try listening for the sound you want instead of watching your fingers. Focusing on the result helps learning.'])
  }
  if (r.passed && x.passedBefore === 0) {
    add('flav', 50, 'dino-earliest-dinosaurs', [`The first dinosaurs we know of showed up about ${num(d('dino-earliest-dinosaurs'), 'maYears')} million years ago. Today you started your chapter!`])
  }
  if (r.passed && x.passedAfter <= num(d('gl-13'), 'lessonsPassedMax')) add('flav', 42, 'gl-13', ["Jimi Hendrix started on a ukulele with one string. You've got six."])
  if (x.hour >= 21 || x.hour < 4) {
    add('flav', 38, 'ps-sleep-walker2002', [`Sleep on it: in one study people were about ${num(d('ps-sleep-walker2002'), 'speedGainPct')}% faster the morning after practising.`])
    add('flav', 36, 'gl-15', ['Late-night practice? Wes Montgomery played with his thumb so he would not wake his kids.'])
  } else if (x.hour >= 11 && x.hour < 15) {
    add('flav', 30, 'ps-nap-nishida2007', [`Nap tip: in one study, people who napped after practising improved ${num(d('ps-nap-nishida2007'), 'napGainPct')}% at a later test.`])
  }
  if (x.age !== null && x.age >= 18) add('flav', 30, 'gl-15', [`Jazz legend Wes Montgomery didn't pick up the guitar until ${num(d('gl-15'), 'startAge')}.`])
  add('flav', 10, 'gl-14', ['Jimi Hendrix mostly played right-handed guitars flipped upside down and restrung.'])
  add('flav', 12, 'ps-doubling-training', ['More isn\'t always more: in one study doubling practice in a day didn\'t boost the overnight gain.'])
  add('flav', 12, 'gl-07', ['Fender found time is a top reason beginners quit. You found time today.'])

  // ---- flavour: milestones crossed in this run (they outrank other flavour) ----
  const s = x.streak
  if (s.counted) {
    const days = s.after
    const hit = (ids: number[]) => ids.includes(days)
    if (s.before > 1 && days === 1) {
      add('flav', 55, 'gl-16', [`Eric Clapton put his first guitar down for ${num(d('gl-16'), 'breakYears')} years, then came back. Welcome back!`])
      add('flav', 55, 'ps-habit-lally2010', ["Missing a day didn't spoil habit-building in a well-known study. Jump back in."])
      add('flav', 54, 'dino-nyasasaurus', ['Nyasasaurus fossils waited in a museum for decades before anyone took a proper look. Good things come back.'])
    }
    if (days === 2) add('flav', 55, 'gl-08', ["Daniel Levitin's tip (via Fender): 5 minutes a day, every day. You did it again today."])
    if (days >= 2) {
      add('flav', 52, 'ps-spaced-musicians-simmons2011', ["Spreading practice across days helped musicians' accuracy in one study."])
      const o = d('ps-sleep-walker2003-overnight')
      add('flav', 52, 'ps-sleep-walker2003-overnight', [`Day ${days}! In one study, a night's sleep after practice came with ${num(o, 'night1SpeedPct')}% faster finger sequences.`])
    }
    if (hit(arr(d('dino-trex-teen-spurt'), 'streakTriggers').map(Number))) {
      add('flav', 56, 'dino-trex-teen-spurt', [`T. rex's teenage growth spurt lasted about ${num(d('dino-trex-teen-spurt'), 'spurtYears')} years. This is your growth spurt.`])
    }
    if (days === 7) {
      add('flav', 56, 'dino-trex-growth-rate', [`A teen T. rex grew about ${r0(num(d('dino-trex-growth-rate'), 'kgPerDay'))} kg a day. Your streak is growing fast too.`])
      add('flav', 56, 'gl-06', [`Fender found over ${num(d('gl-06'), 'quitPct')}% of new players quit in their first year. You're practising like the ones who stick with it.`])
    }
    const habit = d('ps-habit-lally2010')
    if (days === num(habit, 'minDays')) add('flav', 56, 'ps-habit-lally2010', [`Some people in a habit study had a new habit locked in after just ${days} days.`])
    if (days === num(habit, 'averageDays')) add('flav', 56, 'ps-habit-lally2010', [`Day ${days}, the average point where a daily habit became automatic in a well-known study!`])
    if (days === 19) add('flav', 56, 'dino-sue-age', ['SUE the T. rex was full-grown at 19. You hit a 19-day streak!'])
    if (days === 28) add('flav', 56, 'dino-sue-age', ['28 days! SUE the T. rex lived to about 28 years, the top end for a T. rex.'])
    const egg = arr(d('dino-incubation'), 'streakTriggers').map(Number)
    if (days === egg[0]) add('flav', 56, 'dino-incubation', ["You've practised as long as a Protoceratops egg took to hatch, about 3 months!"])
    if (days === egg[1]) add('flav', 56, 'dino-incubation', ["You've practised as long as a Hypacrosaurus egg took to hatch, about 6 months!"])
  }
  const minBefore = x.totalSecBefore / 60
  const minAfter = x.totalSecAfter / 60
  const crossed = (marks: number[]) => marks.find((m) => minBefore < m && minAfter >= m)
  const g4 = crossed(arr(d('gl-04'), 'milestonesMinutes').map(Number))
  if (g4 !== undefined) {
    const rec = num(d('gl-04'), 'recordMinutes')
    add('flav', 56, 'gl-04', [`Your ${g4} minutes are ${r1((g4 / rec) * 100)}% of the Guinness-listed guitar marathon (${Math.floor(rec / 60)} hours non-stop).`])
  }
  const vio = d('ps-violinist-hours-ericsson1993')
  const v = crossed(arr(vio, 'milestonesMinutes').map(Number))
  if (v !== undefined) add('flav', 57, 'ps-violinist-hours-ericsson1993', [`${r0(v / 60)} hours logged. Top violinists in a famous study had about ${fmt(num(vio, 'bestHours'))} by age 18. Every hour counts.`])
  if (r.passed && x.passedAfter > x.passedBefore && [5, 10, 25].includes(x.passedAfter)) {
    add('flav', 55, 'tba-03', [`${x.passedAfter} lessons passed. Research links more years of playing with steadier timing. Keep stacking lessons!`])
  }

  return out
}

// ---- selection ------------------------------------------------------------------

function choose(pool: Cand[], rng: Rng, x: PickInput, skipCats: string[], skipIds: string[]): Cand | null {
  const ok = pool.filter((c) => !skipCats.includes(c.cat) && !(c.factId && skipIds.includes(c.factId)))
  const fresh = ok.filter((c) => !c.factId || !x.recent.includes(c.factId))
  // All candidates were seen lately: allow a repeat, but never one from the previous result.
  const last = x.recent.slice(-2)
  const use = fresh.length ? fresh : ok.filter((c) => !c.factId || !last.includes(c.factId))
  if (!use.length) return null
  const top = Math.max(...use.map((c) => c.pri))
  const ties = use.filter((c) => c.pri === top)
  return ties[Math.floor(rng() * ties.length)]
}

/** Up to 2 lines for a finished run. Same input gives the same lines. */
export function pickLines(x: PickInput): FactLine[] {
  const rng = seeded(`${x.result.lessonId}|${x.result.at}`)
  const all = candidates(x, rng)
  const picked: Cand[] = []
  const first = choose(
    all.filter((c) => c.slot === 'perf'),
    rng,
    x,
    [],
    [],
  )
  if (first) picked.push(first)
  const flav = all.filter((c) => c.slot === 'flav')
  while (picked.length < 2) {
    const c = choose(
      flav,
      rng,
      x,
      picked.map((p) => p.cat),
      picked.flatMap((p) => (p.factId ? [p.factId] : [])),
    )
    if (!c) break
    picked.push(c)
  }
  return picked.map((c) => ({ text: c.text, factId: c.factId }))
}

/** The recent ring after showing `lines`. */
export function pushRecent(recent: string[], lines: FactLine[]): string[] {
  const ids = lines.flatMap((l) => (l.factId ? [l.factId] : []))
  return [...recent.filter((id) => !ids.includes(id)), ...ids].slice(-RECENT_MAX)
}
