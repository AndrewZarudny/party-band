// A note from Claude, the player's coach: when Lessons opens, and again when today's session is done.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Progress } from '../types'
import type { CoachMoment, CoachNote } from '../coach'
import { coachFacts, coachKey, fetchCoach, savedCoach } from '../coach'
import { loadStats } from '../../skills/store'
import { useAccount } from '../../account/session'
import { getPracticeSnapshot, subscribePractice } from '../../practice/log'
import { practiceDaySec } from '../../practice/data'
import { useDailyGoal } from '../../practice/goal'
import { dayKey } from '../progress'

const asked = new Set<string>() // keys already requested on this page load, so a re-render never asks twice

export function CoachCard({ progress, moment }: { progress: Progress; moment: CoachMoment }) {
  const [now] = useState(() => new Date())
  const key = coachKey(progress, now, moment)
  const [note, setNote] = useState<CoachNote | null>(() => savedCoach(key))
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState<string | null>(null)
  const { account } = useAccount()
  const snap = useSyncExternalStore(subscribePractice, getPracticeSnapshot)
  const goal = useDailyGoal()

  useEffect(() => {
    const kept = savedCoach(key)
    setNote(kept)
    if (kept || asked.has(key)) return
    asked.add(key)
    let live = true
    setBusy(true)
    const facts = coachFacts(progress, loadStats(), now, moment, { name: account?.name ?? null, todaySec: practiceDaySec(snap, dayKey(now)), goalMin: goal })
    void fetchCoach(key, facts).then((n) => {
      if (!live) return
      setBusy(false)
      if (n && 'off' in n) setOff(n.off)
      else if (n) setNote(n)
    })
    return () => {
      live = false
    }
    // One request per day and moment: the facts are read when the key changes, not on every tick of the practice clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (off) return <p className="ls-coach-off ls-muted">{off}</p>
  if (!note && !busy) return null
  return (
    <section className="ls-coach-card" aria-label="A note from Claude, your coach" aria-busy={busy}>
      <p className="ls-coach-who">Claude · your coach</p>
      {note ? (
        <>
          <p className="ls-coach-msg">{note.message}</p>
          {note.next && (
            <p className="ls-coach-next">
              <b>Next:</b> {note.next}
            </p>
          )}
        </>
      ) : (
        <p className="ls-muted">Looking at your practice…</p>
      )}
    </section>
  )
}
