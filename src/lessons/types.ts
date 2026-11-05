// Shared types for the Lessons tab. No runtime code.

export type WorldId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type ExerciseType = 'sync' | 'notes' | 'chords' | 'rhythm' | 'improv'
export type Timing = 'easy' | 'normal' | 'tight'
export type Tech = 'hammer' | 'pull' | 'slide' | 'bend' | 'vibrato' | 'pm'
export type FeelId = 'pop' | 'ballad' | 'blues' | 'funk' | 'reggae'
export type BandPart = 'drums' | 'bass' | 'keys'

/** The lesson's band. One chord per bar, looped. */
export interface BackingSpec {
  feel: FeelId
  chords: string[]
  parts?: Partial<Record<BandPart, boolean>> // default: all three; when given, a missing part is off
  level?: number // band volume 0–1, default 1 (World 1 plays softer)
  onListen?: 'all' | 'drums' | 'none' // the band in listen (call) bars; default 'all'
}
export type ScaleId = 'minorPent' | 'blues' | 'majorPent' | 'minor' | 'major' | 'dorian' | 'mixolydian'
/** Names of built-in presets in audio/tone.ts PRESETS. */
export type ToneHint = 'Clean' | 'Blues crunch' | 'Classic rock'
/** Play speed as a share of the lesson tempo: 0.6–1.15 in 0.05 steps (below 1 = practice speed). */
export type Speed = number
export type Stars = 0 | 1 | 2 | 3

// ---- Authoring (data.ts) ----------------------------------------------------

/** One bar of strums. strum = 8 slots ("1 & 2 & 3 & 4 &"):
 *  D down, U up, P palm-muted down, x muted scratch, r checked silence (until next non-'_' slot or bar end), _ nothing.
 *  chord 'mute' = every hit is a muted scratch. frets = the shape taught (low E first, -1 = not played). */
export interface ChordBar {
  chord: string
  frets?: number[]
  strum: string
  chroma?: boolean
}

/** Call & response for note lessons. Calls sit in even bars (0,2,4…), answers in the bar after. */
export interface CallSpec {
  mode: 'echo-rhythm' | 'echo-notes'
  /** echo-rhythm: 8-slot strings, X = an 8th note at `pos`. echo-notes: seq() strings with step 0.5, one bar each. */
  calls: string[]
  pos?: { s: number; f: number }
  /** echo-notes: answers with index >= showUntil are hidden (ear only). Default: all shown. */
  showUntil?: number
}

export type ImprovMetric = 'inScale' | 'phrases' | 'space' | 'endings' | 'targets' | 'motif' | 'answers' | 'echo'

export interface ImprovSpec {
  key: number // root pitch class (9 = A)
  scale: ScaleId | null // null => allowedPcs
  allowedPcs?: number[]
  boxFret: number
  endPcs?: number[]
  chordTones?: boolean // highlight current chord tones on the fretboard
  /** Calls in even bars, answers in odd bars. calls.length = bars / 2.
   *  '' = generated call (seeded makePhrase). In 'mixed', non-empty calls are echo calls. */
  callResponse?: { mode: 'answer' | 'mixed'; calls: string[]; seed?: number }
  weights: Partial<Record<ImprovMetric, number>>
  technique?: boolean // technique bonus up to +20
  minNotes: number
}

export interface StarExtra {
  kind: 'palmMute' | 'legato' | 'glide'
  share: number // 0–1 of the relevant notes
}

export interface Lesson {
  id: string
  world: WorldId
  order: number // 1-based within the world
  boss?: boolean
  title: string
  goal: string
  tips: string[]
  type: ExerciseType
  bpm: number
  bars: number // judged bars after the count-in
  countInBeats?: number // default 4
  timing: Timing
  tone: ToneHint
  click?: boolean // clicks during the chart; default: true when there is no backing
  octaveOk?: boolean
  backing?: BackingSpec
  seq?: string // notes lessons
  step?: number // beats per seq unit
  shapes?: Record<string, number[]> // chord-token shape overrides
  chordBars?: ChordBar[] // chords / rhythm lessons
  calls?: CallSpec
  improv?: ImprovSpec
  pass: number // score 0–100 to pass (= 1 star)
  stars: [number, number, number]
  starExtra?: StarExtra // needed for the 3rd star
  xp: number
}

export interface WorldDef {
  id: WorldId
  title: string
  skill: string
  lessons: string[] // ids in play order; the boss is last
}

// ---- seq() output -------------------------------------------------------------

export type SeqItem =
  | { k: 'note'; beat: number; len: number; s: number; f: number; tech?: Tech; bend?: number }
  | { k: 'rest'; beat: number; len: number }
  | { k: 'mute'; beat: number; len: number }
  | { k: 'chord'; beat: number; len: number; symbol: string }

// ---- Compiled chart (charts.ts) -----------------------------------------------

interface EvBase {
  id: number
  beat: number // from beat 0 = first beat after the count-in (straight time, never swung)
  dur: number // beats
}
export interface NoteEv extends EvBase {
  kind: 'note'
  string: number // 0 = low E
  fret: number
  midi: number
  tech?: Tech
  bendTo?: number // midi
  hidden?: boolean // ear-only: drawn without its fret number
}
export interface ChordEv extends EvBase {
  kind: 'chord'
  symbol: string
  frets: number[]
  pcs: number[]
  power: boolean
  dir?: 'D' | 'U' | 'P'
  chroma: boolean
}
export interface MuteEv extends EvBase {
  kind: 'mute'
}
export interface RestEv extends EvBase {
  kind: 'rest'
}
export type ChartEvent = NoteEv | ChordEv | MuteEv | RestEv

export interface CallNote {
  beat: number // straight beat; scheduled swung when the feel swings
  dur: number
  midi: number
  string: number
  fret: number
}

export interface Chart {
  lessonId: string
  bars: number
  totalBeats: number
  events: ChartEvent[] // sorted by beat; ids are 0..n-1 in that order
  calls: CallNote[] // played by the app's lead voice, never judged
  listenBars: number[] // 0-based bars where the player should stay silent
  chordTimeline: { beat: number; symbol: string }[] // one entry per bar; '' = no chord
  improvBars?: { bar: number; role: 'call' | 'answer' | 'echo'; callIdx: number }[]
  minGapBeats: number // smallest start-to-start gap between judged events (Infinity if < 2 events)
}

// ---- Live input ---------------------------------------------------------------

export interface InputFrame {
  t: number // audio time, corrected by the run's offset
  rms: number
  midi: number | null
  midiF: number | null // midi + cents/100
}
export interface InputOnset {
  t: number // audio time, corrected by the run's offset
  raw: number // audio time as detected (uncorrected)
  midi: number | null // from engine.notes / key / autoplay; the judge's pitch vote may override it
  /** attack = engine.onset (merged with pitch when available); pitch = pitch change with no attack (legato);
   *  glide = a continuous pitch slide (slide, bend or wide vibrato) with no attack. */
  source: 'attack' | 'pitch' | 'glide' | 'key' | 'auto'
  peak: number // max rms within 60 ms after the onset
  strength: number | null // engine.onset ratio for 'attack' onsets, else null
  lagMs?: number // 'attack' onsets merged with a notes event: notes-event time minus attack time
}

// ---- Judging ------------------------------------------------------------------

export type Grade = 'perfect' | 'good' | 'ok' | 'miss'
export interface Windows {
  perfect: number
  good: number
  ok: number
  lateExtra: number // ms added on the late side
}
export type Verdict = 'perfect' | 'good' | 'early' | 'late' | 'miss' | 'wrong' | 'clean-stop' | 'ringing'

export interface JudgeResult {
  eventId: number
  kind: ChartEvent['kind']
  verdict: Verdict
  grade: Grade
  errMs: number | null // + = late; null for misses and rests
  pitchOk: boolean
  octaveSlip?: boolean
  played?: number | null // midi heard
  chordOk?: boolean | null // null = chroma not available
  chordMissing?: number[]
  techOk?: boolean | null // bend / vibrato check; null = not applicable
  legato?: boolean
  pmOk?: boolean | null
  sustain?: number // 0–1
  credit: number // 0–1
}
export interface JudgeSummary {
  results: JudgeResult[] // one per chart event, in event order
  extras: number
  listenViolations: number
}

export interface PlayedNote {
  t: number
  beat: number
  midi: number
  legato: boolean
}
export interface TechHit {
  kind: 'bend' | 'slide' | 'legato' | 'vibrato'
  beat: number
}
export interface ImprovReport {
  notes: number
  metrics: Partial<Record<ImprovMetric, number>> // 0–100 each
  techniqueBonus: number // 0–20
  tooFew: boolean
  tips: string[]
}

export interface LiveHud {
  chain: number
  bestChain: number
  roar: boolean
  points: number
  last: Verdict | null
  lastPlayed: number | null // midi
  bend: number | null // 0–1+ progress toward the bend target while one is open
}

export interface LessonResult {
  lessonId: string
  at: number
  bpm: number // played bpm (after speed)
  speed: Speed
  easyTiming: boolean
  score: number // 0–100
  stars: Stars
  passed: boolean
  playedSec: number // length of the judged part that was played
  counts: Record<Verdict, number>
  extras: number
  bestChain: number
  roarMs: number
  perfectRun: number // longest run of 'perfect'
  points: number
  clean: boolean
  meanErrMs: number | null // + = late
  meanAbsErrMs: number | null // mean distance from the beat, either side
  spreadMs: number | null
  calibrated?: boolean // the run used a saved latency calibration
  improv?: ImprovReport
  coachTip: string
  hardestBar: number | null // 0-based
  bendsInTune: number
  barAcc?: (number | null)[] // per bar: share of events played good or better; null = nothing to play there. Not saved.
  results?: JudgeResult[] // the judge's result per chart event, in event order. Not saved.
}

// ---- Progress -----------------------------------------------------------------

export type Cosmetic = 'shades' | 'bandana' | 'pick-crown' | 'star-guitar'

export interface LessonRecord {
  best: number
  stars: Stars
  plays: number
  fails: number // failed runs before the first pass
  passedAt?: number
  bestChain: number
  clean: boolean
  playsDay: string // dayKey of playsToday
  playsToday: number
  lastPlayed: number
  last?: LastAttempt // the previous run, for "better than last time" lines
  flat?: number // runs in a row without a new best score
  speed?: number // next Auto speed (speed trainer)
  topSpeed?: number // fastest passed speed
  overdrive?: boolean // passed at 100% with a top score: Auto may go up to 115%
  miss?: number // failed runs in a row since the last pass or slow-down
  lastPass?: number // time of the last passed run (review schedule)
  box?: number // review step 0–4: due REVIEW_DAYS[box] days after lastPass
  loops?: number // finished loops with at least one clean pass (Loop the hard part, drills)
  loopTop?: number // fastest clean loop pass, as a speed
}

export interface LastAttempt {
  score: number
  spreadMs: number | null
  bpm: number
  bestChain: number
}

export type PlanKind = 'warmup' | 'review' | 'new' | 'jam'

export interface PlanStep {
  kind: PlanKind
  lessonId: string
  min: number // rough minutes, for the label
  state: 'todo' | 'done' | 'skipped'
  why: string // one short line: why this lesson today
  from: { best: number; stars: Stars; speed: number; loops?: number } // the record when the set was made
  drill?: string // a trouble-spot drill (heat cell key); lessonId is then the lesson the spot was last seen in
  score?: number // best score in this step today
  speed?: number // speed of that run
}

/** Today's practice set: made once per practice day (dayKey). */
export interface DayPlan {
  day: string
  steps: PlanStep[]
  bonus: boolean // the set's XP bonus was given
}

export interface Progress {
  v: 1
  xp: number
  lessons: Record<string, LessonRecord>
  streak: { days: number; last: string; eggs: number } // last = dayKey of last counted day
  daily: { day: string; xp: number; passes: number } // passes = passed runs on `day`
  dailyGoal: 100 | 200 | 350
  dinoName: string
  achievements: Record<string, number> // id -> timestamp
  cosmetics: Cosmetic[] // equipped
  stats: { bendsInTune: number }
  recentFacts: string[] // fact ids shown on the last result cards, oldest first (max 10)
  totalSec: number // judged playing time, all lessons
  plan: DayPlan | null
  planStreak: { days: number; last: string } // last = dayKey of the last finished set
  heat?: Heat // mistake heat map, rolling ~60 days (heat.ts)
  created: number
}

export interface XpLine {
  label: string
  value: string // "+50", "x1.20"
}

export interface ApplyOutcome {
  progress: Progress
  xp: number
  lines: XpLine[]
  levelBefore: number
  levelAfter: number
  stageBefore: number
  stageAfter: number
  newAchievements: string[]
  unlocked: string[] // lesson ids that became playable
  worldUnlocked: WorldId | null
  streakNote: string | null
  factLines: FactLine[] // fun lines from facts/facts.json, chosen once per run
  speed: { played: number; next: number; topBefore: number; topAfter: number } | null // null for the sync lesson
}

export interface FactLine {
  text: string
  factId: string | null // null = only the player's own numbers
}

export type DinoMood = 'idle' | 'focus' | 'happy' | 'hyped' | 'oops' | 'sad' | 'sleepy' | 'proud'
export interface DinoStage {
  stage: number // 0–8
  name: string
  after: WorldId | null // reached by passing this world's boss (null = start)
}
export interface AchievementDef {
  id: string
  name: string
  text: string
  cosmetic?: Cosmetic
}

// ---- Mistake heat (heat.ts) -----------------------------------------------------

/** One heat cell. Counts decay with a 20-day half-life, applied up to day `d` (heat.ts dayNum).
 *  Keys: 'n:<string>.<fret>' a note (string 0 = low E), 'c:<symbol>' a chord, 't:<type>' timing per lesson type. */
export interface HeatCell {
  n: number // judged events (timing cells: graded hits)
  bad: number // missed or wrong; chords also when they rang wrong
  wrong: number // wrong pitch; chords: rang, but not the chord
  early: number // hits more than 35 ms early (note and chord cells: against the run's own average)
  late: number
  err: number // sum of errMs over graded hits (timing cells only, 0 elsewhere)
  d: number // day number of the last update
  l: string // lesson id the cell was last played in
}
export interface Heat {
  v: 1
  cells: Record<string, HeatCell>
}

// ---- Loops (loop.ts) ------------------------------------------------------------

/** A practice loop: some bars of a lesson (or a generated drill) over and over, faster after each clean pass. */
export interface LoopSpec {
  kind: 'bars' | 'drill'
  lesson: Lesson // the lesson the bars come from; for a drill, the generated lesson (not in LESSONS)
  fromBar: number // 0-based, inclusive
  toBar: number // inclusive
  startSpeed: Speed
  targetSpeed: Speed
  title: string // 'Bars 5–6', 'Drill: G string fret 7'
  sourceId: string // a real lesson id: gets the loop count, and is the heat cells' lesson
  drillKey?: string // drills: the heat cell key (ticks today's drill warm-up)
}
export interface LoopPass {
  speed: Speed
  acc: number // 0–1, events good or better
  clean: boolean // acc >= 0.9
}
export interface LoopSummary {
  passes: LoopPass[]
  clean: number // clean passes
  topSpeed: Speed // fastest clean pass; 0 = none
  reached: boolean // a clean pass at the target speed
  results: JudgeResult[] // finished passes only; event ids of `chart`
  chart: Chart // the segment chart (every segment of one loop has the same chart)
  calibrated: boolean
}

// ---- Latency ------------------------------------------------------------------

export interface LatencyCal {
  v: 1
  offsetMs: number
  pitchLagMs: number
  spreadMs: number
  device: string // deviceKey() for the guitar, 'keyboard' for key input
  at: number
}
export interface SyncOutcome {
  ok: boolean // good enough to save as calibration (≥ 6 of 8, MAD < 35 ms)
  captured: number // of 8
  offsetMs: number
  pitchLagMs: number
  madMs: number
  stars: Stars
  message: string
}

// ---- Prefs / run --------------------------------------------------------------

/** cable = guitar into an audio interface; mic = a microphone hearing the guitar (acoustic, or an amp in the room). */
export type InputSource = 'cable' | 'mic'

export interface Prefs {
  speedPick: { lessonId: string; speed: Speed } | null // a manual speed for one lesson; null = Auto
  easyTiming: boolean
  backingOn: boolean
  keyboard: boolean // force keyboard input even with a guitar connected
  input: InputSource
  micId: string | null // the chosen microphone's deviceId (null = the first non-interface input)
  zoom: 0.75 | 1 | 1.25
  visualNudgeMs: number // -100..100, display only
  showFretboard: boolean
  lastLesson: string | null
  seenRoar: boolean // the Roar explainer has been shown once
  age: number | null // optional, only for fun timing comparisons
}

export type RunState = 'idle' | 'countin' | 'playing' | 'ended' | 'stopped'
export type Autoplay = 'perfect' | 'sloppy' | 'silent'
export type KeyName = 'hit' | 'wrong' | 'mute' | 's1' | 's2' | 's3' | 's4' | 's5' | 's6'
