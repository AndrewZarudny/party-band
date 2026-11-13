// Today's session: a gig setlist taped to the amp. Card on the home screen, a full screen, and a strip on results.
// Each row is a block that runs until its minutes are played; once the session is done, extra blocks fill the day's goal.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PainLevel, Progress, SessionPlan, SessionStep } from '../types'
import { lessonById } from '../data'
import type { ExtraKind } from '../session'
import {
  KIND_LABEL,
  SHAPE_LABEL,
  blockLine,
  clockText,
  extraOptions,
  improvements,
  lastPain,
  nextStepIndex,
  planDone,
  planMinutes,
  planPlayedSec,
  stepScore,
  stepSec,
  stepSource,
  stepStarted,
  stepTitle,
  swapOptions,
  todayDay,
} from '../session'
import { getPracticeSnapshot, subscribePractice } from '../../practice/log'
import { practiceDaySec } from '../../practice/data'
import { reachedGoal, useDailyGoal, wholeMin } from '../../practice/goal'
import { loadStats } from '../../skills/store'
import { PickMark } from './LessonMap'
import { PainCheck, PainNote, WeekDots } from './SessionCards'

// Done rows seen on screen so far, so a row's pick pops only the first time it shows as done.
let seenDone: Set<string> | null = null
const stepKey = (plan: SessionPlan, s: SessionStep, i: number) => `${plan.day}:${i}:${s.drill ?? s.lessonId ?? s.kind}`
const doneKeys = (plan: SessionPlan) => plan.steps.flatMap((s, i) => (s.state === 'done' ? [stepKey(plan, s, i)] : []))

/** Done rows that weren't on screen as done before this mount (none on the very first mount). */
function useFreshDone(plan: SessionPlan | null): Set<string> {
  const [fresh] = useState(() => new Set(plan && seenDone ? doneKeys(plan).filter((k) => !seenDone?.has(k)) : []))
  useEffect(() => {
    if (!plan) return
    seenDone = new Set([...(seenDone ?? []), ...doneKeys(plan)])
  }, [plan])
  return fresh
}

const title = (id: string) => lessonById(id)?.title ?? id

/** Under this much of the day's goal left, the goal counts as reached: no extra block for a minute. */
const EXTRA_FROM_SEC = 90

/** Practice seconds in the plan's practice day (4 am to 4 am), live: the clock the blocks and the goal ring run on. */
function usePlanDaySec(day: string): number {
  const snap = useSyncExternalStore(subscribePractice, getPracticeSnapshot)
  return practiceDaySec(snap, day)
}

/** Sharp pain flagged today: the session stops here (research: a hard rule). */
const pausedToday = (progress: Progress, now: Date) => todayDay(progress, now)?.pain === 'sharp'

function Paused() {
  return <p className="ls-set-quiet">Session paused for today. Rest your hand.</p>
}

function SetRows({
  progress,
  plan,
  fresh,
  onStep,
  onSwap,
  onSkip,
  paused = false,
}: {
  progress: Progress
  plan: SessionPlan
  fresh: Set<string>
  paused?: boolean
  onStep: (i: number) => void
  onSwap: (i: number) => void
  onSkip: (i: number) => void
}) {
  const next = nextStepIndex(plan)
  return (
    <ol className="ls-set-list">
      {plan.steps.map((s, i) => {
        const name = stepTitle(s)
        const kind = KIND_LABEL[s.kind]
        const done = s.state === 'done'
        const started = stepStarted(s)
        const sc = stepScore(progress, s)
        const src = stepSource(s)
        const said = sc && [sc.label === 'cold' ? `first try ${Math.round(sc.value)} percent` : `today's best ${Math.round(sc.value)} percent`, sc.ever !== null ? `best ever ${Math.round(sc.ever)} percent` : null]
        const clock = started ? `${clockText(stepSec(s))} of ${s.min} minutes played` : null
        const label = [name, kind.toLowerCase(), src, s.state === 'todo' ? clock : s.state, ...(said ?? []), s.why || null].filter(Boolean).join(', ')
        const pop = fresh.has(stepKey(plan, s, i))
        return (
          <li key={stepKey(plan, s, i)} className={`ls-set-row ${s.state} ${i === next ? 'next' : ''} ${started ? 'started' : ''} ${pop ? 'pop' : ''}`}>
            <span className="ls-set-n ls-num" aria-hidden>
              {done && <PickMark className="ls-set-pick" />}
              <span>{i + 1}</span>
            </span>
            <div className="ls-set-main">
              <button className="ls-set-open" onClick={() => onStep(i)} aria-label={label}>
                <span className="ls-set-name">{name}</span>
                <span className="ls-set-src">{src ? `${kind} · ${src}` : kind}</span>
                {s.why && <span className="ls-set-why">{s.why}</span>}
                {s.kind === 'mix' && s.items && (
                  <span className="ls-set-why">
                    {s.items.map((id) => `${s.played?.includes(id) ? '✓ ' : ''}${title(id)}`).join(' · ')}
                  </span>
                )}
              </button>
              {s.state !== 'done' && !paused && (
                <span className="ls-set-acts">
                  {s.state === 'todo' && swapOptions(progress, i).length > 0 && (
                    <button className="ls-btn ghost small" onClick={() => onSwap(i)} aria-label={`Swap ${name}`}>
                      Swap
                    </button>
                  )}
                  <button
                    className="ls-btn ghost small"
                    onClick={() => onSkip(i)}
                    aria-label={started ? `Finish ${name} now` : s.state === 'todo' ? `Skip ${name}` : `Bring back ${name}`}
                  >
                    {started ? 'Done' : s.state === 'todo' ? 'Skip' : 'Bring back'}
                  </button>
                </span>
              )}
            </div>
            {sc ? (
              <span className="ls-set-min ls-set-score ls-num" aria-hidden title={sc.label === 'cold' ? 'Your first try today' : 'Your best run today'}>
                <span>
                  <span className="ls-set-score-k">{sc.label}</span> {Math.round(sc.value)}%
                </span>
                {sc.ever !== null && <span className="ls-set-ever">best {Math.round(sc.ever)}%</span>}
              </span>
            ) : started ? (
              <span className="ls-set-min ls-set-clock ls-num" aria-hidden>
                {clockText(stepSec(s))} / {s.min} min
              </span>
            ) : (
              <span className="ls-set-min ls-num">{s.min} min</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** What the row percentages mean, once some row shows one: only the labels on screen. */
function ScoreKey({ progress, plan }: { progress: Progress; plan: SessionPlan }) {
  const scores = plan.steps.map((s) => stepScore(progress, s)).filter((x) => x !== null)
  if (!scores.length) return null
  const parts = [
    scores.some((x) => x.label === 'cold') && 'Cold: your first try today.',
    scores.some((x) => x.label === 'today') && 'Today: your best run today.',
    scores.some((x) => x.ever !== null) && 'Best: your best ever.',
  ].filter(Boolean)
  return <p className="ls-set-key">{parts.join(' ')}</p>
}

function SetHead({ progress, plan, now }: { progress: Progress; plan: SessionPlan; now: Date }) {
  const played = planPlayedSec(plan)
  return (
    <header className="ls-set-head">
      <h2 className="ls-set-h">
        Session {plan.shape} · {plan.min} min: {plan.steps.some((s) => s.brake) ? 'Review first' : SHAPE_LABEL[plan.shape]}
      </h2>
      <span className="ls-set-total ls-num">{played >= 60 ? `${wholeMin(played)} of about ${planMinutes(plan)} min` : `about ${planMinutes(plan)} min`}</span>
      <WeekDots progress={progress} now={now} />
      <PainNote pain={lastPain(progress, now)} />
    </header>
  )
}

/** The pain check-in once the session counts (or is done), until answered or skipped. */
function TodayPain({ progress, now, done, onPain, onPressure }: { progress: Progress; now: Date; done: boolean; onPain: (p: PainLevel) => void; onPressure: () => void }) {
  const [skipped, setSkipped] = useState(false)
  const day = todayDay(progress, now)
  if (skipped || !(done || day?.counted)) return null
  return <PainCheck answer={day?.pain ?? null} onPain={(p) => (p ? onPain(p) : setSkipped(true))} onPressure={onPressure} />
}

/**
 * The session is done: what got better, the day's minutes against the goal, and, while the goal isn't reached,
 * one more block to keep going with (a jam first). Sharp pain today: no more blocks.
 */
function SetDone({ progress, plan, max, paused, onExtra }: { progress: Progress; plan: SessionPlan; max?: number; paused: boolean; onExtra: (kind: ExtraKind, leftSec: number) => void }) {
  const [now] = useState(() => new Date())
  const [stats] = useState(loadStats)
  const lines = improvements(progress, plan)
  const shown = max === undefined ? lines : lines.slice(0, max)
  const today = usePlanDaySec(plan.day)
  const goal = useDailyGoal()
  const left = goal * 60 - today
  const more = !paused && left >= EXTRA_FROM_SEC ? extraOptions(progress, now, { unratedTake: false, stats }, left) : []
  return (
    <div className="ls-set-done">
      <div role="status">
        <p className="ls-set-done-h">Session done.</p>
        {shown.length ? (
          <ul className="ls-set-better">
            {shown.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="ls-set-quiet">Same numbers as before. Showing up counts too.</p>
        )}
        <p className="ls-set-day ls-num">
          {reachedGoal(today, goal) || left < EXTRA_FROM_SEC ? `${wholeMin(today)} min played today: your daily goal is in.` : `${wholeMin(today)} of ${goal} min played today.`}
        </p>
      </div>
      {more.length > 0 && (
        <div className="ls-set-more">
          <p className="ls-set-quiet">
            About <span className="ls-num">{more[0].min}</span> more minutes reach your goal. Keep going with one of these, or stop here.
          </p>
          <div className="ls-set-more-acts">
            {more.map((o, i) => (
              <button key={o.kind} className={`ls-btn ${i === 0 ? 'primary' : 'ghost'}`} onClick={() => onExtra(o.kind, left)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface PlanProps {
  progress: Progress
  onStep: (i: number) => void
  onSwap: (i: number) => void
  onSkip: (i: number) => void
  onPain: (p: PainLevel) => void
  onPressure: () => void
  /** One more block after the session, toward the day's minutes. */
  onExtra: (kind: ExtraKind, leftSec: number) => void
}

/** The setlist card on the home screen. */
export function TodayCard({ progress, plan, onStep, onSwap, onSkip, onToday, onPain, onPressure, onExtra }: PlanProps & { plan: SessionPlan; onToday: () => void }) {
  const [now] = useState(() => new Date())
  const fresh = useFreshDone(plan)
  const done = planDone(plan)
  const ni = nextStepIndex(plan)
  const next = plan.steps[ni]
  const paused = pausedToday(progress, now)

  return (
    <section className="ls-set card" aria-label="Today's session">
      <SetHead progress={progress} plan={plan} now={now} />
      {done ? (
        <SetDone progress={progress} plan={plan} max={3} paused={paused} onExtra={onExtra} />
      ) : (
        <>
          <SetRows progress={progress} plan={plan} fresh={fresh} onStep={onStep} onSwap={onSwap} onSkip={onSkip} paused={paused} />
          <ScoreKey progress={progress} plan={plan} />
        </>
      )}
      <TodayPain progress={progress} now={now} done={done} onPain={onPain} onPressure={onPressure} />
      <div className="ls-set-foot">
        {!done &&
          (paused ? (
            <Paused />
          ) : next ? (
            <button className="ls-btn primary" onClick={() => onStep(ni)} autoFocus data-pedal="go">
              {stepStarted(next) ? 'Keep going' : 'Play'}: {stepTitle(next)}
            </button>
          ) : (
            <p className="ls-set-quiet">Bring a step back to finish the session.</p>
          ))}
        <button className="ls-link" onClick={onToday}>
          Open the session
        </button>
      </div>
    </section>
  )
}

/** The whole session on its own screen, with every improvement and the why line on each row. */
export function TodayScreen({ progress, onStep, onSwap, onSkip, onPain, onPressure, onExtra, onBack }: PlanProps & { onBack: () => void }) {
  const [now] = useState(() => new Date())
  const plan = progress.plan
  const fresh = useFreshDone(plan)

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const done = plan ? planDone(plan) : false
  const ni = plan ? nextStepIndex(plan) : -1
  const next = plan?.steps[ni]
  const paused = pausedToday(progress, now)

  return (
    <div className="ls-today">
      <button className="ls-back" onClick={onBack} aria-label="Back to the map">
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" />
        </svg>
        Back
      </button>
      <section className="ls-set full" aria-label="Today's session">
        {plan && plan.steps.length ? (
          <>
            <SetHead progress={progress} plan={plan} now={now} />
            <p className="ls-set-intro">
              Cold starts first, before any warm-up of that piece.{' '}
              {plan.steps.some((s) => s.brake) ? 'Review on its own' : 'New material on its own'}, then mixed with the rest. A jam to finish. Each block runs
              for its minutes: play it again until the time is up, or move on when you've had enough. Swap or skip anything.
            </p>
            <SetRows progress={progress} plan={plan} fresh={fresh} onStep={onStep} onSwap={onSwap} onSkip={onSkip} paused={paused} />
            <ScoreKey progress={progress} plan={plan} />
            {done && <SetDone progress={progress} plan={plan} paused={paused} onExtra={onExtra} />}
            <TodayPain progress={progress} now={now} done={done} onPain={onPain} onPressure={onPressure} />
            {paused && !done && <Paused />}
            {next && !paused && (
              <div className="ls-set-foot">
                <button className="ls-btn primary" onClick={() => onStep(ni)} autoFocus data-pedal="go">
                  {stepStarted(next) ? 'Keep going' : 'Play'}: {stepTitle(next)}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="ls-set-quiet">Nothing planned for today yet.</p>
        )}
      </section>
    </div>
  )
}

/** Above the result card when the run belongs to a block of today's session: the block's clock, and where the session stands. */
export function PlanStrip({ progress, step }: { progress: Progress; step: number }) {
  const plan = progress.plan
  const s = plan?.steps[step]
  if (!plan || !s) return null
  const kept = plan.steps.filter((x) => x.state !== 'skipped')
  const doneN = kept.filter((x) => x.state === 'done').length
  const share = s.state === 'todo' ? Math.min(1, stepSec(s) / Math.max(1, s.min * 60)) : 1

  return (
    <div className="ls-set strip" role="status">
      {planDone(plan) ? (
        <p>
          <b>Session done.</b>
        </p>
      ) : (
        <p>
          <span className="ls-num">{blockLine(s)}</span>{' '}
          {s.state !== 'todo' && (
            <span className="ls-set-strip-n ls-num">
              {doneN} of {kept.length} blocks played.
            </span>
          )}
        </p>
      )}
      <div className="ls-set-meter" aria-hidden>
        <span style={{ transform: `scaleX(${share})` }} />
      </div>
    </div>
  )
}
