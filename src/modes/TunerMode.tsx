import { useEffect, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { useEngineState, usePitch } from '../audio/hooks'
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
  const [ampWasOn] = useState(engine.ampOn)

  // Tune silently: the amp sound would only get in the way.
  useEffect(() => {
    engine.setAmpOn(false)
    return () => engine.setAmpOn(ampWasOn)
  }, [ampWasOn])

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
            'Play one open string'
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
