import { useCallback, useEffect, useState } from 'react'
import '../lessons/lessons.css'
import { engine } from '../audio/engine'
import type { ApplyOutcome, Cosmetic, Lesson, LessonResult, Prefs, Progress, Speed, SyncOutcome } from '../lessons/types'
import { WORLDS, lessonById, validateLessons } from '../lessons/data'
import { applyResult, dinoStageFor, isUnlocked, loadProgress, nextLesson, recordSkip, saveProgress } from '../lessons/progress'
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
import { Dino } from '../lessons/ui/Dino'

type Screen = 'welcome' | 'home' | 'intro' | 'sync' | 'play' | 'results' | 'achievements' | 'settings'

const SYNC_ID = 'w1-01'

function hasSavedProgress() {
  try {
    return localStorage.getItem('lessons-progress') !== null
  } catch {
    return false
  }
}

function slower(s: Speed): Speed {
  return s === 1 ? 0.85 : 0.7
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
  const [last, setLast] = useState<{ result: LessonResult; outcome: ApplyOutcome } | null>(null)
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

  const open = (id: string) => {
    const l = lessonById(id)
    if (!l) return
    setLessonId(id)
    updatePrefs({ ...prefs, lastLesson: id })
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

  const playSlower = () => {
    updatePrefs({ ...prefs, speed: slower(prefs.speed) })
    play()
  }

  const finish = (l: Lesson, r: LessonResult) => {
    const outcome = applyResult(progress, l, r, new Date(), { age: prefs.age })
    updateProgress(outcome.progress)
    setLast({ result: r, outcome })
    setScreen('results')
  }

  const resync = (back: Screen) => {
    setSyncLesson(false)
    setSyncBack(back)
    setScreen('sync')
  }

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
  } else if (screen === 'play' && lesson) {
    body = (
      <PlayScreen
        key={`${lesson.id}-${runKey}`}
        lesson={lesson}
        listen={listen}
        prefs={prefs}
        stage={stage}
        cosmetics={cosmetics}
        onPrefs={updatePrefs}
        onEnd={(r) => finish(lesson, r)}
        onQuit={() => setScreen('intro')}
        onSlower={playSlower}
        onConnect={onConnect}
      />
    )
  } else if (screen === 'results' && lesson && last) {
    const next = nextAfter(last.outcome.progress, lesson.id)
    body = (
      <ResultCard
        lesson={lesson}
        result={last.result}
        outcome={last.outcome}
        onNext={next ? () => open(next) : null}
        onAgain={() => (lesson.type === 'sync' ? open(lesson.id) : play())}
        onSlower={() => (lesson.type === 'sync' ? open(lesson.id) : playSlower())}
        onHome={goHome}
        onResync={() => resync('home')}
      />
    )
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
