import { useEffect, useState } from 'react'
import type { SongSetup } from '../music/songForm'
import type { TabInfo } from '../music/tabImport'
import { songFromTab } from '../music/tabImport'

const when = (t: number) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' })

/** Set a song up from a Guitar Pro tab in Downloads (or any tab file): form, chords, rhythm and words. */
export function TabPicker({ onUse, onClose }: { onUse: (s: SongSetup) => void; onClose: () => void }) {
  const [files, setFiles] = useState<{ name: string; mtime: number }[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ song: SongSetup; info: TabInfo; file: string } | null>(null)

  useEffect(() => {
    fetch('/api/downloads/list')
      .then((r) => r.json() as Promise<{ files: { name: string; mtime: number }[] }>)
      .then((r) => setFiles(r.files))
      .catch(() => setFiles([]))
  }, [])

  const read = async (name: string, bytes: Uint8Array) => {
    setBusy(name)
    setError('')
    try {
      const alphaTab = await import('@coderline/alphatab')
      const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes)
      setResult({ ...songFromTab(score, name), file: name })
    } catch (err) {
      setError(`Couldn't read ${name}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy('')
    }
  }
  const fromDownloads = async (name: string) => {
    const r = await fetch(`/api/downloads/file?name=${encodeURIComponent(name)}`)
    if (!r.ok) return setError(`Couldn't open ${name}`)
    await read(name, new Uint8Array(await r.arrayBuffer()))
  }

  return (
    <div className="panel-backdrop center" onClick={onClose}>
      <div className="dialog tab-picker" onClick={(e) => e.stopPropagation()}>
        {!result ? (
          <>
            <h2>🎼 Set up a song from a tab</h2>
            <p className="hint">
              Pick a Guitar Pro tab you downloaded. The song gets the tab's own sections and bar counts, tempo, chords, the rhythm guitar's strum, and the words in time when
              the tab has a vocal part. Nothing leaves this Mac and there's no AI cost.
            </p>
            {files === null ? (
              <p className="hint">Looking in Downloads…</p>
            ) : files.length ? (
              <ul className="tab-files">
                {files.map((f) => (
                  <li key={f.name}>
                    <button className="song-row" disabled={!!busy} onClick={() => void fromDownloads(f.name)}>
                      <b>{f.name.replace(/\.[a-z0-9]+$/i, '')}</b>
                      <small>
                        {when(f.mtime)}
                        {busy === f.name ? ' · reading…' : ''}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No Guitar Pro tabs in Downloads yet.</p>
            )}
            <label className="btn">
              Choose another file…
              <input
                type="file"
                accept=".gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) await read(f.name, new Uint8Array(await f.arrayBuffer()))
                }}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <TabPreview {...result} onBack={() => setResult(null)} onUse={() => onUse(result.song)} />
        )}
      </div>
    </div>
  )
}

function TabPreview({ song, info, onBack, onUse }: { song: SongSetup; info: TabInfo; file: string; onBack: () => void; onUse: () => void }) {
  const bars = (name: string) => (song.sections.find((s) => s.name === name)?.chords.reduce((a, c) => a + c.beats, 0) ?? 0) / 4
  return (
    <>
      <h2>
        {song.title} <span className="hint">– {song.artist}</span>
      </h2>
      <p className="hint">
        {song.key} {song.minor ? 'minor' : 'major'} · {song.bpm} BPM{info.tempoChanges ? ' (the tab changes tempo; this plays at one tempo)' : ''} · {info.meter} · {info.bars} bars ·
        chords {info.chordsFrom === 'tab' ? `named in the tab (${info.chordTrack})` : 'worked out from the notes'}
        {info.rhythmTrack ? ` · strum from ${info.rhythmTrack}` : ''}
      </p>
      <p className="tab-words">
        {info.words
          ? `🎤 ${info.words} words with their timing from "${info.vocalTrack}": the singer's screen follows them word by word.`
          : info.phrases
            ? `🎤 "${info.vocalTrack}" has the vocal melody (${info.phrases} phrases) but no words: add the words with 🎤 Lyrics and each line lands on its phrase.`
            : '🎤 No vocal part in this tab: add the words with 🎤 Lyrics and tap-sync them once.'}
      </p>
      <div className="an-sections">
        {song.form.map((name, i) => {
          const sec = song.sections.find((s) => s.name === name)
          return (
            <div key={i} className="an-row">
              <span className="an-name">
                {i + 1}. {name}
              </span>
              <span className="an-len">{bars(name)} bars</span>
              <span className="an-chords">
                {sec?.chords
                  .slice(0, 8)
                  .map((c) => c.chord)
                  .join('  ')}
                {(sec?.chords.length ?? 0) > 8 ? '  …' : ''}
                {sec?.strum ? <code className="tab-strum">{sec.strum}</code> : null}
              </span>
            </div>
          )
        })}
      </div>
      <div className="row">
        <button className="btn primary" onClick={onUse}>
          ▶ Use this song
        </button>
        <button className="btn" onClick={onBack}>
          ← Other tab
        </button>
      </div>
    </>
  )
}
