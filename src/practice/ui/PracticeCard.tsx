import './practice.css'
import { STREAK_SEC, fmtDay, fmtDuration, usePractice } from '../stats'

/** The account menu's practice block: today, this week, total, and this week's days as small bars. */
export function PracticeCard({ onOpen }: { onOpen: () => void }) {
  const p = usePractice()
  const top = Math.max(STREAK_SEC * 6, ...p.week7.map((d) => d.total))
  const todayKey = p.last30[p.last30.length - 1].key
  return (
    <section className="prac-card" aria-labelledby="prac-card-h">
      <h3 id="prac-card-h">Practice time</h3>
      <dl className="prac-figs">
        <div>
          <dt>Today</dt>
          <dd>{fmtDuration(p.today)}</dd>
        </div>
        <div>
          <dt>This week</dt>
          <dd>{fmtDuration(p.week)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{fmtDuration(p.total)}</dd>
        </div>
      </dl>
      <ol className="prac-week" aria-label="This week by day">
        {p.week7.map((d) => {
          const future = d.key > todayKey
          const name = d.date.toLocaleDateString(undefined, { weekday: 'short' })
          return (
            <li key={d.key} className={`${d.key === todayKey ? 'today' : ''}${future ? ' future' : ''}`}>
              <span className="prac-week-bar" aria-hidden="true">
                <i className={d.total >= STREAK_SEC ? 'met' : ''} style={{ height: `${Math.min(100, (d.total / top) * 100)}%` }} />
              </span>
              <span className="prac-week-day" aria-hidden="true">
                {name.slice(0, 1)}
              </span>
              <span className="prac-sr">{future ? `${name}: still to come` : `${fmtDay(d.date, true)}: ${fmtDuration(d.total)}`}</span>
            </li>
          )
        })}
      </ol>
      <button type="button" className="acct-link" onClick={onOpen}>
        See your practice
      </button>
    </section>
  )
}
