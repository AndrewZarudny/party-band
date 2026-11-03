import { useEffect, useRef, useState } from 'react'
import type { Segment, SongSetup } from '../music/songForm'
import { sungLines } from '../music/lyrics'
import type { AutoSyncResult, Recording } from './autoSync'
import { LANGUAGES, autoSync, guessLanguage } from './autoSync'

interface Cue {
  formIdx: number
  line: number
  text: string
}

/**
 * Tap-to-sync: play the song and tap as each line of the words starts. The times are saved on the
 * song's beat clock, so the karaoke stays right at any tempo and on every bandmate's phone.
 */
export function LyricSync(props: {
  song: SongSetup
  segments: Segment[]
  running: boolean
  songBeat: number
  beatNow: () => number | null // the song beat being heard right now, or null when stopped
  onStart: () => void
  onSave: (lyricBeats: (number[] | null)[]) => void
  recording: Recording | null // the song's recording, for auto-sync
  onAutoSync: (r: AutoSyncResult) => void
}) {
  const { song, segments } = props
  const [open, setOpen] = useState(false)
  const [helper, setHelper] = useState<{ ready: boolean } | null>(null)
  const [language, setLanguage] = useState(() => guessLanguage((song.lyrics ?? []).join(' ')))
  const [auto, setAuto] = useState<{ busy: boolean; msg: string; error?: boolean }>({ busy: false, msg: '' })
  useEffect(() => {
    if (!props.recording) return
    fetch('/api/align/status')
      .then((r) => r.json() as Promise<{ ready: boolean }>)
      .then(setHelper)
      .catch(() => setHelper({ ready: false }))
  }, [props.recording])
  const runAuto = async () => {
    if (!props.recording) return
    setAuto({ busy: true, msg: 'Separating the vocals and lining up the words… about a minute (a few more the first time, while the models download).' })
    try {
      const r = await autoSync(song, segments, props.recording, language)
      props.onAutoSync(r)
      setAuto({
        busy: false,
        msg: `Placed ${r.placed} of ${r.total} words in ${r.sections} section${r.sections === 1 ? '' : 's'}${r.seconds ? ` (${Math.round(r.seconds)} s)` : ''}. Play it with the record and re-tap any line that's off.`,
      })
    } catch (err) {
      setAuto({ busy: false, msg: err instanceof Error ? err.message : String(err), error: true })
    }
  }
  const [taps, setTaps] = useState<Map<string, number>>(new Map())
  const [ptr, setPtr] = useState(0)
  const history = useRef<{ key: string; ptr: number }[]>([])

  const lyrics = song.lyrics ?? []
  const cues: Cue[] = lyrics.flatMap((words, formIdx) => sungLines(words).map((text, line) => ({ formIdx, line, text })))
  const segOf = (f: number) => segments.find((x) => x.formIdx === f)
  const sections = lyrics.map((w, f) => ({ f, lines: sungLines(w).length })).filter((x) => x.lines > 0)
  const synced = sections.filter((x) => song.lyricBeats?.[x.f]?.length === x.lines).length

  /** The line to tap next: skips sections that already went by (started mid-song, or one was missed). */
  const due = (p: number, beat: number) => {
    while (p < cues.length) {
      const seg = segOf(cues[p].formIdx)
      if (seg && seg.start + seg.beats < beat - 2) p++
      else break
    }
    return p
  }

  const tap = () => {
    const b = props.beatNow()
    if (b === null) return
    const p = due(ptr, b)
    const cue = cues[p]
    const seg = cue && segOf(cue.formIdx)
    if (!cue || !seg) return
    const key = `${cue.formIdx}:${cue.line}`
    history.current.push({ key, ptr })
    setTaps((m) => new Map(m).set(key, Math.round((b - seg.start) * 8) / 8))
    setPtr(p + 1)
  }
  const undo = () => {
    const h = history.current.pop()
    if (!h) return
    setTaps((m) => {
      const n = new Map(m)
      n.delete(h.key)
      return n
    })
    setPtr(h.ptr)
  }
  const save = () => {
    // A section takes the new times once every one of its lines was tapped; the others keep theirs.
    const out = lyrics.map((words, f) => {
      const n = sungLines(words).length
      const t = Array.from({ length: n }, (_, i) => taps.get(`${f}:${i}`))
      return n && t.every((x) => x !== undefined) ? (t as number[]) : (song.lyricBeats?.[f] ?? null)
    })
    props.onSave(out)
    setTaps(new Map())
    setPtr(0)
    history.current = []
  }

  // Enter taps, Backspace undoes (Space stays start/stop).
  const keys = useRef({ tap, undo })
  keys.current = { tap, undo }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Partial<HTMLElement> | null)?.closest?.('input, select, textarea')) return
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault()
        keys.current.tap()
      } else if (e.code === 'Backspace') {
        e.preventDefault()
        keys.current.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!cues.length) return null
  if (!open)
    return (
      <div className="lyric-sync closed">
        <button className="btn" onClick={() => setOpen(true)}>
          🎤 Sync the words to the song
        </button>
        {props.recording && helper?.ready && (
          <>
            <button className="btn primary" disabled={auto.busy} onClick={() => void runAuto()} title="Finds when each word is sung on the recording (runs on this Mac)">
              {auto.busy ? '🤖 Syncing…' : '🤖 Auto-sync to the recording'}
            </button>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={auto.busy} title="Language of the words">
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="hint">
          {synced}/{sections.length} sung sections synced{synced < sections.length ? ', the rest are timed by guesswork' : ''}
          {props.recording && helper && !helper.ready ? ' · auto-sync needs its helper installed (see the README)' : ''}
          {!props.recording ? ' · add the song\'s recording to auto-sync the words' : ''}
        </span>
        {auto.msg && <p className={auto.error ? 'error' : 'hint'}>{auto.msg}</p>}
      </div>
    )

  const p = due(ptr, props.songBeat)
  const cue = cues[p]
  const after = cues[p + 1]
  const tapped = taps.size
  return (
    <div className="lyric-sync">
      <div className="row spread">
        <b>🎤 Sync the words</b>
        <span className="hint">
          {tapped} line{tapped === 1 ? '' : 's'} tapped · {synced}/{sections.length} sections saved before
        </span>
      </div>
      <p className="hint">
        Play the song (with the recording if you have it), and tap the moment each line starts: the big button, or <kbd>Enter</kbd>. Missed one? <kbd>Backspace</kbd>{' '}
        undoes. To redo one section, click it on the progress bar and tap from there. A section is saved once all its lines are tapped.
      </p>
      {!props.running ? (
        <button className="btn primary big" onClick={props.onStart}>
          ▶ Play the song
        </button>
      ) : cue ? (
        <button
          className="sync-tap"
          onPointerDown={(e) => {
            e.preventDefault()
            tap()
          }}
        >
          <span className="label">
            Tap when this starts · {song.form[cue.formIdx]} line {cue.line + 1}
          </span>
          <span className="sync-line">{cue.text}</span>
          {after && <span className="sync-after">then: {after.text}</span>}
        </button>
      ) : (
        <p className="hint">All lines tapped. Save them below.</p>
      )}
      <div className="row">
        <button className="btn primary" disabled={!tapped} onClick={save}>
          Save timings
        </button>
        <button className="btn" disabled={!tapped} onClick={undo}>
          ↶ Undo
        </button>
        {!!song.lyricBeats?.some(Boolean) && (
          <button
            className="btn"
            onClick={() => {
              if (confirm('Forget all the tapped timings for this song?')) props.onSave([])
            }}
          >
            Clear saved timings
          </button>
        )}
        <button className="btn" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  )
}
