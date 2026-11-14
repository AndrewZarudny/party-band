// After today's session: how did it feel? One tap, and a line for the coach if you like. The next plan follows it.
import { useState } from 'react'
import type { Feel } from '../checkin'
import { saveCheckIn, todayCheckIn } from '../checkin'
import { dayKey } from '../progress'

const FEELS: [Feel, string][] = [
  ['easy', 'Too easy'],
  ['right', 'About right'],
  ['hard', 'Too hard'],
]
const AFTER: Record<Feel, string> = {
  easy: 'Next session adds something new.',
  right: 'Next session carries on the same way.',
  hard: 'Next session skips new material and goes over what you know.',
}

export function CheckInCard() {
  const [now] = useState(() => new Date())
  const [saved, setSaved] = useState(() => todayCheckIn(now))
  const [feel, setFeel] = useState<Feel | null>(null)
  const [note, setNote] = useState('')
  if (saved)
    return (
      <p className="sc-quiet-note">
        Thanks. {AFTER[saved.feel]}
        {saved.note ? ' Your coach will read your note.' : ''}
      </p>
    )
  return (
    <section className="ls-then-now ls-checkin" aria-label="How was today">
      <p className="ls-weekly-h">How was today?</p>
      <div className="ls-then-row" role="radiogroup" aria-label="How today felt">
        {FEELS.map(([f, label]) => (
          <button key={f} role="radio" aria-checked={feel === f} className={`ls-btn small ${feel === f ? 'primary' : ''}`} onClick={() => setFeel(f)}>
            {label}
          </button>
        ))}
      </div>
      <div className="ls-then-row">
        <input className="ls-text ls-checkin-note" value={note} maxLength={200} placeholder="Anything for your coach? (optional)" onChange={(ev) => setNote(ev.target.value)} />
        <button
          className="ls-btn small primary"
          disabled={!feel}
          onClick={() => {
            if (!feel) return
            const c = { day: dayKey(now), feel, note: note.trim() }
            saveCheckIn(c)
            setSaved(c)
          }}
        >
          Save
        </button>
      </div>
    </section>
  )
}
