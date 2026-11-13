import { useState } from 'react'
import type { SongSetup } from '../music/songForm'
import { sectionBars } from '../music/songForm'
import type { KeyGuess } from '../music/keyGuess'
import { noteName, parseChord, pc, prefersFlats } from '../music/theory'

export interface AnalysisResult {
  bpm: number
  songStart: number // seconds into the file where the song's first bar starts
  barChords: string[]
  formBars: number[]
  agreement: number // 0–1
  key: KeyGuess | null // the key the record's chords point to
}

const keyLabel = (root: number, minor: boolean) => `${noteName(root, prefersFlats(root, minor))} ${minor ? 'minor' : 'major'}`

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** What the analysis found in the recording, to check before applying it to the song. */
export function AnalysisReview({ song, result, onApply, onClose }: { song: SongSetup; result: AnalysisResult; onApply: (lengths: boolean, chords: boolean, key: boolean) => void; onClose: () => void }) {
  const [useLengths, setUseLengths] = useState(true)
  const [useChords, setUseChords] = useState(result.agreement < 0.6)
  // The set-up's key against the one heard: same, the relative key (same notes), or a semitone off
  // (the record is probably tuned down or up).
  const setupRoot = parseChord(song.key)?.root
  const heard = result.key
  const same = !!heard && heard.root === setupRoot && heard.minor === song.minor
  const relative = !!heard && setupRoot !== undefined && heard.minor !== song.minor && pc(heard.root - setupRoot) === (heard.minor ? 9 : 3)
  const shift = heard && setupRoot !== undefined && heard.minor === song.minor ? pc(heard.root - setupRoot) : 0
  const [useKey, setUseKey] = useState(!!heard && !same && !relative && heard.confidence >= 0.3)
  // Where each form section starts, in bars of the recording.
  const starts: number[] = []
  song.form.forEach((_, i) => starts.push(i ? starts[i - 1] + (result.formBars[i - 1] ?? 0) : 0))
  return (
    <div className="panel-backdrop center" onClick={onClose}>
      <div className="dialog analysis" onClick={(e) => e.stopPropagation()}>
        <h2>🔬 What's in the recording</h2>
        <p className="hint">
          {result.bpm.toFixed(1)} BPM · the song's first bar starts at {mmss(result.songStart)} · {result.barChords.length} bars ·{' '}
          <b className={result.agreement >= 0.75 ? 'good' : result.agreement >= 0.5 ? 'ok' : 'bad'}>{Math.round(result.agreement * 100)}%</b> of bars agree with the
          set-up chords
        </p>
        {heard && (
          <p className="an-key">
            Key heard: <b>{keyLabel(heard.root, heard.minor)}</b>
            {heard.confidence < 0.3 && heard.runnerUp && <> (or {keyLabel(heard.runnerUp.root, heard.runnerUp.minor)}: the chords fit both)</>} · set-up says{' '}
            {song.key} {song.minor ? 'minor' : 'major'}
            {same && ' ✓'}
            {relative && <span className="hint"> · the same notes; they differ only in which chord feels like home</span>}
            {(shift === 1 || shift === 11) && (
              <span className="hint"> · a half step {shift === 11 ? 'lower' : 'higher'}: the record is probably tuned {shift === 11 ? 'down' : 'up'} a half step</span>
            )}
          </p>
        )}
        <div className="an-sections">
          {song.form.map((name, i) => {
            const sec = song.sections.find((s) => s.name === name)
            const was = sec ? sectionBars(sec) : 0
            const now = result.formBars[i] ?? 0
            const bar = starts[i]
            const chords = result.barChords.slice(bar, bar + now)
            return (
              <div key={i} className="an-row">
                <span className="an-name">
                  {i + 1}. {name}
                </span>
                <span className={`an-len ${now !== was ? 'changed' : ''}`}>
                  {now} bars{now !== was ? ` (was ${was})` : ''}
                </span>
                <span className="an-chords">
                  {chords.slice(0, 8).join('  ')}
                  {chords.length > 8 ? '  …' : ''}
                </span>
              </div>
            )
          })}
        </div>
        <label className="toggle-inline">
          <input type="checkbox" checked={useLengths} onChange={(e) => setUseLengths(e.target.checked)} /> Use these section lengths and start point
        </label>
        {heard && !same && (
          <label className="toggle-inline">
            <input type="checkbox" checked={useKey} onChange={(e) => setUseKey(e.target.checked)} /> Use the key heard ({keyLabel(heard.root, heard.minor)}) for the song's scale and solos
          </label>
        )}
        <label className="toggle-inline">
          <input type="checkbox" checked={useChords} onChange={(e) => setUseChords(e.target.checked)} /> Use the chords heard in the recording (instead of the set-up chords)
        </label>
        <p className="hint">
          Chords are detected as major/minor, so 7ths, sus and add9 come out as plain chords; distorted power chords are the hardest. Section lengths are usually the
          most useful part.
        </p>
        <div className="row">
          <button className="btn primary" disabled={!useLengths && !useChords && !useKey} onClick={() => onApply(useLengths, useChords, useKey && !same)}>
            Apply
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
