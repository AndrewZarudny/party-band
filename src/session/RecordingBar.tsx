import { useState } from 'react'
import type { RecordingEntry } from '../music/library'

/** The song's original recording (the user's own file): add it, play along, line up the beat. */
export function RecordingBar(props: {
  rec: RecordingEntry | null
  on: boolean
  onToggle: (v: boolean) => void
  onFile: (f: File) => void
  onNudge: (ms: number, beats: number) => void
  onRemove: () => void
  onAnalyse: () => void
  analysing: boolean
  transposed: number // the song is played this many semitones from its own key
  volume: number // 0–1
  muted: boolean
  onVolume: (v: number) => void
  onMute: (m: boolean) => void
}) {
  const { rec, on } = props
  const [busy, setBusy] = useState(false)
  if (!rec)
    return (
      <div className="recording-bar">
        <span className="label">Original recording</span>
        <label className="btn small">
          {busy ? 'Finding the beat…' : '🎧 Add your copy of the song (MP3/M4A)'}
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setBusy(true)
              props.onFile(f)
              setTimeout(() => setBusy(false), 4000)
            }}
          />
        </label>
        <button className="btn small" disabled title="Add the recording first">
          🔬 Analyse
        </button>
        <span className="hint">Add the recording first: then 🔬 Analyse and 🤖 Auto-sync of the words work on it. The band plays along with the record.</span>
      </div>
    )
  return (
    <div className="recording-bar">
      <label className="toggle-inline">
        <input type="checkbox" checked={on} onChange={(e) => props.onToggle(e.target.checked)} /> 🎧 Play with the recording
      </label>
      <span className="hint">
        {rec.fileName} · {rec.bpm.toFixed(1)} BPM · first beat {(rec.firstBeat + rec.offsetMs / 1000).toFixed(2)} s
        {rec.beatShift ? ` · shifted ${rec.beatShift > 0 ? '+' : ''}${rec.beatShift} beat${Math.abs(rec.beatShift) > 1 ? 's' : ''}` : ''}
      </span>
      {on && (
        <span className="nudges" title="Line the chords up with the record (works while playing)">
          <button className="seg" onClick={() => props.onNudge(0, -1)}>
            ◀ beat
          </button>
          <button className="seg" onClick={() => props.onNudge(-20, 0)}>
            −20 ms
          </button>
          <button className="seg" onClick={() => props.onNudge(20, 0)}>
            +20 ms
          </button>
          <button className="seg" onClick={() => props.onNudge(0, 1)}>
            beat ▶
          </button>
        </span>
      )}
      <span className="rec-volume" title="The record's volume (changes live while it plays)">
        <button className="icon-btn" onClick={() => props.onMute(!props.muted)} title={props.muted ? 'Unmute the record' : 'Mute the record'}>
          {props.muted || props.volume === 0 ? '🔇' : props.volume < 0.5 ? '🔉' : '🔊'}
        </button>
        <input type="range" min={0} max={100} value={props.muted ? 0 : Math.round(props.volume * 100)} onChange={(e) => props.onVolume(Number(e.target.value) / 100)} aria-label="Record volume" />
        <span className="hint">{props.muted ? 'muted' : `${Math.round(props.volume * 100)}%`}</span>
      </span>
      <button className="btn small" disabled={props.analysing} onClick={props.onAnalyse} title="Find the song's sections, bar lines and chords in the recording">
        {props.analysing ? 'Analysing…' : '🔬 Analyse'}
      </button>
      <button className="link" onClick={props.onRemove}>
        remove
      </button>
      {on && props.transposed !== 0 && (
        <span className="hint warn">⚠ The song is in another key now, but the record plays in its original key: lower or mute it, or turn it off.</span>
      )}
    </div>
  )
}
