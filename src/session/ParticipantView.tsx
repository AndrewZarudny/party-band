import { useEffect, useRef, useState } from 'react'
import type { Instrument } from '../music/band'
import { INSTRUMENTS } from '../music/band'
import { MemberCard } from '../components/BandCards'
import type { JamState, SessionMember } from './shared'
import { measureClockOffset, momentOf } from './shared'
import { SoloGuide } from './SoloGuide'
import { SongProgress } from '../components/SongProgress'
import { songSegments } from '../music/songForm'
import { lyricTimeline } from '../music/lyrics'

const memberKey = (code: string) => `session-member:${code}`

/** A bandmate's phone: join with a name and instrument, then follow the host's jam live. */
export function ParticipantView({ code }: { code: string }) {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(memberKey(code)) ?? 'null') as { id: string; name: string; instrument: Instrument } | null
    } catch {
      return null
    }
  })()
  const [me, setMe] = useState(saved)
  const [name, setName] = useState(saved?.name ?? localStorage.getItem('player-name') ?? '')
  const [instrument, setInstrument] = useState<Instrument>(saved?.instrument ?? 'acoustic')
  const [state, setState] = useState<JamState | null>(null)
  const [members, setMembers] = useState<SessionMember[]>([])
  const [status, setStatus] = useState<'connecting' | 'live' | 'ended' | 'error'>('connecting')
  const [error, setError] = useState('')
  const offset = useRef(0)
  const [, tick] = useState(0)

  const join = async (n = name, inst = instrument, id = me?.id) => {
    setError('')
    const res = await fetch(`/api/session/${code}/join`, { method: 'POST', body: JSON.stringify({ id, name: n, instrument: inst }) })
    const r = (await res.json()) as { id?: string; error?: string }
    if (!r.id) {
      setError(r.error ?? 'Could not join.')
      setStatus('error')
      return
    }
    const m = { id: r.id, name: n, instrument: inst }
    localStorage.setItem(memberKey(code), JSON.stringify(m))
    localStorage.setItem('player-name', n)
    setMe(m)
  }

  // Coming back to the page: rejoin with the same id so the host keeps your role.
  useEffect(() => {
    if (saved) void join(saved.name, saved.instrument, saved.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live updates from the host, plus a clock sync so beats line up with everyone else's screen.
  useEffect(() => {
    if (!me) return
    let es: EventSource | null = null
    let stopped = false
    const connect = () => {
      es = new EventSource(`/api/session/${code}/events?member=${me.id}`)
      es.onmessage = (ev) => {
        const d = JSON.parse(ev.data) as { ended?: boolean; state?: JamState | null; members?: SessionMember[] }
        if (d.ended) {
          setStatus('ended')
          es?.close()
          return
        }
        setStatus('live')
        if (d.state) setState(d.state)
        if (d.members) {
          setMembers(d.members)
          // The session came back without me (server restart): rejoin as the same player.
          if (!d.members.some((x) => x.id === me.id)) {
            void fetch(`/api/session/${code}/join`, { method: 'POST', body: JSON.stringify(me) })
              .then(() => {
                es?.close()
                connect()
              })
              .catch(() => {})
          }
        }
      }
      es.onerror = () => {
        if (stopped) return
        setStatus('connecting')
        // The browser gives up after a failed reconnect (e.g. server restart): keep trying.
        if (es?.readyState === EventSource.CLOSED) setTimeout(() => !stopped && connect(), 2000)
      }
    }
    void measureClockOffset().then((o) => (offset.current = o))
    const resync = setInterval(() => void measureClockOffset().then((o) => (offset.current = o)), 30000)
    connect()
    return () => {
      stopped = true
      clearInterval(resync)
      es?.close()
    }
     
  }, [me, code])

  // Redraw every frame while the jam runs (beat dots, strum playhead).
  useEffect(() => {
    if (!state?.running) return
    let raf = 0
    const frame = () => {
      tick((n) => n + 1)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [state?.running])

  // Keep the phone screen awake during the jam where the browser allows it.
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    let lock: { release: () => Promise<void> } | null = null
    nav.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {})
    return () => void lock?.release()
  }, [me])

  if (!me) {
    return (
      <div className="participant join">
        <div className="brand">Fretwise</div>
        <h2>Join jam {code}</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus />
        <div className="instrument-pick">
          {(Object.keys(INSTRUMENTS) as Instrument[]).map((i) => (
            <button key={i} className={`seg big ${instrument === i ? 'on' : ''}`} onClick={() => setInstrument(i)}>
              {INSTRUMENTS[i].icon} {INSTRUMENTS[i].label}
            </button>
          ))}
        </div>
        <button className="btn primary big" disabled={!name.trim()} onClick={() => void join()}>
          Join
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    )
  }

  if (status === 'ended')
    return (
      <div className="participant join">
        <div className="brand">Fretwise</div>
        <h2>The jam session has ended</h2>
        <p className="hint">Thanks for playing! Ask the host for a new code to join again.</p>
      </div>
    )

  const self = state?.band.find((m) => m.id === me.id)
  const t = state ? momentOf(state, Date.now() + offset.current) : null
  const segments = state?.timeline ? songSegments(state.timeline.map((x) => ({ ...x, formIdx: x.formIdx ?? -1, chord: null as never }))) : []
  const lyricLines = state ? lyricTimeline(state, segments) : []
  const iSolo = !!t?.soloist && t.soloist.id === me.id
  // My solo is next in the rotation: count down, and show the guide a round early to prepare.
  const soloComing = !!t && !iSolo && t.nextSoloist?.id === me.id && t.chordsUntilSwap > 0
  const len = Math.max(1, t?.chords.length ?? 1)
  const isGuitar = me.instrument === 'electric' || me.instrument === 'acoustic'

  return (
    <div className="participant">
      <header className="p-head">
        <span className="brand">Fretwise</span>
        <span className="p-me">
          {INSTRUMENTS[me.instrument].icon} {me.name}
        </span>
        <span className={`p-status ${status}`}>{status === 'live' ? `● ${code}` : 'reconnecting…'}</span>
        <button
          className="link"
          onClick={() => {
            localStorage.removeItem(memberKey(code))
            void fetch(`/api/session/${code}/leave`, { method: 'POST', body: JSON.stringify({ id: me.id }) })
            setMe(null)
          }}
        >
          change
        </button>
      </header>

      {!state || !t ? (
        <p className="hint p-wait">Connected. Waiting for the host to set up the jam…</p>
      ) : (
        <>
          {state.timeline && state.songTitle && (
            <SongProgress segments={segments} beat={t.songBeat} bpm={state.bpm} ended={t.ended} />
          )}
          {state.songTitle && (
            <div className="p-section">
              <span>🎵 {state.songTitle}</span>
              {t.section && (
                <b>
                  {t.section}
                  {t.nextSection && t.nextSection !== t.section && <small> · then {t.nextSection}</small>}
                </b>
              )}
            </div>
          )}
          <div className="p-chords">
            <div className="p-now">
              <span className="label">{t.countIn ? 'Count-in' : 'Now'}</span>
              <span className="sym">{t.countIn ? 5 - t.countIn : (t.chord?.symbol ?? '—')}</span>
            </div>
            <div className="p-next">
              <span className="label">Next</span>
              <span className="sym">{t.countIn ? t.chord?.symbol : (t.next?.symbol ?? '—')}</span>
            </div>
          </div>
          <div className="p-beats">
            {Array.from({ length: t.beatsThisChord }, (_, b) => (
              <i key={b} className={state.running && !t.countIn && b <= t.beatInChord ? 'on' : ''} />
            ))}
          </div>
          {!state.running && !t.ended && <p className="hint p-wait">Waiting for {state.hostName} to start · {state.chords.join(' → ')}</p>}
          {t.ended && <p className="p-ended">🏁 That's the end of {state.songTitle?.split(' – ')[0] ?? 'the song'}. Nice one!</p>}
          {!t.soloist && !soloComing && state.songTitle && <div className="p-solo">Everyone plays the song</div>}
          {soloComing ? (
            <div className={`p-solo coming ${t.chordsUntilSwap <= 2 ? 'soon' : ''}`}>
              🎤 Your solo in {t.chordsUntilSwap} chord{t.chordsUntilSwap > 1 ? 's' : ''}
              {t.chordsUntilSwap <= 2 ? ': get ready!' : ` · now: ${t.soloist?.name ?? '—'}`}
            </div>
          ) : (
            t.soloist && (
              <div className={`p-solo ${iSolo ? 'mine' : ''}`}>
                {iSolo ? '🎤 Your solo!' : `Solo: ${t.soloist.name}`}
                {t.nextSoloist && t.nextSoloist.id !== t.soloist.id && !iSolo && <small> · next: {t.nextSoloist.name} in {t.chordsUntilSwap}</small>}
                {iSolo && t.soloLeft > 0 && <small> · {t.soloLeft} chord{t.soloLeft > 1 ? 's' : ''} left</small>}
              </div>
            )
          )}
          {self && t.chord ? (
            <MemberCard
              m={self}
              ctx={{
                chord: t.chord,
                next: t.next,
                feel: t.feel,
                eighth: t.eighth,
                soloist: t.soloist,
                scaleLabel: t.scaleLabel,
                scalePcs: t.scalePcs,
                keyName: t.keyName,
                flats: t.flats,
                boxFret: state.position,
                keys: t.voicings[t.chordIdx],
                nextKeys: t.voicings[(t.chordIdx + 1) % Math.max(1, t.voicings.length)] ?? null,
                lyricLines,
                songBeat: t.songBeat,
                section: t.section,
                nextSection: t.nextSection,
                beatsToNext: t.beatsToNext,
                songTitle: state.songTitle,
                strum: state.rhythm?.[t.section]?.strum,
                technique: state.rhythm?.[t.section]?.technique,
              }}
            />
          ) : (
            <p className="hint">You'll appear in the band as soon as the host's screen updates.</p>
          )}
          {isGuitar && t.chord && (iSolo || (soloComing && t.chordsUntilSwap <= len)) && (
            <SoloGuide chord={t.chord} next={t.next} chordIdx={t.chordIdx} scalePcs={t.scalePcs} position={state.position} flats={t.flats} />
          )}
          <p className="hint p-band">
            Band: {members.filter((m) => m.online).map((m) => `${INSTRUMENTS[m.instrument].icon} ${m.name}`).join(' · ')} · {state.bpm} BPM · key of {t.keyName}
          </p>
        </>
      )}
    </div>
  )
}
