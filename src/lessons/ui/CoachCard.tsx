// A note from Claude, the player's coach: when Lessons opens, and again when today's session is done.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ApplyOutcome, Lesson, LessonResult, Progress } from '../types'
import type { CoachMoment, CoachNote } from '../coach'
import { coachFacts, coachKey, fetchCoach, runFacts, runKey, savedCoach } from '../coach'
import { loadStats } from '../../skills/store'
import { useAccount } from '../../account/session'
import { getPracticeSnapshot, subscribePractice } from '../../practice/log'
import { practiceDaySec } from '../../practice/data'
import { useDailyGoal } from '../../practice/goal'
import { dayKey } from '../progress'
import { coachRunEnded, liveCoachOn } from '../liveCoach'
import { dismissWeekly, saveWeekly, savedWeekly, weeklyDue, weeklyFacts } from '../weekly'

const asked = new Set<string>() // keys already requested on this page load, so a re-render never asks twice
/** Each run's coach request on this page load, shared by every showing of its result card. */
const runAsked = new Map<string, Promise<CoachNote | { off: string } | null>>()

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new day or moment: show its saved note (or none) before asking for a new one
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

  return <CoachView note={note} busy={busy} off={off} wait="Looking at your practice…" />
}

/** The weekly review on the Lessons home: once at the start of a week, about the week before, until dismissed. */
export function WeeklyReview({ progress }: { progress: Progress }) {
  const [now] = useState(() => new Date())
  const [due, setDue] = useState(() => weeklyDue(progress, now))
  const [note, setNote] = useState(() => savedWeekly(now))
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState<string | null>(null)
  const { account } = useAccount()

  useEffect(() => {
    if (!due || savedWeekly(now) || asked.has('weekly')) return
    asked.add('weekly')
    let live = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the request starts here; the note arrives later
    setBusy(true)
    void fetchCoach(`weekly:${now.getTime()}`, weeklyFacts(progress, now, account?.name ?? null)).then((n) => {
      if (!live) return
      setBusy(false)
      if (n && 'off' in n) setOff(n.off)
      else if (n) {
        saveWeekly(now, n)
        setNote(n)
      }
    })
    return () => {
      live = false
    }
    // Once per page load: the facts are read when the week's review is first due.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due])

  if (!due || off) return null
  return (
    <div className="ls-weekly">
      <p className="ls-weekly-h">Your week in review</p>
      <CoachView note={note} busy={busy} off={null} wait="Looking back at last week…" className="weekly" />
      {note && (
        <button
          className="ls-btn small"
          onClick={() => {
            dismissWeekly(now)
            setDue(false)
          }}
        >
          Got it
        </button>
      )}
    </div>
  )
}

function CoachView({ note, busy, off, wait, className = '' }: { note: CoachNote | null; busy: boolean; off: string | null; wait: string; className?: string }) {
  if (off) return <p className={`ls-coach-off ls-muted ${className}`}>{off}</p>
  if (!note && !busy) return null
  return (
    <section className={`ls-coach-card ${className}`} aria-label="A note from Claude, your coach" aria-busy={busy}>
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
        <p className="ls-muted">{wait}</p>
      )}
    </section>
  )
}

/** The coach on the result card: one note per run, about that run. */
export function RunCoach({ lesson, result, outcome, block }: { lesson: Lesson; result: LessonResult; outcome: ApplyOutcome; block: { timeLeft: boolean; nextButton: string } | null }) {
  const key = runKey(result)
  const [note, setNote] = useState<CoachNote | null>(() => savedCoach(key))
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState<string | null>(null)
  const { account } = useAccount()

  useEffect(() => {
    const kept = savedCoach(key)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new run: show its saved note (or none) before asking for a new one
    setNote(kept)
    if (kept) return
    // One request per run, shared: a card shown again (or React mounting it twice) waits for the same answer
    // instead of staying on "Looking at your run…".
    let req = runAsked.get(key)
    if (!req) {
      const facts = runFacts(lesson, result, outcome, { name: account?.name ?? null, block })
      // The live coach is on: it says its note out loud, and the card shows the same words.
      req = liveCoachOn()
        ? coachRunEnded(facts).then((reply) => (reply ? { message: reply, next: '' } : null))
        : fetchCoach(key, facts)
      runAsked.set(key, req)
    }
    let live = true
    setBusy(true)
    void req.then((n) => {
      if (!live) return
      setBusy(false)
      if (n && 'off' in n) setOff(n.off)
      else if (n) setNote(n)
    })
    return () => {
      live = false
    }
    // One request per run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return <CoachView note={note} busy={busy} off={off} wait="Looking at your run…" className="in-result" />
}
