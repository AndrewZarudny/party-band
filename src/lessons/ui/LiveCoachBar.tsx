// The live coach's bar in Lessons: turn it on, see whether it's listening, mute it, read what was said.
import { useState, useSyncExternalStore } from 'react'
import type { Progress } from '../types'
import { canListen, getLiveCoach, hushCoach, setCoachMuted, startLiveCoach, stopLiveCoach, subscribeLiveCoach } from '../liveCoach'
import { coachFacts } from '../coach'
import { loadStats } from '../../skills/store'
import { useAccount } from '../../account/session'
import { getPracticeSnapshot } from '../../practice/log'
import { practiceDaySec } from '../../practice/data'
import { dayKey } from '../progress'

const STATUS: Record<string, string> = {
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  paused: 'Paused while you play',
  muted: 'Mic off',
}

export function LiveCoachBar({ progress, goalMin }: { progress: Progress; goalMin: number }) {
  const s = useSyncExternalStore(subscribeLiveCoach, getLiveCoach)
  const { account } = useAccount()
  const [open, setOpen] = useState(true)

  if (!s.on) {
    return (
      <div className="lc-bar off">
        <button
          className="lc-start"
          onClick={() => {
            const now = new Date()
            startLiveCoach(coachFacts(progress, loadStats(), now, 'open', { name: account?.name ?? null, todaySec: practiceDaySec(getPracticeSnapshot(), dayKey(now)), goalMin }))
          }}
          title="A coach you can talk to: it speaks after each run and answers what you ask"
        >
          <span className="lc-mic" aria-hidden>
            🎙
          </span>
          Live coach
        </button>
      </div>
    )
  }

  const last = [...s.log].reverse().find((l) => l.who === 'coach')
  return (
    <section className={`lc-bar on ${s.phase}`} aria-label="Live coach">
      <header className="lc-head">
        <span className={`lc-dot ${s.phase}`} aria-hidden />
        <span className="lc-status" role="status" aria-live="polite">
          {STATUS[s.phase] ?? ''}
        </span>
        <div className="lc-buttons">
          {s.phase === 'speaking' && (
            <button className="lc-btn" onClick={hushCoach}>
              Stop
            </button>
          )}
          {canListen() && (
            <button className={`lc-btn ${s.muted ? 'on' : ''}`} aria-pressed={s.muted} onClick={() => setCoachMuted(!s.muted)} title={s.muted ? 'Turn the microphone back on' : 'Stop listening (the coach still talks after runs)'}>
              {s.muted ? 'Unmute' : 'Mute'}
            </button>
          )}
          <button className="lc-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Less' : 'More'}
          </button>
          <button className="lc-btn" onClick={stopLiveCoach}>
            End
          </button>
        </div>
      </header>
      {s.error && (
        <p className="lc-err" role="alert">
          {s.error}
        </p>
      )}
      {s.heard && <p className="lc-heard">“{s.heard}…”</p>}
      {open ? (
        <ol className="lc-log">
          {s.log.slice(-6).map((l, i) => (
            <li key={`${s.log.length}-${i}`} className={l.who}>
              {l.text}
            </li>
          ))}
          {!s.log.length && <li className="hint">{canListen() ? "Say hi. It hears you through your Mac's default microphone (System Settings, Sound, Input: MacBook mic)." : 'This browser has no speech recognition: the coach still talks after each run.'}</li>}
        </ol>
      ) : (
        last && <p className="lc-last">{last.text}</p>
      )}
    </section>
  )
}
