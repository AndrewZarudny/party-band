import { useCallback, useEffect, useRef, useState } from 'react'
import '../lessons/lessons.css'
import { engine } from '../audio/engine'
import type { ApplyOutcome, Cosmetic, Lesson, LessonResult, LoopSpec, LoopSummary, PainLevel, Prefs, Progress, StageId, SyncOutcome, TabLevel } from '../lessons/types'
import type { SkillStart } from '../skills/data'
import { buildChart } from '../lessons/charts'
import { loopSpecFor, recordLoop } from '../lessons/loop'
import { recordHeat } from '../lessons/heat'
import { drillSpec } from '../lessons/drill'
import { STAGES, lessonById, stageOf, validateLessons } from '../lessons/data'
import { applyResult, dayKey, dinoStageFor, isPassed, isUnlocked, loadProgress, nextLesson, recordSkip, saveProgress, stageOpen } from '../lessons/progress'
import { FULL_SPEED, bpmAt, pickFor, slowerSpeed, speedFor } from '../lessons/speed'
import type { ExtraKind } from '../lessons/session'
import {
  GAP_SEC,
  REST_SEC,
  blockLine,
  jamPasses,
  markPocket,
  mixNext,
  planAddTime,
  planAfterLoop,
  planAfterRun,
  planAfterSkill,
  planAfterSong,
  planDone,
  setPain,
  skipStep,
  stepLeftSec,
  stepOpensCold,
  stepTitle,
  swapStep,
  withExtraStep,
  withSessionDay,
  withSongStepsFixed,
  withTodayPlan,
} from '../lessons/session'
import { coldRun, coldSpeedFor, reviewBrake } from '../lessons/review'
import { isJam, tabLevelFor } from '../lessons/listen'
import { practice } from '../account/activity'
import { openAccountDialog, useAccount } from '../account/session'
import { loadPrefs, savePrefs } from '../lessons/prefs'
import { syncResult } from '../lessons/scoring'
import { engineHasLessons } from '../lessons/input'
import { connectSource, onMicInput } from '../lessons/source'
import { getPracticeSnapshot } from '../practice/log'
import { practiceDaySec } from '../practice/data'
import { hasUnratedTake } from '../skills/takes'
import { listSongs } from '../music/library'
import { levelCount, loadLevels } from '../music/songLevels'
import { loadStats, onSkillRound } from '../skills/store'
import type { MapSong, MapSongPart } from '../lessons/ui/LessonMap'
import { partsOf, songPath } from '../music/songPath'
import { loadGoal } from '../lessons/goal'
import { lastCheckIn } from '../lessons/checkin'
import { LessonMap } from '../lessons/ui/LessonMap'
import { LessonIntro } from '../lessons/ui/LessonIntro'
import { ResultCard } from '../lessons/ui/ResultCard'
import { SyncUp } from '../lessons/ui/SyncUp'
import { SettingsPanel } from '../lessons/ui/SettingsPanel'
import { AchievementsPanel } from '../lessons/ui/AchievementsPanel'
import { PlayScreen } from '../lessons/ui/PlayScreen'
import { PlanStrip, TodayScreen } from '../lessons/ui/TodayPlan'
import { ColdStart, MentalCard } from '../lessons/ui/SessionCards'
import { ProgressScreen } from '../lessons/ui/ProgressScreen'
import { lessonsStartScreen, onOpenProgress, progressAsked, progressShown } from '../practice/progressLink'
import { PlanWeeks } from '../lessons/ui/PlanWeeks'
import { setCoachActions, setCoachPlaying } from '../lessons/liveCoach'
import type { CoachActions } from '../lessons/liveCoach'
import { BasicsSheet } from '../lessons/ui/teach/BasicsSheet'
import { LoopScreen } from '../lessons/ui/LoopScreen'
import { HeatScreen } from '../lessons/ui/HeatScreen'
import { Dino } from '../lessons/ui/Dino'
import { SkillsHome } from '../skills/ui/SkillsHome'
import type { RoundSession } from '../skills/ui/Common'
import { RoundSessionContext } from '../skills/ui/Common'

type Screen =
  | 'welcome'
  | 'home'
  | 'today'
  | 'intro'
  | 'sync'
  | 'play'
  | 'results'
  | 'achievements'
  | 'settings'
  | 'loop'
  | 'heat'
  | 'skills'
  | 'cold'
  | 'progress'
  | 'weeks'
  | 'pocket-mental'

/** How the next run plays: a cold-start test, listen mode, shuffle mode, how much tab, a one-run speed, a long jam. */
interface RunMode {
  cold: boolean
  quiet: boolean
  shuffle: boolean
  tab: TabLevel
  speed: number | null // a one-run speed (cold start); null = Auto or the manual pick
  passes: number // times through in one run: above 1 only for a session's jam block
}
const PLAIN: RunMode = { cold: false, quiet: false, shuffle: false, tab: 'full', speed: null, passes: 1 }

const SYNC_ID = 'w1-01'
const WEEK_NOTE = 'Week goal met. Anything more is a bonus.'
/** A run's block gets at most this much on top of the run's own length: the pause before it, already capped by the log. */
const RUN_EXTRA_SEC = 90

function hasSavedProgress() {
  try {
    return localStorage.getItem('lessons-progress') !== null
  } catch {
    return false
  }
}

/**
 * After an extra: the next open unpassed extra of its stage, else the plan's next lesson. After anything else: the plan's next lesson.
 * None under the review brake: new lessons wait until a few struggling items pass their cold start (plan section 4).
 */
function nextAfter(p: Progress, id: string): string | null {
  if (reviewBrake(p)) return null
  const at = stageOf(id)
  if (at && !at.core) {
    const more = at.stage.extra.slice(at.pos + 1).find((x) => isUnlocked(p, x) && !isPassed(p, x))
    if (more) return more
  }
  const n = nextLesson(p)
  return n && n !== id ? n : null
}

/** Seconds of practice in today's practice day (4 am to 4 am, as the session log counts it), every browser. */
function practiceSecToday(): number {
  try {
    return practiceDaySec(getPracticeSnapshot(), dayKey(new Date()))
  } catch {
    return 0
  }
}

/** Start of the last counted session before today (ms), for the "rate last session's take" check. */
function lastSessionStart(p: Progress, now: Date): number {
  const today = dayKey(now)
  const prev = (p.sessions?.log ?? []).filter((d) => d.counted && d.day < today)
  const day = prev[prev.length - 1]?.day
  return day ? new Date(day + 'T04:00:00').getTime() : 0
}

let validated = false

/** A Song block that was opened in Learn a song: which plan step, and the practice clock when it opened. */
const SONG_MARK = 'lessons-song-block'

export function LessonsMode({ onConnect, onOpenSong }: { onConnect: () => void; onOpenSong?: (id: string) => void }) {
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [screen, setScreen] = useState<Screen>(() => lessonsStartScreen(hasSavedProgress(), progressAsked()))
  // The progress screen came from the practice dialog: its heading takes focus.
  const [progressFocus, setProgressFocus] = useState(() => screen === 'progress')
  const [lessonId, setLessonId] = useState<string | null>(null)
  const [syncLesson, setSyncLesson] = useState(false)
  const [syncBack, setSyncBack] = useState<Screen>('home')
  const [runKey, setRunKey] = useState(0)
  const [listen, setListen] = useState(false)
  const [mode, setMode] = useState<RunMode>(PLAIN)
  const [fromNew, setFromNew] = useState<string | null>(null) // lesson opened from a 'new' step: rest between runs
  // The last run's result, and the plan step (block) it counted for.
  const [last, setLast] = useState<{ result: LessonResult; outcome: ApplyOutcome; step: number | null } | null>(null)
  const [loop, setLoop] = useState<{ spec: LoopSpec; back: Screen } | null>(null)
  const [skillStart, setSkillStart] = useState<SkillStart | undefined>(undefined)
  const [skillKey, setSkillKey] = useState(0)
  const [unrated, setUnrated] = useState<boolean | null>(null) // null until the take check is back
  const [songs, setSongs] = useState<MapSong[] | null>(null)
  const [songParts, setSongParts] = useState<MapSongPart[] | null>(null) // null until the songs are read // null until the library is read
  const [notice, setNotice] = useState<string | null>(null)
  // The live coach doesn't listen during a run or the sync check, so the guitar isn't taken for speech.
  useEffect(() => {
    setCoachPlaying(screen === 'play' || screen === 'sync')
  }, [screen])
  const [pressure, setPressure] = useState(false)
  const [staleEngine] = useState(() => import.meta.env.DEV && !engineHasLessons())
  // The session block being played (a step of today's plan), and the practice clock when its time was last counted.
  const [block, setBlock] = useState<number | null>(null)
  const mark = useRef({ sec: 0, at: 0 })

  /** Practice seconds since the open block's time was last counted: never more than the wall clock allows. */
  const readSec = useCallback(() => {
    const wall = (Date.now() - mark.current.at) / 1000 + 1
    return Math.max(0, Math.round(Math.min(practiceSecToday() - mark.current.sec, wall)))
  }, [])
  const markNow = useCallback(() => {
    mark.current = { sec: practiceSecToday(), at: Date.now() }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV || validated) return
    validated = true
    const problems = validateLessons()
    if (problems.length) console.warn('Lessons data problems:', problems)
  }, [])

  // A mic in the room must not hear the amp sim (feedback, and it would count as playing).
  // Leaving Lessons (or picking the cable) goes back to the guitar cable; the amp returns only once that worked.
  useEffect(() => {
    if (prefs.input !== 'mic') return
    engine.setAmpOn(false)
    return () => {
      // Sent over to Learn a song by a Song block: keep listening through the mic (amp still off), so the
      // song's parts hear the player. Coming back and leaving Lessons normally restores the cable.
      try {
        if (sessionStorage.getItem(SONG_MARK)) return
      } catch {
        /* storage unavailable: restore the cable as usual */
      }
      if (!engine.running || !onMicInput()) {
        engine.setAmpOn(engine.hearAmp)
        return
      }
      connectSource('cable', null)
        .then(() => engine.setAmpOn(engine.hearAmp))
        .catch(() => {
          /* no interface: stay on the mic with the amp off rather than feed back */
        })
    }
  }, [prefs.input])

  // Is last session's jam take still unrated? Asked once; the plan waits for the answer.
  useEffect(() => {
    let live = true
    hasUnratedTake(lastSessionStart(progress, new Date()))
      .then((v) => live && setUnrated(v))
      .catch(() => live && setUnrated(false))
    return () => {
      live = false
    }
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The player's own songs: the list for the map, and every part of them built as a lesson and placed in a course
  // week (easier parts, fewer notes a beat, in earlier weeks). The plan waits for this.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const all = await listSongs()
        const { songLessons } = await import('../lessons/songLesson')
        const built = all.flatMap((x) => {
          const r = songLessons(x)
          return 'parts' in r ? r.parts : []
        })
        const weeks = STAGES.filter((st) => st.weeks).map((st) => st.id)
        const per = Math.max(1, Math.ceil(built.length / weeks.length))
        const placed = [...built]
          .sort((a, b) => a.density - b.density)
          .map((sp, i) => ({ id: sp.id, song: sp.song, part: sp.part, stage: weeks[Math.min(weeks.length - 1, Math.floor(i / per))] as number }))
        if (!live) return
        setSongParts(placed)
        setSongs(all.map((x) => ({ id: x.id, title: x.title, levels: loadLevels(x.id), ...levelCount(loadLevels(x.id)) })).sort((a, b) => a.title.localeCompare(b.title)))
      } catch {
        if (!live) return
        setSongParts([])
        setSongs([])
      }
    })()
    return () => {
      live = false
    }
  }, [])

  // Back from Learn a song: the time played there counts for the Song block that sent the player over.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SONG_MARK)
      if (!raw) return
      sessionStorage.removeItem(SONG_MARK)
      const m = JSON.parse(raw) as { i: number; sec: number; day: string }
      const now = new Date()
      if (m.day !== dayKey(now)) return
      const ticked = planAfterSong(loadProgress(), m.i, practiceSecToday() - m.sec, now)
      if (ticked.step !== null) {
        const sd = withSessionDay(ticked.progress, now, practiceSecToday())
        // eslint-disable-next-line react-hooks/set-state-in-effect -- back from a song (mark in sessionStorage): count it toward today's plan once on mount
        setProgress(sd.progress)
        saveProgress(sd.progress)
      }
    } catch {
      /* no marker to read */
    }
  }, [])

  // "What's sticking" in the practice dialog: the progress screen (asked before this mounted, or while it shows).
  // Not before the Welcome is done: a new player sets up first.
  useEffect(() => {
    progressShown()
    return onOpenProgress(() => {
      progressShown()
      if (!hasSavedProgress()) return
      setProgressFocus(true)
      setScreen('progress')
    })
  }, [])

  const lesson: Lesson | undefined = lessonId ? lessonById(lessonId) : undefined

  // Saved in this browser; when signed in, the account sync picks the change up from storage.
  const { account } = useAccount()
  const updateProgress = useCallback((p: Progress) => {
    setProgress(p)
    saveProgress(p)
  }, [])
  const updatePrefs = useCallback((p: Prefs) => {
    setPrefs(p)
    savePrefs(p)
  }, [])

  /** `p` with the practice time since the last reading counted toward the open block: the rest between reps, a stopped run. */
  const settle = (p: Progress, now = new Date()): Progress => {
    if (block === null) return p
    const sec = readSec()
    markNow()
    return planAddTime(p, block, sec, now).progress
  }

  /** The open block is left: its time so far is counted, and nothing after this belongs to it. */
  const leaveBlock = () => {
    if (block === null) return
    const p = settle(progress)
    if (p !== progress) updateProgress(p)
    setBlock(null)
  }

  const showHome = () => {
    setScreen('home')
    setLast(null)
    setProgressFocus(false)
  }

  const goHome = () => {
    leaveBlock()
    showHome()
  }

  // Today's session plan (made once per practice day) and today's session day, when the home or plan screen shows.
  useEffect(() => {
    if ((screen !== 'home' && screen !== 'today') || unrated === null || songParts === null) return
    const now = new Date()
    let p = progress
    let changed = false
    // Song parts whose week is open, in map order.
    // The song goal's parts count as open whatever their week: it is the song you chose to work on.
    const goal = loadGoal()
    const openParts = songParts.filter((sp) => stageOpen(p, sp.stage as StageId) || (!!goal && sp.id.startsWith(`song:${goal.songId}:`))).map((sp) => sp.id)
    // Songs whose parts are learned (or that have none) and whose path goes on in Learn a song.
    const songsToPlay = (songs ?? [])
      .filter((sg) => songPath(partsOf(songParts, sg.id, (id) => isPassed(p, id)), sg.levels).next?.kind === 'song')
      .map((sg) => ({ id: sg.id, title: sg.title }))
    const made = withTodayPlan(p, now, { unratedTake: unrated, stats: loadStats(), songParts: openParts, songsToPlay, goalSongId: goal?.songId, lastFeel: lastCheckIn(now)?.feel })
    if (made) {
      p = made
      changed = true
    }
    // A song deleted since the plan was made: its step takes another song part, or is skipped.
    const fixed = withSongStepsFixed(p, openParts)
    if (fixed) {
      p = fixed
      changed = true
    }
    const sd = withSessionDay(p, now, practiceSecToday())
    if (sd.changed) {
      p = sd.progress
      changed = true
      // eslint-disable-next-line react-hooks/set-state-in-effect -- plan upkeep when a screen opens: tell the player their week was met
      if (sd.weekMet) setNotice(WEEK_NOTE)
    }
    if (changed) updateProgress(p)
  }, [screen, progress, unrated, songParts, songs, updateProgress])

  // Skill rounds count for the plan's skill blocks (with the round's practice time) and toward today's session.
  useEffect(() => {
    if (screen !== 'skills') return
    return onSkillRound((e) => {
      const now = new Date()
      // The skill game may have saved some XP: start from the stored copy.
      const ticked = planAfterSkill(loadProgress(), e, now, block !== null ? readSec() : 0)
      // Only a round that counted for a block uses up the time: the ear game reports two entries for one round.
      if (ticked.step !== null && block !== null) markNow()
      const sd = withSessionDay(ticked.progress, now, practiceSecToday())
      if (sd.weekMet) setNotice(WEEK_NOTE)
      updateProgress(sd.progress)
    })
  }, [screen, block, readSec, markNow, updateProgress])

  // The rest between reps is practice too: the first seconds on the result card count toward the day and the block
  // (plan section 4 puts the 20-30 s pauses inside the block's minutes). Walking away adds no more than that.
  useEffect(() => {
    if (screen !== 'results') return
    const stop = practice('lessons', true)
    const t = window.setTimeout(() => stop?.(), GAP_SEC * 1000)
    return () => {
      window.clearTimeout(t)
      stop?.()
    }
  }, [screen, last])

  /** A lesson's start screen. `keep`: it belongs to the open session block; anything else leaves the block. */
  const open = (id: string, o: { fromNew?: boolean; keep?: boolean } = {}) => {
    const l = lessonById(id)
    if (!l) return
    if (!o.keep) leaveBlock()
    setLessonId(id)
    setMode(PLAIN)
    setNotice(null)
    setFromNew(o.fromNew ? id : null)
    // A manual speed belongs to one lesson.
    updatePrefs({ ...prefs, lastLesson: id, speedPick: prefs.speedPick?.lessonId === id ? prefs.speedPick : null })
    if (l.type === 'sync') {
      setSyncLesson(true)
      setSyncBack('home')
      setScreen('sync')
    } else setScreen('intro')
  }

  const startRun = (m: RunMode) => {
    setMode(m)
    setNotice(null)
    setListen(false)
    setRunKey((k) => k + 1)
    setScreen('play')
  }

  // From the intro: shuffle and listen mode are this run's choices.
  const play = (o?: { shuffle?: boolean; quiet?: boolean }) => {
    if (!lesson) return
    const quiet = !!o?.quiet
    const tab: TabLevel = quiet ? (isJam(lesson) ? 'hidden' : tabLevelFor(progress.lessons[lesson.id])) : 'full'
    startRun({ cold: false, quiet, shuffle: !!o?.shuffle, tab, speed: null, passes: 1 })
  }

  // "Listen first": the same play screen, demo playback with no judging.
  const playDemo = () => {
    setMode(PLAIN)
    setListen(true)
    setRunKey((k) => k + 1)
    setScreen('play')
  }

  // The speed the current lesson's next run plays at (a cold start's speed, Auto, or this lesson's manual pick).
  const runSpeed = lesson ? (mode.speed ?? speedFor(lesson, progress.lessons[lesson.id], prefs)) : 1

  const startLoop = (spec: LoopSpec, back: Screen) => {
    setLoop({ spec, back })
    setRunKey((k) => k + 1)
    setScreen('loop')
  }

  const openDrill = (key: string, back: Screen, p: Progress = progress) => {
    const spec = drillSpec(p, key, new Date(), p.plan?.steps.find((s) => s.drill === key)?.lessonId ?? undefined)
    if (spec) startLoop(spec, back)
  }

  const openSkill = (s: SkillStart) => {
    if (s.game === 'mental') return setScreen('pocket-mental')
    setSkillStart(s)
    setSkillKey((k) => k + 1)
    setScreen('skills')
  }

  /**
   * A step of today's plan, as a block: its practice time is counted from here on. Cold steps go through the
   * Cold start card, jams play in listen mode for what is left of their minutes, skills open their game.
   * `from`: the progress to start from, when the caller has changed it and not saved yet.
   */
  const openStep = (i: number, back: Screen, from: Progress = progress) => {
    // Coming from another block: its time first.
    const p = block !== null && block !== i ? settle(from) : from
    if (p !== progress) updateProgress(p)
    const step = p.plan?.steps[i]
    if (!step) return
    // A done or skipped step still opens, as plain practice: no block.
    const live = step.state === 'todo'
    setBlock(live ? i : null)
    markNow()
    if (step.drill) return openDrill(step.drill, back, p)
    if (step.kind === 'mix') {
      const id = mixNext(step)
      if (id) open(id, { keep: true })
      return
    }
    if (step.song) {
      // Played in Learn a song: note the clock, so the time there counts for this block on the way back.
      try {
        sessionStorage.setItem(SONG_MARK, JSON.stringify({ i, sec: practiceSecToday(), day: dayKey(new Date()) }))
      } catch {
        /* storage unavailable: the block is closed by hand */
      }
      setBlock(null)
      onOpenSong?.(step.song.id)
      return
    }
    if (!step.lessonId) {
      if (step.skill) openSkill(step.skill)
      return
    }
    const id = step.lessonId
    const l = lessonById(id)
    if (!l) {
      // Never a button that does nothing: say why.
      setBlock(null)
      setNotice(id.startsWith('song:') ? "That song part can't be opened: its song is no longer in your library. Skip this step." : "That lesson can't be opened.")
      return
    }
    // A review-first step on an item due its cold test takes the test first, then its blocked reps (with rests).
    if (stepOpensCold(p, step, new Date())) {
      setLessonId(id)
      setFromNew(step.brake ? id : null)
      setScreen('cold')
      return
    }
    if (step.kind === 'jam' && l.type === 'improv') {
      setLessonId(id)
      setFromNew(null)
      const passes = live ? jamPasses(l, speedFor(l, p.lessons[id], prefs), stepLeftSec(step)) : 1
      startRun({ cold: false, quiet: true, shuffle: false, tab: 'hidden', speed: null, passes })
      return
    }
    open(id, { fromNew: step.kind === 'new', keep: true })
  }

  // Again from the result card: the same choices, but never cold again and back on Auto speed.
  // Inside a session block: a mix moves on to its next item, a jam plays for what is left of its minutes.
  const again = () => {
    const p = settle(progress)
    if (p !== progress) updateProgress(p)
    const step = block !== null ? p.plan?.steps[block] : undefined
    const live = step?.state === 'todo'
    if (block !== null && step && live && step.kind === 'mix') return openStep(block, 'home', p)
    const passes = lesson && step && live && step.kind === 'jam' ? jamPasses(lesson, speedFor(lesson, p.lessons[lesson.id], prefs), stepLeftSec(step)) : 1
    startRun({ ...mode, cold: false, speed: null, passes })
  }

  const playSlower = (from: number) => {
    if (!lesson) return
    const p = settle(progress)
    if (p !== progress) updateProgress(p)
    updatePrefs({ ...prefs, speedPick: { lessonId: lesson.id, speed: slowerSpeed(from) } })
    startRun({ ...mode, cold: false, speed: null })
  }

  const finish = (l: Lesson, r: LessonResult) => {
    const now = new Date()
    // A cold-start test only when started from the Cold start card, and still the item's first try today.
    const cold = coldRun(progress, l.id, now, { fromCard: mode.cold, shuffle: !!r.shuffle })
    // Mistake heat from this run's judged events (not sync or improv runs).
    const heated = r.results && (l.type === 'notes' || l.type === 'chords' || l.type === 'rhythm') ? recordHeat(progress, l, buildChart(l), r.results, { sourceId: l.id, calibrated: r.calibrated === true, now }) : progress
    const outcome = applyResult(heated, l, r, now, { age: prefs.age, cold })
    // The run's practice time for its block: the log's seconds since the last reading (the rest before the run is in
    // them), and never less than the run itself, so a lesson opened from the map counts for its block too.
    const runSec = Math.round(Math.max(0, r.playedSec) + ((l.countInBeats ?? 4) * 60) / Math.max(1, r.bpm))
    const sec = block !== null ? Math.min(Math.max(readSec(), runSec), runSec + RUN_EXTRA_SEC) : runSec
    markNow()
    // A full tempo earned today (a clean first run plus two more): the new block has done its job.
    const mastered = l.type !== 'improv' && !!outcome.speed?.earned && outcome.speed.played >= FULL_SPEED - 1e-9
    const planned = planAfterRun(outcome.progress, l.id, r, now, { sec, coldClean: outcome.cold?.clean === true, mastered })
    setBlock(planned.step)
    const sd = withSessionDay(planned.progress, now, practiceSecToday())
    if (sd.weekMet) setNotice(WEEK_NOTE)
    updateProgress(sd.progress)
    setLast({ result: r, outcome: { ...outcome, progress: sd.progress }, step: planned.step })
    setScreen('results')
  }

  const resync = (back: Screen) => {
    setSyncLesson(false)
    setSyncBack(back)
    setScreen('sync')
  }

  // A loop never gives XP or stars: it records heat, the loop count and (drills) today's drill step.
  // Its practice time goes to the open block: the drill's own step, or the block whose hard bars were looped.
  const endLoop = (s: LoopSummary | null, next: 'full' | 'back') => {
    const cur = loop
    setLoop(null)
    if (!cur) return goHome()
    const now = new Date()
    const sec = block !== null ? readSec() : 0
    if (block !== null) markNow()
    let p = progress
    if (s && s.results.length) {
      p = recordHeat(p, cur.spec.lesson, s.chart, s.results, { sourceId: cur.spec.sourceId, calibrated: s.calibrated, now, loop: true })
      p = recordLoop(p, cur.spec.sourceId, s, now)
    }
    const drilled = s && cur.spec.drillKey ? planAfterLoop(p, cur.spec.drillKey, s, now, sec) : null
    if (drilled && drilled.step !== null) p = drilled.progress
    else if (block !== null) p = planAddTime(p, block, sec, now).progress
    if (p !== progress) {
      const sd = withSessionDay(p, now, practiceSecToday())
      if (sd.weekMet) setNotice(WEEK_NOTE)
      updateProgress(sd.progress)
    }
    if (next === 'full' && cur.spec.kind === 'bars') {
      setLessonId(cur.spec.sourceId)
      setLast(null)
      startRun(PLAIN)
      return
    }
    if (cur.back === 'results' && !last) return goHome()
    // Back on the home or session screen the block is closed; opening its row again carries on.
    if (cur.back === 'home' || cur.back === 'today') setBlock(null)
    setScreen(cur.back)
  }

  /**
   * From a block's result (or a skill round): on to the next block. A block with minutes left is closed first:
   * it was played, so it is done. With no block left, back to today's session.
   */
  const moveOn = (i: number) => {
    const now = new Date()
    let p = settle(progress, now)
    if (p.plan?.steps[i]?.state === 'todo') p = skipStep(p, i)
    const ni = p.plan ? p.plan.steps.findIndex((s) => s.state === 'todo') : -1
    if (ni >= 0) return openStep(ni, 'home', p)
    const sd = withSessionDay(p, now, practiceSecToday())
    if (sd.weekMet) setNotice(WEEK_NOTE)
    if (sd.progress !== progress) updateProgress(sd.progress)
    setBlock(null)
    setSkillStart(undefined)
    showHome()
  }

  /** One more block once the session is done, toward the day's minutes: added to the plan and started at once. */
  const extra = (kind: ExtraKind, leftSec: number) => {
    const p = withExtraStep(progress, new Date(), { unratedTake: false, stats: loadStats() }, kind, leftSec)
    if (p === progress || !p.plan) return
    openStep(p.plan.steps.length - 1, 'home', p)
  }

  const pocket = (s: SkillStart) => {
    leaveBlock()
    updateProgress(markPocket(progress, new Date()))
    openSkill(s)
  }

  const pain = (level: PainLevel) => updateProgress(setPain(progress, new Date(), level))

  const onSyncDone = (o: SyncOutcome | null, skipped: boolean) => {
    if (!syncLesson) {
      setScreen(syncBack)
      return
    }
    const l = lessonById(SYNC_ID)
    if (!l) return goHome()
    if (skipped) {
      updateProgress(recordSkip(progress, l.id, new Date()))
      return goHome()
    }
    if (o && o.captured >= 4) {
      setLessonId(l.id)
      finish(l, syncResult(l, o))
      return
    }
    goHome()
  }

  const keyboard = prefs.keyboard || !engine.running
  const stage = dinoStageFor(progress)
  const cosmetics: Cosmetic[] = progress.cosmetics

  // What the main button does next in the block at plan step i: for the result card and the skill games' round summary.
  const blockNext = (i: number) => {
    const plan = progress.plan
    const st = plan?.steps[i]
    if (!plan || !st) return null
    const running = st.state === 'todo'
    const after = plan.steps.find((s, j) => s.state === 'todo' && j !== i)
    // No onNext closure in here: moveOn reads the practice-clock ref, and this runs during render.
    return {
      i,
      step: st,
      running,
      nextLabel: after ? `Next: ${stepTitle(after)}` : running ? 'Finish the session' : 'Back to today',
    }
  }

  // What the live coach may do for the player on this screen (asked by voice, or agreed to).
  const coachActions: CoachActions = {}
  const planNext = progress.plan && progress.plan.day === dayKey(new Date()) ? progress.plan.steps.findIndex((st) => st.state === 'todo') : -1
  if ((screen === 'home' || screen === 'today') && planNext >= 0)
    coachActions['play'] = { about: "start the next step of today's plan", run: () => openStep(planNext, screen === 'today' ? 'today' : 'home') }
  if (screen !== 'home' && screen !== 'welcome' && screen !== 'play') coachActions['home'] = { about: 'back to the Lessons home', run: goHome }
  let body
  if (screen === 'welcome') {
    body = (
      <Welcome
        onSignIn={account ? null : () => openAccountDialog('login')}
        onStart={(name) => {
          updateProgress({ ...progress, dinoName: name })
          setLessonId(SYNC_ID)
          setSyncLesson(true)
          setSyncBack('home')
          setScreen('sync')
        }}
      />
    )
  } else if (screen === 'sync') {
    body = <SyncUp key={`sync-${runKey}`} lessonMode={syncLesson} keyboard={keyboard} onDone={onSyncDone} />
  } else if (screen === 'intro' && lesson) {
    coachActions['start'] = { about: `start ${lesson.title}`, run: () => play() }
    body = (
      <LessonIntro
        lesson={lesson}
        progress={progress}
        prefs={prefs}
        onPrefs={updatePrefs}
        onStart={play}
        onListen={playDemo}
        onSync={() => resync('intro')}
        onBack={goHome}
        onConnect={onConnect}
      />
    )
  } else if (screen === 'cold' && lesson) {
    const speed = coldSpeedFor(lesson, progress.lessons[lesson.id])
    // Research: first attempt, no tab. Peek stays there if you're stuck (the run then logs the full tab).
    body = (
      <ColdStart
        title={lesson.title}
        goal={lesson.goal}
        bpm={bpmAt(lesson, speed)}
        speed={speed}
        onStart={() => startRun({ cold: true, quiet: false, shuffle: false, tab: 'hidden', speed, passes: 1 })}
        onBack={() => {
          leaveBlock()
          setScreen('today')
        }}
      />
    )
  } else if (screen === 'play' && lesson) {
    body = (
      <PlayScreen
        key={`${lesson.id}-${runKey}`}
        lesson={lesson}
        listen={listen}
        speed={runSpeed}
        prefs={prefs}
        stage={stage}
        cosmetics={cosmetics}
        tab={mode.tab}
        quiet={mode.quiet}
        shuffle={mode.shuffle}
        cold={mode.cold}
        passes={mode.passes}
        onPrefs={updatePrefs}
        onEnd={(r) => finish(lesson, r)}
        onQuit={() => {
          // A run that was stopped still used the block's time.
          const p = settle(progress)
          if (p !== progress) updateProgress(p)
          if (mode.cold) setBlock(null)
          setScreen(mode.cold ? 'today' : 'intro')
        }}
        onSlower={() => playSlower(runSpeed)}
        onConnect={onConnect}
      />
    )
  } else if (screen === 'loop' && loop) {
    body = <LoopScreen key={`loop-${runKey}`} spec={loop.spec} prefs={prefs} stage={stage} cosmetics={cosmetics} onExit={endLoop} onConnect={onConnect} />
  } else if (screen === 'heat') {
    body = <HeatScreen progress={progress} onDrill={(key) => openDrill(key, 'heat')} onBack={goHome} />
  } else if (screen === 'results' && lesson && last) {
    // A run that counted for a session block: the card's one main button is the block's next move.
    const bn = last.step !== null && lesson.type !== 'sync' ? blockNext(last.step) : null
    const next = bn ? null : nextAfter(last.outcome.progress, lesson.id)
    const mixId = bn?.step.kind === 'mix' ? mixNext(bn.step) : null
    const lr = last.result
    coachActions['again'] = { about: 'play it again', run: () => (lesson.type === 'sync' ? open(lesson.id) : again()) }
    if (lesson.type !== 'sync') coachActions['slower'] = { about: 'play it again a step slower', run: () => playSlower(lr.speed) }
    if (lesson.type !== 'sync' && lesson.type !== 'improv')
      coachActions['loop'] = {
        about: `loop some bars slowly until clean; argument: bars like 3-4 (1 to ${lesson.bars}${lr.hardestBar !== null ? `, hardest was ${lr.hardestBar + 1}` : ''})`,
        run: (arg) => {
          const m = (arg ?? '').match(/(\d+)(?:\s*(?:-|to)\s*(\d+))?/)
          const hard = lr.hardestBar ?? 0
          const a = m ? Number(m[1]) - 1 : hard
          const b = m ? Number(m[2] ?? m[1]) - 1 : hard
          const from = Math.max(0, Math.min(a, b, lesson.bars - 1))
          const to = Math.min(lesson.bars - 1, Math.max(a, b, from))
          startLoop(loopSpecFor(lesson, lr, from, to), 'results')
        },
      }
    if (bn) coachActions['next'] = { about: bn.nextLabel, run: () => moveOn(bn.i) }
    else if (next) coachActions['next'] = { about: `on to ${lessonById(next)?.title ?? 'the next lesson'}`, run: () => open(next) }
    const session = bn
      ? {
          running: bn.running,
          againLabel: mixId ? `Next in the mix: ${lessonById(mixId)?.title ?? mixId}` : bn.step.kind === 'jam' ? 'Jam on' : 'Again',
          nextLabel: bn.nextLabel,
          onNext: () => moveOn(bn.i),
        }
      : null
    body = (
      <>
        {last.step !== null && bn && <PlanStrip progress={progress} step={last.step} />}
        <ResultCard
          lesson={lesson}
          result={last.result}
          outcome={last.outcome}
          pick={pickFor(prefs, lesson.id)}
          rest={fromNew === lesson.id && lesson.type !== 'sync' && (!bn || bn.running) ? REST_SEC : null}
          session={session}
          onNext={next ? () => open(next) : null}
          onAgain={() => (lesson.type === 'sync' ? open(lesson.id) : again())}
          onSlower={() => (lesson.type === 'sync' ? open(lesson.id) : playSlower(last.result.speed))}
          onHome={goHome}
          onResync={() => resync('home')}
          onLoop={lesson.type === 'sync' || lesson.type === 'improv' ? null : (from, to) => startLoop(loopSpecFor(lesson, last.result, from, to), 'results')}
        />
      </>
    )
  } else if (screen === 'today') {
    body = (
      <TodayScreen
        progress={progress}
        onStep={(i) => openStep(i, 'today')}
        onSwap={(i) => updateProgress(swapStep(progress, i, new Date()))}
        onSkip={(i) => updateProgress(skipStep(progress, i))}
        onPain={pain}
        onPressure={() => setPressure(true)}
        onExtra={extra}
        onBack={goHome}
      />
    )
  } else if (screen === 'skills') {
    // Skill games may add a little XP to the saved progress: read it again on the way back.
    const back = () => {
      const stored = loadProgress()
      const p = settle(stored)
      if (p !== stored) updateProgress(p)
      else setProgress(stored)
      setBlock(null)
      setSkillStart(undefined)
      showHome()
    }
    // A skill block of today's session: the round summary shows the block's clock and its next move.
    const bn = block !== null ? blockNext(block) : null
    const round: RoundSession | null =
      bn && bn.step.skill && bn.step.kind !== 'listenback'
        ? { text: progress.plan && planDone(progress.plan) ? 'Session done.' : blockLine(bn.step), running: bn.running, nextLabel: bn.nextLabel, onNext: () => moveOn(bn.i) }
        : null
    body = (
      <RoundSessionContext.Provider value={round}>
        <SkillsHome key={`skills-${skillKey}`} keyboard={keyboard} onConnect={onConnect} onBack={back} start={skillStart} />
      </RoundSessionContext.Provider>
    )
  } else if (screen === 'pocket-mental') {
    body = <MentalCard progress={progress} onBack={goHome} />
  } else if (screen === 'progress') {
    body = <ProgressScreen progress={progress} onBack={goHome} onOpen={open} focusHeading={progressFocus} />
  } else if (screen === 'weeks') {
    body = <PlanWeeks progress={progress} onBack={goHome} onOpen={open} />
  } else if (screen === 'achievements') {
    body = <AchievementsPanel progress={progress} onEquip={(c) => updateProgress({ ...progress, cosmetics: c })} onClose={goHome} />
  } else if (screen === 'settings') {
    body = (
      <SettingsPanel
        progress={progress}
        prefs={prefs}
        onProgress={updateProgress}
        onPrefs={updatePrefs}
        onResync={() => resync('settings')}
        onClose={goHome}
      />
    )
  } else {
    body = (
      <LessonMap
        progress={progress}
        onOpen={open}
        onAchievements={() => setScreen('achievements')}
        onSettings={() => setScreen('settings')}
        onRename={(name) => updateProgress({ ...progress, dinoName: name })}
        plan={progress.plan}
        onPlanStep={(i) => openStep(i, 'home')}
        onPlanSwap={(i) => updateProgress(swapStep(progress, i, new Date()))}
        onPlanSkip={(i) => updateProgress(skipStep(progress, i))}
        onPlanExtra={extra}
        songs={songs ?? []}
        onSong={onOpenSong}
        songParts={songParts ?? []}
        onToday={() => setScreen('today')}
        onHeat={() => setScreen('heat')}
        onSkills={() => {
          leaveBlock()
          setSkillStart(undefined)
          setSkillKey((k) => k + 1)
          setScreen('skills')
        }}
        onProgress={() => setScreen('progress')}
        onWeeks={() => setScreen('weeks')}
        onPocket={pocket}
        onPain={pain}
        onPressure={() => setPressure(true)}
        onSeenWeekly={() => updateProgress({ ...progress, seenWeekly: true })}
        notice={notice}
      />
    )
  }

  // After every render: this screen's actions are the ones the live coach may take.
  useEffect(() => {
    setCoachActions(() => coachActions)
  })
  // Leaving Lessons: the coach can't press its buttons from another tab.
  useEffect(() => () => setCoachActions(() => ({})), [])

  return (
    <div className={`lessons screen-${screen}`}>
      {staleEngine && (
        <p className="ls-banner" role="status">
          Audio engine changed: reload the page.
        </p>
      )}
      {body}
      {pressure && <BasicsSheet first={['pressure']} strum={false} startAt="pressure" onClose={() => setPressure(false)} />}
    </div>
  )
}

function Welcome({ onStart, onSignIn }: { onStart: (name: string) => void; onSignIn: (() => void) | null }) {
  const [name, setName] = useState('Pebble')
  return (
    <section className="ls-welcome">
      <div className="ls-welcome-dino">
        <Dino stage={0} mood="idle" size={180} />
      </div>
      <div className="ls-welcome-copy">
        <h1 className="ls-display">Meet your dino.</h1>
        <p>It grows as you pass lessons.</p>
        <form
          className="ls-name-form"
          onSubmit={(ev) => {
            ev.preventDefault()
            onStart(name.trim() || 'Pebble')
          }}
        >
          <label>
            Name it:
            <input value={name} maxLength={20} onChange={(ev) => setName(ev.target.value)} autoFocus />
          </label>
          <button type="submit" className="ls-btn primary">
            Start
          </button>
        </form>
        {onSignIn && (
          <p className="ls-muted">
            Played before?{' '}
            <button className="ls-link" onClick={onSignIn}>
              Sign in
            </button>
          </p>
        )}
      </div>
    </section>
  )
}
