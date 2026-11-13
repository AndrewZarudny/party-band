// Record yourself: a take of your guitar sound (with the band if you like), played back here. The last five stay in this browser.
import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import type { Take } from '../takes'
import { KEEP, addTake, deleteTake, listTakes, rateTake, saveNote } from '../takes'
import type { TakeSource } from '../recorder'
import { BACKINGS, MAX_SEC, TakeRecorder, canRecord, takeSource } from '../recorder'
import { finishRound } from '../store'
import { useRoundActivity, useTick } from '../hooks'
import { GameHead, Timer } from './Common'

const fmtWhen = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

const SOURCE_NOTE: Record<TakeSource, string | null> = {
  none: 'No guitar connected: the take will have no guitar in it, only the band (or silence).',
  mic: 'Recording the microphone as it is, without the amp sound.',
  dry: 'The amp is off: the take records your dry guitar signal.',
  amp: null,
}

/** Stops a recorder and keeps what it caught: saved, counted, and given XP. Safe after the screen is gone. */
async function finishTake(r: TakeRecorder): Promise<{ saved: boolean; xp: number } | null> {
  const out = await r.stop()
  if (!out) return null
  const take: Take = { id: Date.now().toString(36), at: Date.now(), blob: out.blob, sec: out.sec, band: r.backing?.label ?? null, note: '' }
  let saved = true
  try {
    await addTake(take)
  } catch {
    saved = false
  }
  const g = finishRound('record', Math.round(out.sec))
  return { saved, xp: g.xp }
}

export function RecordTakes({ keyboard, onBack, band }: { keyboard: boolean; onBack: () => void; band?: string }) {
  const [takes, setTakes] = useState<Take[]>([])
  const [backing, setBacking] = useState<string>(() => (band && BACKINGS.some((b) => b.id === band) ? band : 'none'))
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [xpNote, setXpNote] = useState<string | null>(null)
  const rec = useRef<TakeRecorder | null>(null)

  useRoundActivity(recording)
  useTick(recording, 250)

  useEffect(() => {
    let live = true
    void listTakes().then((t) => live && setTakes(t))
    return () => {
      live = false
      // Leaving while recording keeps the take, as Stop would.
      const r = rec.current
      rec.current = null
      if (r) void finishTake(r)
    }
  }, [])

  const start = async () => {
    setError(null)
    setXpNote(null)
    setBusy(true)
    try {
      const r = new TakeRecorder()
      await r.start(BACKINGS.find((b) => b.id === backing) ?? null, keyboard)
      rec.current = r
      setRecording(true)
    } catch {
      setError('Recording did not start. Check that this browser allows audio recording.')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    const r = rec.current
    rec.current = null
    setRecording(false)
    if (!r) return
    setBusy(true)
    const res = await finishTake(r)
    if (res) {
      if (!res.saved) setError('Could not save the take in this browser.')
      setXpNote(res.xp ? `+${res.xp} XP` : '')
      setTakes(await listTakes())
    }
    setBusy(false)
  }

  // eslint-disable-next-line react-hooks/refs -- recording length from the recorder; useTick re-renders while recording
  const secs = rec.current?.seconds ?? 0
  // The longest take: stop on its own.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- stop at the longest take length (checked on each useTick render)
    if (recording && secs >= MAX_SEC) void stop()
  })

  if (!canRecord()) {
    return (
      <section className="sk-game" aria-labelledby="sk-game-h">
        <GameHead title="Record yourself" sub="This browser can't record audio." onBack={onBack} />
      </section>
    )
  }

  const sourceNote = SOURCE_NOTE[takeSource(keyboard)]

  return (
    <section className="sk-game" aria-labelledby="sk-game-h">
      <GameHead
        title="Record yourself"
        sub={`Record a take, listen back, write a note. The last ${KEEP} stay in this browser.`}
        onBack={onBack}
        // eslint-disable-next-line react-hooks/refs -- secs comes from the recorder ref; useTick re-renders while recording
        right={recording ? <Timer left={MAX_SEC - secs} total={MAX_SEC} /> : undefined}
      />
      <div className="sk-pick-row">
        <label className="ls-field sk-field">
          <span className="ls-field-label">Band</span>
          <select className="ls-select" value={backing} disabled={recording} onChange={(ev) => setBacking(ev.target.value)}>
            <option value="none">No band, just me</option>
            {BACKINGS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="sk-actions">
        {!recording ? (
          <button className="ls-btn primary big" onClick={() => void start()} disabled={busy} autoFocus>
            <RecDot /> Record
          </button>
        ) : (
          <button className="ls-btn primary big" onClick={() => void stop()}>
            {/* eslint-disable-next-line react-hooks/refs -- secs comes from the recorder ref; useTick re-renders while recording */}
            Stop <span className="ls-num">{fmtSec(secs)}</span>
          </button>
        )}
      </div>
      {error && (
        <p className="ls-warn" role="alert">
          {error}
        </p>
      )}
      {xpNote !== null && <p className="ls-muted">Saved.{xpNote ? ` ${xpNote}` : ''}</p>}
      {recording && <p className="ls-caption">Leaving this screen stops and keeps the take.</p>}
      {sourceNote && <p className={takeSource(keyboard) === 'none' ? 'ls-warn' : 'ls-caption'}>{sourceNote}</p>}
      <ul className="sk-takes">
        {takes.map((t) => (
          <TakeRow
            key={t.id}
            take={t}
            onDelete={async () => {
              await deleteTake(t.id).catch(() => {})
              setTakes(await listTakes())
            }}
          />
        ))}
      </ul>
      {!takes.length && <p className="ls-muted">No takes yet. Two minutes of jamming is plenty.</p>}
    </section>
  )
}

function RecDot() {
  return (
    <svg className="sk-rec-dot" viewBox="0 0 12 12" aria-hidden>
      <circle cx="6" cy="6" r="5" />
    </svg>
  )
}

// Chrome's recordings have no length in the file: seek to the end once so the player learns it and can scrub.
function fixDuration(ev: SyntheticEvent<HTMLAudioElement>) {
  const a = ev.currentTarget
  if (a.duration !== Infinity) return
  const back = () => {
    if (a.duration === Infinity) return
    a.removeEventListener('durationchange', back)
    a.currentTime = 0
  }
  a.addEventListener('durationchange', back)
  a.currentTime = 1e101
}

function TakeRow({ take, onDelete }: { take: Take; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [note, setNote] = useState(take.note)
  const [rating, setRating] = useState(take.rating)
  const rate = (n: number) => {
    setRating(n)
    void rateTake(take.id, n).catch(() => {})
    finishRound('rate', n, take.id)
  }
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    const u = URL.createObjectURL(take.blob)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an object URL for the take, revoked on cleanup
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [take.blob])
  return (
    <li className="sk-take">
      <div className="sk-take-head">
        <b>{fmtWhen(take.at)}</b>
        <span className="ls-muted ls-num">
          {fmtSec(take.sec)} · {take.band ?? 'guitar only'}
        </span>
      </div>
      {url && <audio controls src={url} preload="metadata" onLoadedMetadata={fixDuration} aria-label={`Take, ${fmtSec(take.sec)} long`} />}
      <div className="sk-take-foot" style={{ flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label="How did it sound? 1 to 5">
        <span className="ls-muted">How did it sound? 1–5</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`ls-btn small ${rating === n ? 'primary' : 'ghost'}`} aria-pressed={rating === n} onClick={() => rate(n)}>
            {n}
          </button>
        ))}
      </div>
      <div className="sk-take-foot">
        <input
          className="sk-note"
          value={note}
          maxLength={140}
          placeholder="A note: what to fix next time"
          aria-label="Note for this take"
          onChange={(ev) => setNote(ev.target.value)}
          onBlur={() => void saveNote(take.id, note.trim()).catch(() => {})}
        />
        {!confirm && (
          <button className="ls-btn ghost small" onClick={() => setConfirm(true)}>
            Delete
          </button>
        )}
      </div>
      {confirm && (
        <div className="sk-take-confirm" role="group" aria-label="Delete this take?">
          <span>Delete this take and its note for good?</span>
          <button className="ls-btn small" onClick={onDelete}>
            Delete
          </button>
          <button className="ls-btn ghost small" onClick={() => setConfirm(false)} autoFocus>
            Keep
          </button>
        </div>
      )}
    </li>
  )
}
