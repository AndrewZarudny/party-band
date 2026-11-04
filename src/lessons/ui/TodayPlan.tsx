// Today's set: a gig setlist taped to the amp. Card on the home screen, a full screen, and a strip on results.
import { useEffect, useState } from 'react'
import type { DayPlan, PlanStep, Progress } from '../types'
import { lessonById } from '../data'
import { KIND_LABEL, PLAN_BONUS, improvements, nextStepIndex, planDone, planMinutes, planStreakNow, swapOptions } from '../plan'
import { FootGlyph, PickMark } from './LessonMap'

// Done rows seen on screen so far, so a row's pick pops only the first time it shows as done.
let seenDone: Set<string> | null = null
const doneKeys = (plan: DayPlan) => plan.steps.filter((s) => s.state === 'done').map((s) => `${plan.day}:${s.lessonId}`)

/** Done rows that weren't on screen as done before this mount (none on the very first mount). */
function useFreshDone(plan: DayPlan | null): Set<string> {
  const [fresh] = useState(() => new Set(plan && seenDone ? doneKeys(plan).filter((k) => !seenDone?.has(k)) : []))
  useEffect(() => {
    if (!plan) return
    seenDone = new Set([...(seenDone ?? []), ...doneKeys(plan)])
  }, [plan])
  return fresh
}

const stepTitle = (s: PlanStep) => lessonById(s.lessonId)?.title ?? s.lessonId

function SetRows({
  progress,
  plan,
  fresh,
  onOpen,
  onSwap,
  onSkip,
}: {
  progress: Progress
  plan: DayPlan
  fresh: Set<string>
  onOpen: (id: string) => void
  onSwap: (i: number) => void
  onSkip: (i: number) => void
}) {
  const next = nextStepIndex(plan)
  return (
    <ol className="ls-set-list">
      {plan.steps.map((s, i) => {
        const title = stepTitle(s)
        const kind = KIND_LABEL[s.kind]
        const done = s.state === 'done'
        const score = done && s.score !== undefined ? `${Math.round(s.score)}%` : null
        const label = [title, kind.toLowerCase(), s.state === 'todo' ? null : s.state, score].filter(Boolean).join(', ')
        const pop = fresh.has(`${plan.day}:${s.lessonId}`)
        return (
          <li key={`${s.kind}-${s.lessonId}`} className={`ls-set-row ${s.state} ${i === next ? 'next' : ''} ${pop ? 'pop' : ''}`}>
            <span className="ls-set-n ls-num" aria-hidden>
              {done && <PickMark className="ls-set-pick" />}
              <span>{i + 1}</span>
            </span>
            <div className="ls-set-main">
              <button className="ls-set-open" onClick={() => onOpen(s.lessonId)} aria-label={label}>
                <span className="ls-set-name">{title}</span>
                <span className="ls-set-why">
                  {kind} · {s.why}
                </span>
              </button>
              {s.state !== 'done' && (
                <span className="ls-set-acts">
                  {s.state === 'todo' && swapOptions(progress, i).length > 0 && (
                    <button className="ls-btn ghost small" onClick={() => onSwap(i)} aria-label={`Swap ${title}`}>
                      Swap
                    </button>
                  )}
                  <button className="ls-btn ghost small" onClick={() => onSkip(i)} aria-label={s.state === 'todo' ? `Skip ${title}` : `Bring back ${title}`}>
                    {s.state === 'todo' ? 'Skip' : 'Bring back'}
                  </button>
                </span>
              )}
            </div>
            <span className="ls-set-min ls-num">{score ?? `${s.min} min`}</span>
          </li>
        )
      })}
    </ol>
  )
}

function SetHead({ plan, streak }: { plan: DayPlan; streak: number }) {
  return (
    <header className="ls-set-head">
      <h2 className="ls-set-h">Today's set</h2>
      <span className="ls-set-total ls-num">about {planMinutes(plan)} min</span>
      {streak >= 2 && (
        <p className="ls-set-streak">
          <FootGlyph /> <b className="ls-num">{streak}</b> days in a row
        </p>
      )}
    </header>
  )
}

function SetDone({ progress, plan, streak, max }: { progress: Progress; plan: DayPlan; streak: number; max?: number }) {
  const lines = improvements(progress, plan)
  const shown = max === undefined ? lines : lines.slice(0, max)
  return (
    <div className="ls-set-done" role="status">
      <p className="ls-set-done-h">
        Set done.{plan.bonus && <b className="ls-num"> +{PLAN_BONUS} XP</b>}
      </p>
      {shown.length ? (
        <ul className="ls-set-better">
          {shown.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : (
        <p className="ls-set-quiet">Same scores as before. Consistency counts too.</p>
      )}
      {streak >= 2 && (
        <p className="ls-set-streak">
          <FootGlyph /> <b className="ls-num">{streak}</b> days in a row
        </p>
      )}
    </div>
  )
}

/** The setlist card on the home screen. */
export function TodayCard({
  progress,
  plan,
  onOpen,
  onSwap,
  onSkip,
  onToday,
}: {
  progress: Progress
  plan: DayPlan
  onOpen: (id: string) => void
  onSwap: (i: number) => void
  onSkip: (i: number) => void
  onToday: () => void
}) {
  const [now] = useState(() => new Date())
  const fresh = useFreshDone(plan)
  const streak = planStreakNow(progress, now)
  const done = planDone(plan)
  const next = plan.steps[nextStepIndex(plan)]

  if (done) {
    return (
      <section className="ls-set card" aria-label="Today's set">
        <SetHead plan={plan} streak={0} />
        <SetDone progress={progress} plan={plan} streak={streak} max={3} />
        <div className="ls-set-foot">
          <button className="ls-link" onClick={onToday}>
            Open the set
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="ls-set card" aria-label="Today's set">
      <SetHead plan={plan} streak={streak} />
      <SetRows progress={progress} plan={plan} fresh={fresh} onOpen={onOpen} onSwap={onSwap} onSkip={onSkip} />
      <div className="ls-set-foot">
        {next ? (
          <button className="ls-btn primary" onClick={() => onOpen(next.lessonId)} autoFocus>
            Play: {stepTitle(next)}
          </button>
        ) : (
          <p className="ls-set-quiet">Bring a step back to finish the set.</p>
        )}
        <button className="ls-link" onClick={onToday}>
          Open the set
        </button>
      </div>
    </section>
  )
}

/** The whole set on its own screen, with every improvement and the why line on each row. */
export function TodayScreen({
  progress,
  onOpen,
  onSwap,
  onSkip,
  onBack,
}: {
  progress: Progress
  onOpen: (id: string) => void
  onSwap: (i: number) => void
  onSkip: (i: number) => void
  onBack: () => void
}) {
  const [now] = useState(() => new Date())
  const plan = progress.plan
  const fresh = useFreshDone(plan)
  const streak = planStreakNow(progress, now)

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const done = plan ? planDone(plan) : false
  const next = plan ? plan.steps[nextStepIndex(plan)] : undefined

  return (
    <div className="ls-today">
      <button className="ls-back" onClick={onBack} aria-label="Back to the map">
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" />
        </svg>
        Back
      </button>
      <section className="ls-set full" aria-label="Today's set">
        {plan && plan.steps.length ? (
          <>
            <SetHead plan={plan} streak={done ? 0 : streak} />
            <p className="ls-set-intro">A warm-up, what's due for review, one new lesson, then a jam. Swap or skip anything.</p>
            <SetRows progress={progress} plan={plan} fresh={fresh} onOpen={onOpen} onSwap={onSwap} onSkip={onSkip} />
            {done && <SetDone progress={progress} plan={plan} streak={streak} />}
            {next && (
              <div className="ls-set-foot">
                <button className="ls-btn primary" onClick={() => onOpen(next.lessonId)} autoFocus>
                  Play: {stepTitle(next)}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="ls-set-quiet">Nothing set for today yet.</p>
        )}
      </section>
    </div>
  )
}

/** One line above the result card when the run's lesson is in today's set. */
export function PlanStrip({ progress, lessonId, finished, onOpen }: { progress: Progress; lessonId: string; finished: boolean; onOpen: (id: string) => void }) {
  const [now] = useState(() => new Date())
  const plan = progress.plan
  if (!plan || !plan.steps.some((s) => s.lessonId === lessonId)) return null
  const streak = planStreakNow(progress, now)
  const kept = plan.steps.filter((s) => s.state !== 'skipped')
  const doneN = kept.filter((s) => s.state === 'done').length
  const next = plan.steps[nextStepIndex(plan)]

  return (
    <div className="ls-set strip" role="status">
      {finished ? (
        <p>
          <b>Set done.</b> <b className="ls-num">+{PLAN_BONUS} XP.</b>
          {streak >= 2 && <> {streak} days in a row.</>}
        </p>
      ) : (
        <p>
          Today's set:{' '}
          <b className="ls-num">
            {doneN} of {kept.length}
          </b>{' '}
          done.
        </p>
      )}
      {next && (
        <button className="ls-btn ghost small" onClick={() => onOpen(next.lessonId)}>
          Next: {stepTitle(next)}
        </button>
      )}
    </div>
  )
}
