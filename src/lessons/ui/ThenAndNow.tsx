// "Then and now" on the Lessons home: once a month, record the same short piece; from the second month, hear the
// first take next to the latest. Progress on guitar is slow day to day; heard across months it is plain.
import { useEffect, useRef, useState } from 'react'
import type { Progress } from '../types'
import { lessonById, madeLessons } from '../data'
import { loadGoal } from '../goal'
import { isPassed } from '../progress'
import { useEngineState } from '../../audio/hooks'
import { TakeRecorder } from '../../skills/recorder'
import type { Milestone } from '../../skills/milestones'
import { addMilestone, listMilestones, loadPiece, milestoneDue, monthKey, savePiece, thenAndNow } from '../../skills/milestones'

const monthName = (key: string) => new Date(`${key}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

/**
 * Pieces to choose from: the goal song's parts first (passed or not: a goal part shows the most change), then
 * passed lessons and song parts with notes to play, most recently played first.
 */
function pieces(p: Progress): { id: string; title: string }[] {
  const goal = loadGoal()
  const goalParts = goal
    ? madeLessons()
        .filter((l) => l.id.startsWith(`song:${goal.songId}:`))
        .map((l) => ({ id: l.id, title: l.title }))
    : []
  const rest = Object.entries(p.lessons)
    .filter(([id]) => isPassed(p, id))
    .map(([id, r]) => ({ id, l: lessonById(id), last: r.lastPlayed }))
    .filter((x) => x.l && x.l.type !== 'sync' && x.l.type !== 'improv')
    .sort((a, b) => b.last - a.last)
    .map((x) => ({ id: x.id, title: x.l!.title }))
  return [...goalParts, ...rest.filter((x) => !goalParts.some((g) => g.id === x.id))].slice(0, 12)
}

function play(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const a = new Audio(url)
    const done = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
    a.onended = done
    a.onerror = done
    void a.play().catch(done)
  })
}

export function ThenAndNow({ progress }: { progress: Progress }) {
  const e = useEngineState()
  const [ms, setMs] = useState<Milestone[] | null>(null)
  const [piece, setPiece] = useState(loadPiece)
  const [choice, setChoice] = useState('')
  const [hidden, setHidden] = useState(false)
  const [sec, setSec] = useState<number | null>(null) // recording: seconds so far
  const [playing, setPlaying] = useState<string | null>(null)
  const rec = useRef<TakeRecorder | null>(null)

  useEffect(() => {
    let live = true
    void listMilestones().then((m) => live && setMs(m))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (sec === null) return
    const t = window.setInterval(() => setSec((s) => (s === null ? s : s + 1)), 1000)
    return () => window.clearInterval(t)
  }, [sec === null]) // eslint-disable-line react-hooks/exhaustive-deps -- one interval per recording

  if (ms === null || hidden) return null
  const now = new Date()
  const title = piece ? (lessonById(piece)?.title ?? 'your piece') : ''
  const due = milestoneDue(ms, piece, now)
  const pair = thenAndNow(ms, piece)
  const options = pieces(progress)

  const start = async () => {
    const r = new TakeRecorder()
    rec.current = r
    await r.start(null, false)
    setSec(0)
  }
  const stop = async () => {
    const r = rec.current
    rec.current = null
    setSec(null)
    const got = r ? await r.stop() : null
    if (!got || !piece) return
    await addMilestone({ id: `m-${Date.now()}`, month: monthKey(new Date()), at: Date.now(), pieceId: piece, pieceTitle: title, blob: got.blob, sec: got.sec })
    setMs(await listMilestones())
  }
  const listen = async (which: 'then' | 'now' | 'both') => {
    if (!pair) return
    setPlaying(which)
    if (which !== 'now') await play(pair.then.blob)
    if (which !== 'then') await play(pair.now.blob)
    setPlaying(null)
  }

  // Nothing to show this month: the take is in and there's no second month to compare yet.
  if (piece && !due && !pair) return null

  return (
    <section className="ls-then-now" aria-label="Then and now">
      <p className="ls-weekly-h">Then &amp; now</p>
      {!piece ? (
        <>
          <p>Once a month, record the same short piece. In a few months you'll hear how far you've come.</p>
          {options.length ? (
            <div className="ls-then-row">
              <select value={choice || options[0].id} onChange={(ev) => setChoice(ev.target.value)} aria-label="Piece to record each month">
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
              <button
                className="ls-btn small primary"
                onClick={() => {
                  const id = choice || options[0].id
                  savePiece(id)
                  setPiece(id)
                }}
              >
                Use this piece
              </button>
              <button className="ls-btn small ghost" onClick={() => setHidden(true)}>
                Not now
              </button>
            </div>
          ) : (
            <p className="ls-muted">Pass a lesson first: then pick one to record each month.</p>
          )}
        </>
      ) : (
        <>
          {due && (
            <div className="ls-then-row">
              <span>
                This month's take of <b>{title}</b>:
              </span>
              {sec === null ? (
                <button className="ls-btn small primary" onClick={() => void start()} disabled={!e.running} title={e.running ? undefined : 'Connect your guitar first'}>
                  ● Record
                </button>
              ) : (
                <button className="ls-btn small primary ls-rec-on" onClick={() => void stop()}>
                  ■ Stop and keep · {sec} s
                </button>
              )}
              {!e.running && <span className="ls-muted">Connect your guitar first.</span>}
            </div>
          )}
          {pair && (
            <div className="ls-then-row">
              <span>
                <b>{title}</b>: {monthName(pair.then.month)} and {monthName(pair.now.month)}
              </span>
              <button className="ls-btn small" disabled={!!playing} onClick={() => void listen('then')}>
                ▶ Then
              </button>
              <button className="ls-btn small" disabled={!!playing} onClick={() => void listen('now')}>
                ▶ Now
              </button>
              <button className="ls-btn small primary" disabled={!!playing} onClick={() => void listen('both')}>
                {playing === 'both' ? 'Playing…' : '▶ Both, back to back'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
