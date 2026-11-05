import { useCallback, useEffect, useState } from 'react'
import '../lessons/lessons.css'
import { engine } from '../audio/engine'
import type { ApplyOutcome, Cosmetic, Lesson, LessonResult, LoopSpec, LoopSummary, Prefs, Progress, SyncOutcome } from '../lessons/types'
import { buildChart } from '../lessons/charts'
import { loopSpecFor, recordLoop } from '../lessons/loop'
import { recordHeat } from '../lessons/heat'
import { drillSpec } from '../lessons/drill'
import { WORLDS, lessonById, validateLessons } from '../lessons/data'
import { applyResult, dinoStageFor, isUnlocked, levelFor, loadProgress, nextLesson, recordSkip, saveProgress } from '../lessons/progress'
import { pickFor, slowerSpeed, speedFor } from '../lessons/speed'
import { planAfterLoop, planAfterRun, skipStep, swapStep, withTodayPlan } from '../lessons/plan'
import { openAccountDialog, useAccount } from '../account/session'
import { loadPrefs, savePrefs } from '../lessons/prefs'
import { syncResult } from '../lessons/scoring'
import { engineHasLessons } from '../lessons/input'
import { connectSource, onMicInput } from '../lessons/source'
import { LessonMap } from '../lessons/ui/LessonMap'
import { LessonIntro } from '../lessons/ui/LessonIntro'
import { ResultCard } from '../lessons/ui/ResultCard'
import { SyncUp } from '../lessons/ui/SyncUp'
import { SettingsPanel } from '../lessons/ui/SettingsPanel'
import { AchievementsPanel } from '../lessons/ui/AchievementsPanel'
import { PlayScreen } from '../lessons/ui/PlayScreen'
import { PlanStrip, TodayScreen } from '../lessons/ui/TodayPlan'
import { LoopScreen } from '../lessons/ui/LoopScreen'
import { HeatScreen } from '../lessons/ui/HeatScreen'
import { Dino } from '../lessons/ui/Dino'
import { SkillsHome } from '../skills/ui/SkillsHome'

type Screen = 'welcome' | 'home' | 'today' | 'intro' | 'sync' | 'play' | 'results' | 'achievements' | 'settings' | 'loop' | 'heat' | 'skills'

const SYNC_ID = 'w1-01'

function hasSavedProgress() {
  try {
    return localStorage.getItem('lessons-progress') !== null
  } catch {
    return false
  }
}

/** The lesson after `id` in world order that is open now, or the first open unpassed one. */
function nextAfter(p: Progress, id: string): string | null {
  const order = WORLDS.flatMap((w) => w.lessons)
  const i = order.indexOf(id)
  for (let j = i + 1; j < order.length; j++) {
    if (isUnlocked(p, order[j])) return order[j]
  }
  const n = nextLesson(p)
  return n && n !== id ? n : null
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
  const [last, setLast] = useState<{ result: LessonResult; outcome: ApplyOutcome; finishedSet: boolean } | null>(null)
  const [loop, setLoop] = useState<{ spec: LoopSpec; back: Screen } | null>(null)
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
    const was = engine.ampOn
    engine.setAmpOn(false)
    return () => {
      if (!engine.running || !onMicInput()) {
        engine.setAmpOn(was)
        return
      }
      connectSource('cable', null)
        .then(() => engine.setAmpOn(was))
        .catch(() => {
          /* no interface: stay on the mic with the amp off rather than feed back */
        })
    }
  }, [prefs.input])

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

  // Today's set: made once per practice day, when the home or set screen shows.
  useEffect(() => {
    if (screen !== 'home' && screen !== 'today') return
    const p = withTodayPlan(progress, new Date())
    if (p) updateProgress(p)
  }, [screen, progress, updateProgress])

  const open = (id: string) => {
    const l = lessonById(id)
    if (!l) return
    setLessonId(id)
    // A manual speed belongs to one lesson.
    updatePrefs({ ...prefs, lastLesson: id, speedPick: prefs.speedPick?.lessonId === id ? prefs.speedPick : null })
    if (l.type === 'sync') {
      setSyncLesson(true)
      setSyncBack('home')
      setScreen('sync')
    } else setScreen('intro')
  }

  const play = () => {
    setListen(false)
    setRunKey((k) => k + 1)
    setScreen('play')
  }

  // "Listen first": the same play screen, demo playback with no judging.
  const playDemo = () => {
    setListen(true)
    setRunKey((k) => k + 1)
    setScreen('play')
  }

  // The speed the current lesson's next run plays at (Auto, or this lesson's manual pick).
  const runSpeed = lesson ? speedFor(lesson, progress.lessons[lesson.id], prefs) : 1

  const playSlower = (from: number) => {
    if (!lesson) return
    updatePrefs({ ...prefs, speedPick: { lessonId: lesson.id, speed: slowerSpeed(from) } })
    play()
  }

  const finish = (l: Lesson, r: LessonResult) => {
    const now = new Date()
    // Mistake heat from this run's judged events (not sync or improv runs).
    const heated = r.results && (l.type === 'notes' || l.type === 'chords' || l.type === 'rhythm') ? recordHeat(progress, l, buildChart(l), r.results, { sourceId: l.id, calibrated: r.calibrated === true, now }) : progress
    const outcome = applyResult(heated, l, r, now, { age: prefs.age })
    const planned = planAfterRun(outcome.progress, l.id, r, now)
    updateProgress(planned.progress)
    // Fold the set bonus into the card's XP lines, total and level.
    let shown: ApplyOutcome = { ...outcome, progress: planned.progress }
    if (planned.bonus > 0) {
      const xp = outcome.xp + planned.bonus
      const lines = outcome.lines.filter((x) => x.label !== 'Total')
      lines.push({ label: "Today's set", value: `+${planned.bonus}` }, { label: 'Total', value: `+${xp}` })
      shown = { ...shown, xp, lines, levelAfter: levelFor(planned.progress.xp).level }
    }
    setLast({ result: r, outcome: shown, finishedSet: planned.finished })
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
    const spec = drillSpec(progress, key, new Date(), progress.plan?.steps.find((s) => s.drill === key)?.lessonId)
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
      p = recordLoop(p, cur.spec.sourceId, s)
      if (cur.spec.drillKey && s.clean > 0) p = planAfterLoop(p, cur.spec.drillKey, s, now).progress
      updateProgress(p)
    }
    if (next === 'full' && cur.spec.kind === 'bars') {
      setLessonId(cur.spec.sourceId)
      setLast(null)
      setListen(false)
      setRunKey((k) => k + 1)
      setScreen('play')
      return
    }
    if (cur.back === 'results' && !last) return goHome()
    setScreen(cur.back)
  }

  const onSyncDone =(o: SyncOutcome | null, skipped: boolean) => {
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
        onPrefs={updatePrefs}
        onEnd={(r) => finish(lesson, r)}
        onQuit={() => setScreen('intro')}
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
        <PlanStrip progress={last.outcome.progress} lessonId={lesson.id} finished={last.finishedSet} onOpen={open} onDrill={(key) => openDrill(key, 'results')} />
        <ResultCard
          lesson={lesson}
          result={last.result}
          outcome={last.outcome}
          pick={pickFor(prefs, lesson.id)}
          onNext={next ? () => open(next) : null}
          onAgain={() => (lesson.type === 'sync' ? open(lesson.id) : play())}
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
        onOpen={open}
        onDrill={(key) => openDrill(key, 'today')}
        onSwap={(i) => updateProgress(swapStep(progress, i, new Date()))}
        onSkip={(i) => updateProgress(skipStep(progress, i))}
        onBack={goHome}
      />
    )
  } else if (screen === 'skills') {
    // Skill games may add a little XP to the saved progress: read it again on the way back.
    const back = () => {
      setProgress(loadProgress())
      goHome()
    }
    body = <SkillsHome keyboard={keyboard} onConnect={onConnect} onBack={back} />
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
        onPlanSwap={(i) => updateProgress(swapStep(progress, i, new Date()))}
        onPlanSkip={(i) => updateProgress(skipStep(progress, i))}
        onToday={() => setScreen('today')}
        onDrill={(key) => openDrill(key, 'home')}
        onHeat={() => setScreen('heat')}
        onSkills={() => setScreen('skills')}
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
