// Record yourself: a take of your guitar sound (with the band if you like), played back here. The last five stay in this browser.
import { useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/engine'
import type { Take } from '../takes'
import { KEEP, addTake, deleteTake, listTakes, saveNote } from '../takes'
import { BACKINGS, MAX_SEC, TakeRecorder, canRecord } from '../recorder'
import { finishRound } from '../store'
import { useRoundActivity, useTick } from '../hooks'
import { GameHead, Timer } from './Common'

const fmtWhen = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

export function RecordTakes({ keyboard, onBack }: { keyboard: boolean; onBack: () => void }) {
  const [takes, setTakes] = useState<Take[]>([])
  const [backing, setBacking] = useState<string>('none')
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
      void rec.current?.stop()
    }
  }, [])

  const start = async () => {
    setError(null)
    setXpNote(null)
    setBusy(true)
    try {
      const r = new TakeRecorder()
      await r.start(BACKINGS.find((b) => b.id === backing) ?? null)
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
    const out = await r.stop()
    if (out) {
      const b = BACKINGS.find((x) => x.id === backing)
      const take: Take = { id: Date.now().toString(36), at: Date.now(), blob: out.blob, sec: out.sec, band: b ? b.label : null, note: '' }
      try {
        await addTake(take)
      } catch {
        setError('Could not save the take in this browser.')
      }
      const g = finishRound('record', Math.round(out.sec), out.sec >= 30 ? 5 : 0)
      if (g.xp) setXpNote(`+${g.xp} XP`)
      setTakes(await listTakes())
    }
    setBusy(false)
  }

  const secs = rec.current?.seconds ?? 0
  // The longest take: stop on its own.
  useEffect(() => {
    if (recording && secs >= MAX_SEC) void stop()
  })

  if (!canRecord()) {
    return (
      <section className="sk-game">
        <GameHead title="Record yourself" sub="This browser can't record audio." onBack={onBack} />
      </section>
    )
  }

  return (
    <section className="sk-game" aria-labelledby="sk-game-h">
      <GameHead
        title="Record yourself"
        sub={`Record a take, listen back, write a note. The last ${KEEP} stay in this browser.`}
        onBack={onBack}
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
            Stop <span className="ls-num">{fmtSec(secs)}</span>
          </button>
        )}
      </div>
      {error && (
        <p className="ls-warn" role="alert">
          {error}
        </p>
      )}
      {xpNote && <p className="ls-muted">Saved. {xpNote}</p>}
      {(keyboard || !engine.running) && <p className="ls-caption">No guitar connected: the take will only have the band in it.</p>}
      <ul className="sk-takes">
        {takes.map((t) => (
          <TakeRow key={t.id} take={t} onDelete={async () => {
            await deleteTake(t.id).catch(() => {})
            setTakes(await listTakes())
          }} />
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

function TakeRow({ take, onDelete }: { take: Take; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [note, setNote] = useState(take.note)
  useEffect(() => {
    const u = URL.createObjectURL(take.blob)
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
      {url && <audio controls src={url} preload="metadata" />}
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
        <button className="ls-btn ghost small" onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  )
}
