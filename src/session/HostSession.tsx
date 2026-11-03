import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { INSTRUMENTS } from '../music/band'
import type { SessionMember } from './shared'
import { HOST_ID } from './hostId'

/** Start / end a live session and show how to join; reports who joined via onMembers. */
export function HostSession({ onMembers }: { onMembers: (m: SessionMember[] | null) => void }) {
  const [session, setSession] = useState<{ id: string; urls: string[] } | null>(null)
  const [members, setMembers] = useState<SessionMember[]>([])
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [elsewhere, setElsewhere] = useState<string | null>(null)

  // Pick up a session that is already running (e.g. after reloading the page).
  useEffect(() => {
    if (sessionStorage.getItem('live-session')) void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!session) return
    QRCode.toDataURL(session.urls[0] ?? '', { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(''))
    const es = new EventSource(`/api/session/${session.id}/events`)
    // Connection lost (e.g. the server restarted): re-claim the same code once it's back.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setTimeout(() => void start(), 2000)
    }
    es.onmessage = (ev) => {
      const d = JSON.parse(ev.data) as { members?: SessionMember[]; ended?: boolean }
      if (d.members) {
        setMembers(d.members)
        onMembers(d.members)
      }
    }
    return () => es.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, onMembers])

  const start = async (takeOver = false) => {
    setError('')
    try {
      const want = sessionStorage.getItem('live-session') ?? undefined
      const r = (await (await fetch('/api/session', { method: 'POST', body: JSON.stringify({ hostId: HOST_ID, takeOver, id: want }) })).json()) as {
        id: string
        urls: string[]
        error?: string
        elsewhere?: boolean
      }
      if (r.error) throw new Error(r.error)
      if (r.elsewhere) {
        setElsewhere(r.id)
        return
      }
      setElsewhere(null)
      sessionStorage.setItem('live-session', r.id)
      setSession(r)
      onMembers([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const end = async () => {
    await fetch('/api/session/end', { method: 'POST' }).catch(() => {})
    sessionStorage.removeItem('live-session')
    setSession(null)
    setMembers([])
    onMembers(null)
  }

  if (!session && elsewhere)
    return (
      <div className="host-session">
        <span className="hint">
          Live session <b>{elsewhere}</b> is running in another window.
        </span>
        <button className="btn small" onClick={() => void start(true)}>
          Take over here
        </button>
      </div>
    )

  if (!session)
    return (
      <div className="host-session">
        <button className="btn" onClick={() => void start()}>
          📡 Start live session
        </button>
        <span className="hint">Bandmates on the same Wi-Fi join from their phones and see their own part.</span>
        {error && <span className="tone-err">{error}</span>}
      </div>
    )

  return (
    <div className="host-session live">
      {qr && <img className="qr" src={qr} alt="QR code to join" />}
      <div className="hs-info">
        <div>
          <span className="label">Live session</span> <b className="hs-code">{session.id}</b>
        </div>
        <div className="hint">Scan the code, or open on a phone on this Wi-Fi:</div>
        {session.urls.map((u) => (
          <code key={u}>{u}</code>
        ))}
        {!session.urls.length && <div className="tone-err">No Wi-Fi address found: is this Mac on the network?</div>}
        <div className="hs-members">
          {members.length === 0 && <span className="hint">Nobody has joined yet.</span>}
          {members.map((m) => (
            <span key={m.id} className={`band-chip ${m.online ? '' : 'offline'}`} title={m.online ? 'Connected' : 'Disconnected'}>
              {m.online ? '🟢' : '⚪'} {INSTRUMENTS[m.instrument].icon} {m.name}
            </span>
          ))}
        </div>
        <button className="link" onClick={() => void end()}>
          end session
        </button>
      </div>
    </div>
  )
}
