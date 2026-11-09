// Today's session: a gig setlist taped to the amp. Card on the home screen, a full screen, and a strip on results.
import { useEffect, useState } from 'react'
import type { PainLevel, Progress, SessionPlan, SessionStep } from '../types'
import { lessonById } from '../data'
import { KIND_LABEL, SHAPE_LABEL, improvements, lastPain, nextStepIndex, planDone, planMinutes, stepScore, stepSource, swapOptions, todayDay } from '../session'
import { drillTitle } from '../heat'
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

/** Sharp pain flagged today: the session stops here (research: a hard rule). */
const pausedToday = (progress: Progress, now: Date) => todayDay(progress, now)?.pain === 'sharp'

function Paused() {
  return <p className="ls-set-quiet">Session paused for today. Rest your hand.</p>
}

function stepTitle(s: SessionStep): string {
  if (s.drill) return drillTitle(s.drill)
  if (s.lessonId) return title(s.lessonId)
  if (s.kind === 'mix') return `${s.items?.length ?? 0} lessons in turn`
  if (s.kind === 'listenback') return 'Your last jam take'
  if (s.skill?.game === 'changes') return s.skill.pair ? `One-minute changes: ${s.skill.pair}` : 'One-minute changes'
  if (s.skill?.game === 'find') return 'Fretboard notes'
  if (s.skill?.game === 'ear') return 'Call and response'
  return KIND_LABEL[s.kind]
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
        const sc = stepScore(progress, s)
        const src = stepSource(s)
        const said = sc && [sc.label === 'cold' ? `first try ${Math.round(sc.value)} percent` : `today's best ${Math.round(sc.value)} percent`, sc.ever !== null ? `best ever ${Math.round(sc.ever)} percent` : null]
        const label = [name, kind.toLowerCase(), src, s.state === 'todo' ? null : s.state, ...(said ?? []), s.why || null].filter(Boolean).join(', ')
        const pop = fresh.has(stepKey(plan, s, i))
        return (
          <li key={stepKey(plan, s, i)} className={`ls-set-row ${s.state} ${i === next ? 'next' : ''} ${pop ? 'pop' : ''}`}>
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
                  <button className="ls-btn ghost small" onClick={() => onSkip(i)} aria-label={s.state === 'todo' ? `Skip ${name}` : `Bring back ${name}`}>
                    {s.state === 'todo' ? 'Skip' : 'Bring back'}
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
  return (
    <header className="ls-set-head">
      <h2 className="ls-set-h">
        Session {plan.shape} · {plan.min} min: {plan.steps.some((s) => s.brake) ? 'Review first' : SHAPE_LABEL[plan.shape]}
      </h2>
      <span className="ls-set-total ls-num">about {planMinutes(plan)} min</span>
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

function SetDone({ progress, plan, max }: { progress: Progress; plan: SessionPlan; max?: number }) {
  const lines = improvements(progress, plan)
  const shown = max === undefined ? lines : lines.slice(0, max)
  return (
    <div className="ls-set-done" role="status">
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
}

/** The setlist card on the home screen. */
export function TodayCard({ progress, plan, onStep, onSwap, onSkip, onToday, onPain, onPressure }: PlanProps & { plan: SessionPlan; onToday: () => void }) {
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
        <SetDone progress={progress} plan={plan} max={3} />
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
            <button className="ls-btn primary" onClick={() => onStep(ni)} autoFocus>
              Play: {stepTitle(next)}
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
export function TodayScreen({ progress, onStep, onSwap, onSkip, onPain, onPressure, onBack }: PlanProps & { onBack: () => void }) {
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
              {plan.steps.some((s) => s.brake) ? 'Review on its own' : 'New material on its own'}, then mixed with the rest. A jam to finish. Swap or skip anything.
            </p>
            <SetRows progress={progress} plan={plan} fresh={fresh} onStep={onStep} onSwap={onSwap} onSkip={onSkip} paused={paused} />
            <ScoreKey progress={progress} plan={plan} />
            {done && <SetDone progress={progress} plan={plan} />}
            <TodayPain progress={progress} now={now} done={done} onPain={onPain} onPressure={onPressure} />
            {paused && !done && <Paused />}
            {next && !paused && (
              <div className="ls-set-foot">
                <button className="ls-btn primary" onClick={() => onStep(ni)} autoFocus>
                  Play: {stepTitle(next)}
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

/** One line above the result card when the run's lesson is in today's session. */
export function PlanStrip({ progress, lessonId, finished, onStep }: { progress: Progress; lessonId: string; finished: boolean; onStep: (i: number) => void }) {
  const plan = progress.plan
  if (!plan || !plan.steps.some((s) => (s.lessonId === lessonId && !s.drill) || s.items?.includes(lessonId))) return null
  const kept = plan.steps.filter((s) => s.state !== 'skipped')
  const doneN = kept.filter((s) => s.state === 'done').length
  const ni = nextStepIndex(plan)
  const next = pausedToday(progress, new Date()) ? undefined : plan.steps[ni]

  return (
    <div className="ls-set strip" role="status">
      {finished ? (
        <p>
          <b>Session done.</b>
        </p>
      ) : (
        <p>
          Today's session:{' '}
          <b className="ls-num">
            {doneN} of {kept.length}
          </b>{' '}
          done.
        </p>
      )}
      {next && (
        <button className="ls-btn ghost small" onClick={() => onStep(ni)}>
          Next: {stepTitle(next)}
        </button>
      )}
    </div>
  )
}
