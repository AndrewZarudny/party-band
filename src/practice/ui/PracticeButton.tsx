import type { Ref } from 'react'
import './practice.css'
import { reachedGoal, ringDash, useDailyGoal, wholeMin } from '../goal'
import { fmtDuration, usePractice } from '../stats'

/** Today against the daily goal as a small ring. Full and gold once the goal is reached. */
export function GoalRing({ sec, min, size = 16 }: { sec: number; min: number; size?: number }) {
  const met = reachedGoal(sec, min)
  // A sliver shows as soon as anything counted, so the first minute isn't an empty ring.
  const pct = ringDash(sec, min)
  return (
    <svg className={`prac-ring${met ? ' met' : ''}`} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <circle className="prac-ring-track" cx="8" cy="8" r="6.25" />
      {pct > 0 && <circle className="prac-ring-fill" cx="8" cy="8" r="6.25" pathLength={100} strokeDasharray={`${pct} 100`} transform="rotate(-90 8 8)" />}
    </svg>
  )
}

/** The top bar's practice button: today's minutes against the goal. Opens the account menu. */
export function PracticeButton({ open, onClick, ref }: { open: boolean; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  const today = usePractice().today
  const goal = useDailyGoal()
  const met = reachedGoal(today, goal)
  const label = met ? `Practice today ${fmtDuration(today)}, daily goal met` : `Practice today ${wholeMin(today)} of ${goal} minutes`
  return (
    <button
      ref={ref}
      className={`prac-btn${met ? ' met' : ''}`}
      title={met ? 'Daily goal met' : `Practice today, goal ${goal} min`}
      aria-label={label}
      aria-expanded={open}
      aria-controls="acct-menu"
      onClick={onClick}
    >
      <GoalRing sec={today} min={goal} />
      <span className="prac-btn-text">
        {met ? (
          fmtDuration(today)
        ) : (
          <>
            {wholeMin(today)} / {goal}
            <span className="prac-unit"> min</span>
          </>
        )}
      </span>
    </button>
  )
}
