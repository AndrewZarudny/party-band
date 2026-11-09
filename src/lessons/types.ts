// Shared types for the Lessons tab. No runtime code.

import type { SkillStart } from '../skills/data'

export type WorldId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type ExerciseType = 'sync' | 'notes' | 'chords' | 'rhythm' | 'improv'
export type Timing = 'easy' | 'normal' | 'tight'
export type Tech = 'hammer' | 'pull' | 'slide' | 'bend' | 'vibrato' | 'pm'
export type FeelId = 'pop' | 'ballad' | 'blues' | 'funk' | 'reggae' | 'slowblues' | 'minorblues'
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
/** Play speed as a share of the lesson tempo: 0.6–1.15 on a 0.01 grid (below 1 = practice speed). */
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
  world: WorldId // the lesson's family (hand tips, guides, teach basics); the map uses STAGES
  order: number // 1-based within the family
  boss?: boolean // a stage checkpoint
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
  position?: number // home hand position (index-finger fret), e.g. 5 for A minor box 1; improv uses boxFret
  pickRule?: PickRule // default 'grid'
  free?: boolean // jam library: open with its stage, never blocks the next lesson, left out of stage stars
  dyad?: boolean // seq chord tokens are two-note shapes (boogie): judged by pitch like power chords, no chroma
}

/** A map stage: one fortnight of the 12-week plan, or the Extras area (id 7). */
export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7
export interface StageDef {
  id: StageId
  weeks: [number, number] | null // null = the Extras area
  title: string // what you learn
  skill: string // one plain line
  core: string[] // the plan's lessons in teaching order; the checkpoint (boss) is last
  extra: string[] // optional: open with the stage, never block anything
  encore?: string // an optional extra that also grows the dino
}

// ---- seq() output -------------------------------------------------------------

export type SeqItem =
  | { k: 'note'; beat: number; len: number; s: number; f: number; tech?: Tech; bend?: number; finger?: Finger }
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
  finger?: Finger // authoring hint (seq '@k')
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
  finger?: Finger // authoring hint (seq '@k')
  tech?: Tech // so the guide shows a hammered call note as not picked
  bendTo?: number
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

// ---- Fingering (fingering.ts) ---------------------------------------------------

/** Fretting-hand finger: 0 open string, 1 index, 2 middle, 3 ring, 4 pinky, 'T' thumb (never in these lessons). */
export type Finger = 0 | 1 | 2 | 3 | 4 | 'T'
export type PickDir = 'D' | 'U'
/** 'grid' = down on beats and 8ths (16ths when needed), up in between; 'down' = downstrokes only. */
export type PickRule = 'grid' | 'down'
/** The hand moves to a new position (the index finger's fret) for this note or chord. */
export interface Shift {
  from: number
  to: number
  kind: 'shift' | 'slide'
}
export interface Barre {
  fret: number
  from: number // string, 0 = low E, inclusive
  to: number
}
export interface ChordFingering {
  fingers: (Finger | null)[] // per string, low E first; null = not played, 0 = open
  barre?: Barre
}
export interface NoteFingering {
  finger: Finger
  pos: number | null // index-finger fret of the hand position; null while only open strings have sounded
  pick: PickDir | null // null = not picked (hammer, pull or slide target)
  legato: boolean
  palmMute: boolean
  shift?: Shift
}
export interface ChordEvFingering {
  fingering: ChordFingering
  pos: number | null // null for shapes with open strings
  pick: PickDir
  palmMute: boolean
  shift?: Shift
}
export type EventFingering =
  | ({ kind: 'note' } & NoteFingering)
  | ({ kind: 'chord' } & ChordEvFingering)
  | { kind: 'mute'; pick: PickDir }
  | { kind: 'rest' }
export interface ChartFingering {
  events: EventFingering[] // index = chart event id
  calls: NoteFingering[] // parallel to chart.calls
  startPos: number | null // the first fretted position
  grid: 0.5 | 0.25
  pickRule: PickRule
}
export interface FingerTip {
  finger: 1 | 2 | 3 | 4
  string: number
  fret: number
  down: boolean // pressing the string
  active: boolean // this finger plays the current note
}
/** Where the fretting hand is at one moment: for the animated demos. */
export interface HandFrame {
  pos: number | null
  string: number // the string the hovering fingers follow
  tips: FingerTip[] // always 4, fingers 1..4 in order
  barre: Barre | null
  eventId: number | null // current chart event (null before the first, or while a call sounds)
  callIdx: number | null // current chart.calls index, when a call is the current item
  sinceBeat: number // beats since the current item started; Infinity when none
  nextId: number | null // next chart event to play
  pick: PickDir | null
  palmMute: boolean
  shift: Shift | null // the current item's shift
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
  chordConf?: number // 0–1: how sure the chord check is; under CONF_LOW the chord is neither right nor wrong
  bendCents?: number // mean distance from the bend target while held, in cents
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
  jam?: JamStats
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
  swing?: boolean // judged against the swung grid
  shuffle?: boolean // a straight lesson played in shuffle mode
  cleanShare?: number // 0–1 events good or better (not improv or sync)
  bendCents?: number | null // mean of the bends' bendCents; null when no bend was graded
  chordStats?: ChordStats
  tab?: TabLevel // how much tab was shown (PlayScreen fills it)
  quiet?: boolean // listen mode
  peeked?: boolean // the player peeked at the full tab
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
  passedSpeed?: Speed // fastest speed of a passing run (old saves: the run nearest the first pass, when the run log has it)
  bestChain: number
  clean: boolean
  playsDay: string // dayKey of playsToday
  playsToday: number
  lastPlayed: number
  last?: LastAttempt // the previous run, for "better than last time" lines
  flat?: number // runs in a row without a new best score
  speed?: number // next Auto speed (speed trainer)
  topSpeed?: number // fastest earned speed (clean first run plus two more clean runs)
  overdrive?: boolean // earned at 100% with a top score: Auto may go up to 115%
  trial?: TempoTrial // the tempo being earned now
  loops?: number // finished loops with at least one clean pass (Loop the hard part, drills)
  loopTop?: number // fastest earned loop speed
  loopDay?: string // dayKey of the last loop with a clean pass (a looped item isn't cold that day)
  review?: ReviewState // review items only, from their first pass
  hist?: HistEntry[] // one entry per session the item was played, oldest first, max HIST_MAX
  firstS?: number // session number of the first play (block, then interleave)
  shuffleBest?: number // best score in shuffle mode
}

export interface TempoTrial {
  speed: Speed
  first: boolean // the first run at this speed was clean
  clean: number // clean runs at this speed, the first included
}

export interface ColdAttempt {
  s: number // session number
  d: string // dayKey
  bpm: number
  speed: Speed
  clean: boolean
  score: number
  tab: TabLevel
}

export interface HistEntry {
  s: number // session number
  d: string // dayKey
  best?: number // in-session best: highest BPM of a clean run that session
  cold?: ColdAttempt
}

export interface ReviewState {
  step: number // 0–3, index into SESSION_GAPS
  due: number // session number the next cold test is due at
  coldPasses: number // clean cold attempts at full tempo, in separate sessions, since the last failed one
  lastColdS: number // session number of the last counted clean cold attempt at full tempo (0 = none)
  learned: boolean
  learnedAt?: number // ms
  coldSpeed?: Speed // speed of the next cold test (after a fail: the staircase down); unset = coldSpeedFor's default
}

export interface LastAttempt {
  score: number
  spreadMs: number | null
  bpm: number
  bestChain: number
}

// ---- Sessions (session.ts, review.ts) ---------------------------------------------

export type TabLevel = 'full' | 'faded' | 'hidden'
export type PainLevel = 'none' | 'mild' | 'sharp'
export type SessionMin = 20 | 30
export type WeekShape = 'A' | 'B' | 'C' | 'D'
export type StepKind = 'warmup' | 'listenback' | 'cold' | 'new' | 'mix' | 'changes' | 'ear' | 'jam'

export interface SessionStep {
  kind: StepKind
  lessonId: string | null // null for skill steps
  skill?: SkillStart // changes, ear, listenback (record), pocket games
  items?: string[] // 'mix': lessons played in turn, one run each
  played?: string[] // 'mix': items played so far in this step
  consolidate?: boolean // 'new' in a C session: last session's new item again, blocked
  brake?: boolean // 'new' under the review brake: a struggling item, blocked, instead of a new lesson
  min: number
  state: 'todo' | 'done' | 'skipped'
  why: string
  from: { best: number; stars: Stars; speed: number; loops?: number }
  drill?: string // a trouble-spot drill (heat cell key)
  score?: number // set once, by the run that ticked the step (cold: the first try)
  best?: number // the best later run of this lesson today (not cold, not drill)
  speed?: number
}

/** Today's session: made once per practice day. */
export interface SessionPlan {
  v: 2
  day: string
  min: SessionMin
  shape: WeekShape
  steps: SessionStep[]
  away?: number // days since the last practice day, measured when the plan was made
}

export interface SessionDay {
  day: string // practice dayKey
  sec: number // practice-log seconds seen that day (the max of copies)
  set: boolean // the session plan was finished
  counted: boolean // a session: set, or sec >= SESSION_MIN_SEC
  pocket: boolean // a pocket session was played
  min?: SessionMin
  shape?: WeekShape
  pain?: PainLevel
  goal?: number // the week goal when this day was counted: past weeks keep the goal they had
}

export interface JamStats {
  strong: number | null // share 0–1 of notes on beats 1 and 3 that are chord tones; null under 4 such notes
  restBeats: number | null // mean rest between phrases, in beats; null under 2 phrases
  phrases: number
  silentBars: number // playing bars with no note at all
}

export interface ChordStats {
  ok: number // chords heard right
  wrong: number // heard clearly, and not the chord
  unsure: number // couldn't tell: never marked wrong
  conf: number | null // mean confidence 0–1 of the checked chords
}

/** One finished run, for the progress screen. */
export interface RunSample {
  at: number
  id: string // lesson id
  bpm: number
  swing: boolean
  mean: number | null // ms, + = late
  spread: number | null // ms
  n: number // graded hits
  tab: TabLevel
  quiet: boolean
  cold: boolean
  clean: boolean
  bend: number | null // cents
  jam?: JamStats
  chords?: ChordStats
}

export interface Progress {
  v: 1
  xp: number
  lessons: Record<string, LessonRecord>
  dinoName: string
  achievements: Record<string, number> // id -> timestamp
  cosmetics: Cosmetic[] // equipped
  stats: { bendsInTune: number }
  recentFacts: string[] // fact ids shown on the last result cards, oldest first (max 10)
  totalSec: number // judged playing time, all lessons
  plan: SessionPlan | null
  heat?: Heat // mistake heat map, rolling ~60 days (heat.ts)
  created: number
  sessionMin: SessionMin // default 30
  weekGoal: number // sessions a week, 2–5, default 3
  sessions: { log: SessionDay[]; before: number } // before = counted sessions trimmed off the log
  weekXp: string[] // week keys whose goal was met at the time (no XP: the name is kept for saved data), newest last, max 20
  runs: RunSample[] // oldest first, max RUNS_MAX
  seenWeekly?: boolean // the "weeks, not days" note was shown
  mapV?: 2 // the map follows the 12-week plan (absent: an old world-map save, migrated on load)
  keepOpen?: string[] // lessons the old map had open: they never lock
  dinoBonus?: number // dino stages carried over from the old map, so the dino never shrinks
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
  stageOpened: StageId | null
  competence: string[] // what got better, in plain words ("Cold tempo on Boogie Shuffle in A is up 8 BPM.")
  cold: ColdAttempt | null // this run was a cold-start test
  review: ReviewState | null // the item's review after this run
  factLines: FactLine[]
  speed: {
    played: number
    next: number
    topBefore: number
    topAfter: number
    earned: boolean
    trial: TempoTrial | null // open trial after the run
    clean: boolean
  } | null // null for sync
}

export interface FactLine {
  text: string
  factId: string | null // null = only the player's own numbers
}

export type DinoMood = 'idle' | 'focus' | 'happy' | 'hyped' | 'oops' | 'sad' | 'sleepy' | 'proud'
export interface DinoStage {
  stage: number // 0–8
  name: string
  after: number | null // growth lessons passed to reach it: checkpoints and encores (null = start)
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
  slow?: boolean // a relaxed pass in a slow segment (never decides the tempo)
}
export interface LoopSummary {
  passes: LoopPass[]
  clean: number // clean passes
  topSpeed: Speed // fastest clean pass; 0 = none
  reached: boolean // a clean pass at the target speed
  results: JudgeResult[] // finished passes only; event ids of `chart`
  chart: Chart // the segment chart (every segment of one loop has the same chart)
  calibrated: boolean
  earned: Speed // fastest tempo earned in this loop (clean first pass plus two more); 0 = none
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
  guides: 'auto' | 'on' | 'off' // finger and pick guides in play; auto = by world
  seenBasics: boolean // the Technique basics sheet has opened once
}

export type RunState = 'idle' | 'countin' | 'playing' | 'ended' | 'stopped'
export type Autoplay = 'perfect' | 'sloppy' | 'silent'
export type KeyName = 'hit' | 'wrong' | 'mute' | 's1' | 's2' | 's3' | 's4' | 's5' | 's6'
