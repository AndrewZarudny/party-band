import { useEffect, useReducer, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { useEngineState, useLevel, usePitch } from '../audio/hooks'
import { freqToMidiFloat, midiName, midiToFreq, noteName } from '../music/theory'
import { TUNINGS, describeTuning, getSongTuning, onSongTuning, tuningLabel } from '../music/tunings'

function savedChoice() {
  try {
    return localStorage.getItem('tuner-tuning') ?? 'song'
  } catch {
    return 'song'
  }
}

export function TunerMode({ onConnect }: { onConnect: () => void }) {
  const e = useEngineState()
  const pitch = usePitch()
  const level = useLevel()
  const [choice, setChoice] = useState(savedChoice)
  const [song, setSong] = useState(getSongTuning)
  useEffect(() => onSongTuning(() => setSong(getSongTuning())), [])
  const pickChoice = (c: string) => {
    setChoice(c)
    try {
      localStorage.setItem('tuner-tuning', c)
    } catch {
      /* storage unavailable */
    }
  }
  const tuning = choice === 'song' && song ? song.notes : (TUNINGS.find((t) => t.id === choice) ?? TUNINGS[0]).notes
  // Smooth the needle so it doesn't jitter.
  const [cents, setCents] = useState(0)
  const smooth = useRef(0)

  // Tune silently: the amp sound would only get in the way. Leaving goes back to the player's Hear amp choice.
  useEffect(() => {
    engine.muteFor('tuner', true)
    return () => engine.muteFor('tuner', false)
  }, [])

  // Nearest open string, judged against the exact detected frequency.
  const target = pitch ? tuning.reduce((a, b) => (Math.abs(b - freqToMidiFloat(pitch.freq)) < Math.abs(a - freqToMidiFloat(pitch.freq)) ? b : a)) : null
  const stringIdx = target !== null ? tuning.indexOf(target) : -1
  const offString = pitch && target !== null ? Math.round((freqToMidiFloat(pitch.freq) - target) * 100) : 0
  const showStringMode = pitch && Math.abs(offString) < 250

  useEffect(() => {
    if (!pitch) return
    const raw = showStringMode ? offString : pitch.cents
    smooth.current = smooth.current * 0.7 + Math.max(-50, Math.min(50, raw)) * 0.3
    setCents(Math.round(smooth.current))
  }, [pitch, offString, showStringMode])

  const inTune = pitch && Math.abs(cents) <= 3
  const angle = (Math.max(-50, Math.min(50, cents)) / 50) * 60

  const picker = (
    <select className="tuner-select" value={choice === 'song' && !song ? 'standard' : choice} onChange={(ev) => pickChoice(ev.target.value)}>
      {song && (
        <option value="song">
          For “{song.song}”: {describeTuning(song.notes)} ({tuningLabel(song.notes)})
        </option>
      )}
      {TUNINGS.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} ({tuningLabel(t.notes)})
        </option>
      ))}
    </select>
  )

  if (!e.running) {
    return (
      <div className="tuner-mode">
        <div className="tuner-empty">
          <h2>Tuner</h2>
          {picker}
          <p className="hint">Connect your guitar to tune.</p>
          <button className="btn primary" onClick={onConnect}>
            🎸 Connect guitar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="tuner-mode">
      {picker}
      <div className={`tuner-dial ${inTune ? 'in' : ''}`}>
        <svg viewBox="0 0 300 180">
          {Array.from({ length: 21 }, (_, i) => {
            const a = ((i - 10) / 10) * 60
            const r1 = 130
            const r2 = i % 5 === 0 ? 112 : 120
            const rad = ((a - 90) * Math.PI) / 180
            return (
              <line
                key={i}
                x1={150 + r1 * Math.cos(rad)}
                y1={165 + r1 * Math.sin(rad)}
                x2={150 + r2 * Math.cos(rad)}
                y2={165 + r2 * Math.sin(rad)}
                className={i === 10 ? 'tick center' : 'tick'}
              />
            )
          })}
          <text x={40} y={170} className="tick-label">
            −50
          </text>
          <text x={260} y={170} className="tick-label" textAnchor="end">
            +50
          </text>
          {pitch && <line x1={150} y1={165} x2={150} y2={45} className="needle" transform={`rotate(${angle} 150 165)`} />}
          <circle cx={150} cy={165} r={6} className="hub" />
        </svg>
        <div className="tuner-big">
          {pitch ? (showStringMode && target !== null ? noteName(target, true) : noteName(pitch.midi, true)) : '—'}
          <small>{pitch ? (showStringMode && target !== null ? midiName(target) : midiName(pitch.midi)) : ''}</small>
        </div>
        <div className="tuner-read">
          {pitch ? (
            <>
              {inTune ? 'In tune ✓' : cents < 0 ? `${-cents}¢ flat: tune up` : `${cents}¢ sharp: tune down`}
              <span className="hz">
                {pitch.freq.toFixed(1)} Hz{target !== null && showStringMode ? ` (target ${midiToFreq(target).toFixed(1)})` : ''}
              </span>
            </>
          ) : (
            <NoNote level={level} />
          )}
        </div>
      </div>
      <div className="tuner-strings">
        {tuning.map((m, i) => (
          <div key={m} className={`ts ${i === stringIdx && showStringMode ? (inTune ? 'in' : 'active') : ''}`}>
            <b>{noteName(m, true)}</b>
            <span>{midiName(m)}</span>
          </div>
        ))}
      </div>
      <p className="hint">The amp is muted while you tune. Pluck one string at a time and let it ring.</p>
    </div>
  )
}

/** Why no note shows yet: audio paused, no sound on the input (or the guitar on the other input), or sound with no clear note. */
function NoNote({ level }: { level: number }) {
  const e = useEngineState()
  // Input levels change without a render (a silent input stays at exactly 0): look again a few times a second.
  const [, tick] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const t = setInterval(tick, 400)
    return () => clearInterval(t)
  }, [])
  if (e.needsResume)
    return (
      <button className="btn primary" onClick={() => void engine.ensureContext()}>
        Sound is paused: click to start it again
      </button>
    )
  // The engine only looks for a note above this level (see the analysis loop).
  const heard = level > 0.0012
  const ch = e.channel === 'auto' ? e.autoPick : e.channel
  const other = ch === 'left' ? 'right' : ch === 'right' ? 'left' : null
  const otherLevel = other === 'left' ? e.chLevels[0] : other === 'right' ? e.chLevels[1] : 0
  const name = (c: 'left' | 'right') => (c === 'left' ? 'Input 1' : 'Input 2')
  const meter = (
    <span className="tuner-level" title="What the tuner hears">
      <i style={{ width: `${Math.min(100, Math.sqrt(level / 0.05) * 100)}%` }} className={heard ? 'on' : ''} />
    </span>
  )
  if (heard)
    return (
      <>
        Play one open string and let it ring{meter}
        <span className="hz">Hearing sound but no clear note yet: one string at a time, no chords.</span>
      </>
    )
  if (other && otherLevel > 0.002)
    return (
      <>
        Your guitar seems to be on {name(other)}
        {meter}
        <button className="btn" onClick={() => engine.setChannel(other)}>
          Listen to {name(other)}
        </button>
      </>
    )
  return (
    <>
      Play one open string{meter}
      <span className="hz">
        {level > 0 ? 'Too quiet to hear a note' : 'No sound from the guitar input'} ({ch === 'mix' ? 'both inputs' : name(ch)}): check the cable, the INST button and the gain knob on the interface.
      </span>
    </>
  )
}
