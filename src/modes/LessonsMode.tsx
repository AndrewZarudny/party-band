import { useCallback, useEffect, useState } from 'react'
import '../lessons/lessons.css'
import { engine } from '../audio/engine'
import type { ApplyOutcome, Cosmetic, Lesson, LessonResult, LoopSpec, LoopSummary, PainLevel, Prefs, Progress, SyncOutcome, TabLevel } from '../lessons/types'
import type { SkillStart } from '../skills/data'
import { buildChart } from '../lessons/charts'
import { loopSpecFor, recordLoop } from '../lessons/loop'
import { recordHeat } from '../lessons/heat'
import { drillSpec } from '../lessons/drill'
import { lessonById, stageOf, validateLessons } from '../lessons/data'
import { applyResult, dayKey, dinoStageFor, isPassed, isUnlocked, loadProgress, nextLesson, recordSkip, saveProgress } from '../lessons/progress'
import { bpmAt, pickFor, slowerSpeed, speedFor } from '../lessons/speed'
import { REST_SEC, markPocket, planAfterLoop, planAfterRun, planAfterSkill, setPain, skipStep, swapStep, withSessionDay, withTodayPlan } from '../lessons/session'
import { coldRun, coldSpeedFor, isCold } from '../lessons/review'
import { isJam, tabLevelFor } from '../lessons/listen'
import { openAccountDialog, useAccount } from '../account/session'
import { loadPrefs, savePrefs } from '../lessons/prefs'
import { syncResult } from '../lessons/scoring'
import { engineHasLessons } from '../lessons/input'
import { connectSource, onMicInput } from '../lessons/source'
import { getPracticeSnapshot } from '../practice/log'
import { practiceDaySec } from '../practice/data'
import { hasUnratedTake } from '../skills/takes'
import { loadStats, onSkillRound } from '../skills/store'
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
import { PlanWeeks } from '../lessons/ui/PlanWeeks'
import { BasicsSheet } from '../lessons/ui/teach/BasicsSheet'
import { LoopScreen } from '../lessons/ui/LoopScreen'
import { HeatScreen } from '../lessons/ui/HeatScreen'
import { Dino } from '../lessons/ui/Dino'
import { SkillsHome } from '../skills/ui/SkillsHome'

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

/** How the next run plays: a cold-start test, listen mode, shuffle mode, how much tab, a one-run speed. */
interface RunMode {
  cold: boolean
  quiet: boolean
  shuffle: boolean
  tab: TabLevel
  speed: number | null // a one-run speed (cold start); null = Auto or the manual pick
}
const PLAIN: RunMode = { cold: false, quiet: false, shuffle: false, tab: 'full', speed: null }

const SYNC_ID = 'w1-01'
const WEEK_NOTE = 'Week goal met. Anything more is a bonus.'

function hasSavedProgress() {
  try {
    return localStorage.getItem('lessons-progress') !== null
  } catch {
    return false
  }
}

/** After an extra: the next open unpassed extra of its stage, else the plan's next lesson. After anything else: the plan's next lesson. */
function nextAfter(p: Progress, id: string): string | null {
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

export function LessonsMode({ onConnect }: { onConnect: () => void }) {
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [screen, setScreen] = useState<Screen>(() => (hasSavedProgress() ? 'home' : 'welcome'))
  const [lessonId, setLessonId] = useState<string | null>(null)
  const [syncLesson, setSyncLesson] = useState(false)
  const [syncBack, setSyncBack] = useState<Screen>('home')
  const [runKey, setRunKey] = useState(0)
  const [listen, setListen] = useState(false)
  const [mode, setMode] = useState<RunMode>(PLAIN)
  const [fromNew, setFromNew] = useState<string | null>(null) // lesson opened from a 'new' step: rest between runs
  const [last, setLast] = useState<{ result: LessonResult; outcome: ApplyOutcome; finishedSet: boolean } | null>(null)
  const [loop, setLoop] = useState<{ spec: LoopSpec; back: Screen } | null>(null)
  const [skillStart, setSkillStart] = useState<SkillStart | undefined>(undefined)
  const [unrated, setUnrated] = useState<boolean | null>(null) // null until the take check is back
  const [notice, setNotice] = useState<string | null>(null)
  const [pressure, setPressure] = useState(false)
  const [staleEngine] = useState(() => import.meta.env.DEV && !engineHasLessons())

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

  const goHome = useCallback(() => {
    setScreen('home')
    setLast(null)
  }, [])

  // Today's session plan (made once per practice day) and today's session day, when the home or plan screen shows.
  useEffect(() => {
    if ((screen !== 'home' && screen !== 'today') || unrated === null) return
    const now = new Date()
    let p = progress
    let changed = false
    const made = withTodayPlan(p, now, { unratedTake: unrated, stats: loadStats() })
    if (made) {
      p = made
      changed = true
    }
    const sd = withSessionDay(p, now, practiceSecToday())
    if (sd.changed) {
      p = sd.progress
      changed = true
      if (sd.weekMet) setNotice(WEEK_NOTE)
    }
    if (changed) updateProgress(p)
  }, [screen, progress, unrated, updateProgress])

  // Skill rounds tick the plan's skill steps and count toward today's session.
  useEffect(() => {
    if (screen !== 'skills') return
    return onSkillRound((e) => {
      const now = new Date()
      // The skill game may have saved some XP: start from the stored copy.
      const ticked = planAfterSkill(loadProgress(), e, now)
      const sd = withSessionDay(ticked.progress, now, practiceSecToday())
      if (sd.weekMet) setNotice(WEEK_NOTE)
      updateProgress(sd.progress)
    })
  }, [screen, updateProgress])

  const open = (id: string, o: { fromNew?: boolean } = {}) => {
    const l = lessonById(id)
    if (!l) return
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
    startRun({ cold: false, quiet, shuffle: !!o?.shuffle, tab, speed: null })
  }

  // Again from the result card: the same choices, but never cold again and back on Auto speed.
  const again = () => startRun({ ...mode, cold: false, speed: null })

  // "Listen first": the same play screen, demo playback with no judging.
  const playDemo = () => {
    setMode(PLAIN)
    setListen(true)
    setRunKey((k) => k + 1)
    setScreen('play')
  }

  // The speed the current lesson's next run plays at (a cold start's speed, Auto, or this lesson's manual pick).
  const runSpeed = lesson ? (mode.speed ?? speedFor(lesson, progress.lessons[lesson.id], prefs)) : 1

  const playSlower = (from: number) => {
    if (!lesson) return
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
    const planned = planAfterRun(outcome.progress, l.id, r, now)
    const sd = withSessionDay(planned.progress, now, practiceSecToday())
    if (sd.weekMet) setNotice(WEEK_NOTE)
    updateProgress(sd.progress)
    setLast({ result: r, outcome: { ...outcome, progress: sd.progress }, finishedSet: planned.finished })
    setScreen('results')
  }

  const resync = (back: Screen) => {
    setSyncLesson(false)
    setSyncBack(back)
    setScreen('sync')
  }

  const startLoop = (spec: LoopSpec, back: Screen) => {
    setLoop({ spec, back })
    setRunKey((k) => k + 1)
    setScreen('loop')
  }

  const openDrill = (key: string, back: Screen) => {
    const spec = drillSpec(progress, key, new Date(), progress.plan?.steps.find((s) => s.drill === key)?.lessonId ?? undefined)
    if (spec) startLoop(spec, back)
  }

  // A loop never gives XP or stars: it records heat, the loop count and (drills) today's drill step.
  const endLoop = (s: LoopSummary | null, next: 'full' | 'back') => {
    const cur = loop
    setLoop(null)
    if (!cur) return goHome()
    const now = new Date()
    if (s && s.results.length) {
      let p = recordHeat(progress, cur.spec.lesson, s.chart, s.results, { sourceId: cur.spec.sourceId, calibrated: s.calibrated, now, loop: true })
      p = recordLoop(p, cur.spec.sourceId, s, now)
      if (cur.spec.drillKey && s.clean > 0) p = planAfterLoop(p, cur.spec.drillKey, s, now).progress
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
    setScreen(cur.back)
  }

  const openSkill = (s: SkillStart) => {
    if (s.game === 'mental') return setScreen('pocket-mental')
    setSkillStart(s)
    setScreen('skills')
  }

  // A step of today's plan: cold steps go through the Cold start card, jams play in listen mode, skills open their game.
  const openStep = (i: number, back: Screen) => {
    const step = progress.plan?.steps[i]
    if (!step) return
    if (step.drill) return openDrill(step.drill, back)
    if (step.kind === 'mix') {
      const id = step.items?.find((x) => !step.played?.includes(x)) ?? step.items?.[0]
      if (id) open(id)
      return
    }
    if (!step.lessonId) {
      if (step.skill) openSkill(step.skill)
      return
    }
    const id = step.lessonId
    const l = lessonById(id)
    if (!l) return
    if (step.kind === 'cold' && isCold(progress, id, new Date())) {
      setLessonId(id)
      setFromNew(null)
      setScreen('cold')
      return
    }
    if (step.kind === 'jam' && l.type === 'improv') {
      setLessonId(id)
      setFromNew(null)
      startRun({ cold: false, quiet: true, shuffle: false, tab: 'hidden', speed: null })
      return
    }
    open(id, { fromNew: step.kind === 'new' })
  }

  const pocket = (s: SkillStart) => {
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
        bpm={bpmAt(lesson, speed)}
        onStart={() => startRun({ cold: true, quiet: false, shuffle: false, tab: 'hidden', speed })}
        onBack={() => setScreen('today')}
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
        onPrefs={updatePrefs}
        onEnd={(r) => finish(lesson, r)}
        onQuit={() => setScreen(mode.cold ? 'today' : 'intro')}
        onSlower={() => playSlower(runSpeed)}
        onConnect={onConnect}
      />
    )
  } else if (screen === 'loop' && loop) {
    body = <LoopScreen key={`loop-${runKey}`} spec={loop.spec} prefs={prefs} stage={stage} cosmetics={cosmetics} onExit={endLoop} onConnect={onConnect} />
  } else if (screen === 'heat') {
    body = <HeatScreen progress={progress} onDrill={(key) => openDrill(key, 'heat')} onBack={goHome} />
  } else if (screen === 'results' && lesson && last) {
    const next = nextAfter(last.outcome.progress, lesson.id)
    body = (
      <>
        <PlanStrip progress={last.outcome.progress} lessonId={lesson.id} finished={last.finishedSet} onStep={(i) => openStep(i, 'results')} />
        <ResultCard
          lesson={lesson}
          result={last.result}
          outcome={last.outcome}
          pick={pickFor(prefs, lesson.id)}
          rest={fromNew === lesson.id && lesson.type !== 'sync' ? REST_SEC : null}
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
        onBack={goHome}
      />
    )
  } else if (screen === 'skills') {
    // Skill games may add a little XP to the saved progress: read it again on the way back.
    const back = () => {
      setProgress(loadProgress())
      setSkillStart(undefined)
      goHome()
    }
    body = <SkillsHome keyboard={keyboard} onConnect={onConnect} onBack={back} start={skillStart} />
  } else if (screen === 'pocket-mental') {
    body = <MentalCard progress={progress} onBack={goHome} />
  } else if (screen === 'progress') {
    body = <ProgressScreen progress={progress} onBack={goHome} onOpen={open} />
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
        onToday={() => setScreen('today')}
        onHeat={() => setScreen('heat')}
        onSkills={() => {
          setSkillStart(undefined)
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
