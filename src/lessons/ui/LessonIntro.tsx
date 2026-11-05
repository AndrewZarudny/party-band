import { useEffect, useMemo, useRef, useState } from 'react'
import { engine } from '../../audio/engine'
import { useEngineState } from '../../audio/hooks'
import { applyTone } from '../../audio/presets'
import { presetByName } from '../../audio/tone'
import { Fretboard } from '../../components/Fretboard'
import type { Marker } from '../../components/Fretboard'
import { boxNotes } from '../../music/phrase'
import { noteName, pc } from '../../music/theory'
import type { Lesson, Prefs, Progress, Speed } from '../types'
import { buildChart } from '../charts'
import { fingeringFor } from '../fingering'
import { scalePcsOf } from '../improv'
import { KEYBOARD_DEVICE, deviceKey, loadLatency, micWarning } from '../calibration'
import { clicksMuted } from '../clock'
import { DINO_STAGES, dinoStageFor } from '../progress'
import { connectSource } from '../source'
import { MANUAL_SPEEDS, autoSpeed, pct, pickFor, speedCap, speedLimits } from '../speed'
import { Dino } from './Dino'
import { InputPicker } from './InputPicker'
import { StarGlyph, StarPips } from './LessonMap'
import { LessonOverview } from './teach/LessonOverview'
import { TeachPanel } from './teach/TeachPanel'
import { useWatch } from './teach/useWatch'
import type { WatchSpeed } from './teach/useWatch'

/** Improv lessons: the box on the fretboard, home notes marked. */
function BoxPreview({ lesson }: { lesson: Lesson }) {
  if (lesson.type !== 'improv' || !lesson.improv) return null
  const spec = lesson.improv
  const markers: Marker[] = boxNotes(scalePcsOf(spec), [], spec.boxFret).map((p) => ({
    string: p.string,
    fret: p.fret,
    kind: pc(p.midi) === spec.key ? 'root' : 'box',
  }))
  return (
    <div className="ls-preview board">
      <Fretboard markers={markers} maxFret={Math.min(22, spec.boxFret + 8)} highlightFrom={spec.boxFret} highlightTo={spec.boxFret + 3} />
      <p className="ls-caption">The red dots are {noteName(spec.key)}, home. Every dot fits.</p>
    </div>
  )
}

const WATCH_SPEEDS: { v: WatchSpeed; label: string }[] = [
  { v: 0.5, label: '50%' },
  { v: 0.75, label: '75%' },
  { v: 1, label: '100%' },
]

function Seg<T extends string | number>({ value, options, onPick, label }: { value: T; options: { v: T; label: string }[]; onPick: (v: T) => void; label: string }) {
  return (
    <div className="ls-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={o.v === value} className={o.v === value ? 'on' : ''} onClick={() => onPick(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Switch({ on, set, label, note }: { on: boolean; set: (v: boolean) => void; label: string; note?: string }) {
  return (
    <button className={`ls-switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => set(!on)}>
      <span className="ls-switch-track" aria-hidden>
        <span />
      </span>
      <span>
        {label}
        {note && <small>{note}</small>}
      </span>
    </button>
  )
}

export function LessonIntro({
  lesson,
  progress,
  prefs,
  onPrefs,
  onStart,
  onListen,
  onSync,
  onBack,
  onConnect,
}: {
  lesson: Lesson
  progress: Progress
  prefs: Prefs
  onPrefs: (p: Prefs) => void
  onStart: () => void
  onListen: () => void
  onSync: () => void
  onBack: () => void
  onConnect: () => void
}) {
  const e = useEngineState()
  const [toneSet, setToneSet] = useState(false)
  const [, bump] = useState(0)
  const startRef = useRef<HTMLButtonElement>(null)

  // Speed trainer: Auto unless the player picked a speed for this lesson.
  const rec = progress.lessons[lesson.id]
  const auto = autoSpeed(lesson, rec)
  const lim = speedLimits(lesson)
  const autoHint =
    lesson.type === 'improv'
      ? `Jams play at full speed. Auto slows the band only under ${lim.down}%, and goes back up after a pass.`
      : `Auto goes up after a ${lim.up}% run and down under ${lim.down}%.`
  const pick = pickFor(prefs, lesson.id)
  const speed = pick ?? auto
  const speedOptions: { v: 'auto' | Speed; label: string }[] = [
    { v: 'auto', label: `Auto (${pct(auto)})` },
    ...MANUAL_SPEEDS.filter((s) => s <= speedCap(rec)).map((s) => ({ v: s, label: pct(s) })),
  ]

  // The whole chart and its fingering: the demos, the overview and Watch all use these.
  const chart = useMemo(() => {
    try {
      return lesson.type === 'sync' ? null : buildChart(lesson)
    } catch {
      return null
    }
  }, [lesson])
  const fingering = useMemo(() => {
    try {
      return chart ? fingeringFor(lesson, chart) : null
    } catch {
      return null
    }
  }, [lesson, chart])
  const watch = useWatch(lesson, chart, prefs)
  const { from: watchFrom, beatNow: watchBeat, bpm: watchBpm, stop: stopWatch } = watch
  const follow = useMemo(() => (watchFrom !== null ? { beatNow: watchBeat, bpm: watchBpm } : null), [watchFrom, watchBeat, watchBpm])
  const leave = (go: () => void) => () => {
    stopWatch()
    go()
  }

  useEffect(() => {
    startRef.current?.focus()
  }, [])

  // Esc goes back (a dialog on top handles its own Esc).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (t && t.closest('input, select, textarea, [role="dialog"]')) return
      if (ev.key === 'Escape') {
        stopWatch()
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, stopWatch])

  const keyboardMode = prefs.keyboard || !e.running
  const calibrated = !!loadLatency(keyboardMode ? KEYBOARD_DEVICE : deviceKey())
  // The picker already asks mic users for headphones.
  const mic = e.running && prefs.input === 'cable' ? micWarning() : null
  const connect = () => {
    connectSource(prefs.input, prefs.micId).catch(() => onConnect())
  }
  const muted = clicksMuted()
  const stage = dinoStageFor(progress)

  return (
    <div className="ls-intro">
      <button className="ls-back" onClick={leave(onBack)} aria-label="Back to the map">
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" />
        </svg>
        Back
      </button>

      <header className="ls-intro-head">
        <div className="ls-intro-title">
          <p className="ls-intro-where ls-num">
            {lesson.boss ? `World ${lesson.world} boss` : `World ${lesson.world}, lesson ${lesson.order}`}
          </p>
          <h2 className="ls-display">{lesson.title}</h2>
          <p className="ls-goal">{lesson.goal}</p>
          {rec && rec.plays > 0 && (
            <p className="ls-best">
              <StarPips stars={rec.stars} /> <span className="ls-num">{rec.best}%</span> · best chain <span className="ls-num">{rec.bestChain}</span>
            </p>
          )}
        </div>
        <div className="ls-intro-dino">
          {lesson.tips[0] && <p className="ls-bubble">{lesson.tips[0]}</p>}
          <Dino stage={stage} mood="idle" size={110} cosmetics={progress.cosmetics} />
          <span className="ls-sr">{DINO_STAGES[stage]?.name}</span>
        </div>
      </header>

      <BoxPreview lesson={lesson} />

      {chart && fingering && <TeachPanel lesson={lesson} chart={chart} fingering={fingering} prefs={prefs} onPrefs={onPrefs} follow={follow} />}

      {chart && fingering && (
        <section className="tc-ov-box" aria-labelledby="tc-ov-title">
          <div className="tc-ov-top">
            <h3 id="tc-ov-title" className="tc-ov-title">
              The whole lesson
            </h3>
            <div className="tc-ov-ctl">
              <button className={`ls-btn small ${watchFrom !== null ? 'on' : ''}`} onClick={() => (watchFrom !== null ? stopWatch() : watch.start(0))}>
                <svg className="tc-glyph" viewBox="0 0 12 12" aria-hidden>
                  {watchFrom !== null ? <rect x={2} y={2} width={8} height={8} rx={1.5} /> : <path d="M3 1.8 10.2 6 3 10.2Z" />}
                </svg>
                {watchFrom !== null ? 'Stop' : 'Watch'}
              </button>
              <Seg label="Watch speed" value={watch.speed} options={WATCH_SPEEDS} onPick={watch.setSpeed} />
              <button className="ls-link tc-ov-runway" onClick={leave(onListen)}>
                or watch it on the runway
              </button>
            </div>
          </div>
          <p className="tc-ov-hint">Tap a bar to watch from there.</p>
          <LessonOverview
            lesson={lesson}
            chart={chart}
            fingering={fingering}
            beatNow={watchBeat}
            countIn={watch.countIn}
            parkBar={watchFrom}
            onBar={watch.start}
          />
        </section>
      )}

      {lesson.tips.length > 1 && (
        <ul className="ls-tips">
          {lesson.tips.slice(1).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      <div className="ls-intro-grid">
        <div className="ls-controls">
          <div className="ls-field">
            <span className="ls-field-label">Speed</span>
            <Seg
              label="Speed"
              value={pick ?? 'auto'}
              options={speedOptions}
              onPick={(v) => onPrefs({ ...prefs, speedPick: v === 'auto' ? null : { lessonId: lesson.id, speed: v } })}
            />
            {pick === null && <small className="ls-muted">{autoHint}</small>}
            {speed < 1 && (
              <small className="ls-muted">
                Practice speed: 75% XP, up to 2 <StarGlyph />
                <span className="ls-sr">stars</span>. Pass at 100% for all 3.
              </small>
            )}
          </div>
          <Switch on={prefs.easyTiming} set={(v) => onPrefs({ ...prefs, easyTiming: v })} label="Easy timing" note="wider windows, 80% XP" />
          {lesson.backing && (
            <Switch on={prefs.backingOn} set={(v) => onPrefs({ ...prefs, backingOn: v })} label="Band" note={prefs.input === 'mic' ? 'Use headphones' : 'Off: click only'} />
          )}
          <div className="ls-tone">
            <span>
              Suggested tone: <b>{lesson.tone}</b>
            </span>
            <button
              className="ls-btn small"
              disabled={toneSet}
              onClick={() => {
                void applyTone({ id: 'builtin:' + lesson.tone, name: lesson.tone, settings: presetByName(lesson.tone) }).then(() => setToneSet(true))
              }}
            >
              {toneSet ? 'In use' : 'Use it'}
            </button>
          </div>
        </div>

        <div className="ls-start">
          <InputPicker prefs={prefs} onPrefs={onPrefs} />
          {mic && <p className="ls-warn">{mic}</p>}
          {muted && (
            <p className="ls-warn">
              Your metronome volume is off.{' '}
              <button
                className="ls-link"
                onClick={() => {
                  engine.setMetronomeLevel(1)
                  bump((n) => n + 1)
                }}
              >
                Turn it on
              </button>
            </p>
          )}
          {!calibrated && (
            <p className="ls-note">
              New setup: sync first (20 s){' '}
              <button className="ls-btn small" onClick={onSync}>
                Sync
              </button>
            </p>
          )}
          {e.running ? (
            <button ref={startRef} className="ls-btn primary big" onClick={leave(onStart)}>
              Start
            </button>
          ) : (
            <div className="ls-connect">
              <button ref={startRef} className="ls-btn primary big" onClick={connect}>
                {prefs.input === 'mic' ? 'Connect microphone' : 'Connect guitar'}
              </button>
              <button className="ls-btn" onClick={leave(onStart)}>
                Try with the keyboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
