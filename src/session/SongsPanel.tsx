import { useState } from 'react'
import type { SongSetup } from '../music/songForm'
import { sectionBars } from '../music/songForm'
import { clearHistory, loadFavorites, loadHistory, loadLibrary, removeFromLibrary, setFavorite, songKey } from '../music/songLibrary'
import { SongSetupBar } from './SongSetupBar'

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const when = (t: number) => {
  const d = new Date(t)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** The Songs tab: set up a song, the band's song list, and the history of what was played. */
export function SongsPanel(props: {
  song: SongSetup | null
  onPlay: (s: SongSetup | null) => void
  onUpdate: (s: SongSetup) => void
  singers: string[]
  historyTick: number
}) {
  const [, refresh] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [favOnly, setFavOnly] = useState(false)
  const favs = loadFavorites()
  // Favourites first; otherwise most recently set up first.
  const library = loadLibrary()
    .map((s, i) => ({ s, i, fav: favs.has(songKey(s)) }))
    .sort((a, b) => Number(b.fav) - Number(a.fav) || a.i - b.i)
    .map((x) => x.s)
  const shown = favOnly ? library.filter((s) => favs.has(songKey(s))) : library
  const history = loadHistory()
  const current = props.song ? songKey(props.song) : ''
  const totalMin = (s: SongSetup) => {
    const beats = s.form.reduce((a, n) => a + (sectionBars(s.sections.find((x) => x.name === n) ?? { name: n, chords: [], solo: false }) * 4), 0)
    return mmss((beats * 60) / s.bpm)
  }

  return (
    <div className="songs-panel">
      <SongSetupBar song={props.song} onPlay={props.onPlay} onUpdate={props.onUpdate} singers={props.singers} />

      <div className="songs-cols">
        <section className="song-lib">
          <div className="row spread">
            <h3>Our songs ({library.length})</h3>
            {favs.size > 0 && (
              <span className="seg-group">
                <button className={`seg ${favOnly ? '' : 'on'}`} onClick={() => setFavOnly(false)}>
                  All
                </button>
                <button className={`seg ${favOnly ? 'on' : ''}`} onClick={() => setFavOnly(true)}>
                  ★ Favourites ({library.filter((s) => favs.has(songKey(s))).length})
                </button>
              </span>
            )}
          </div>
          {!library.length && <p className="hint">Songs you set up appear here, with their lyrics and form changes.</p>}
          <ul>
            {shown.map((s) => (
              <li key={songKey(s)} className={songKey(s) === current ? 'on' : ''}>
                <button
                  className={`icon-btn fav ${favs.has(songKey(s)) ? 'on' : ''}`}
                  title={favs.has(songKey(s)) ? 'Remove from favourites' : 'Add to favourites'}
                  aria-pressed={favs.has(songKey(s))}
                  onClick={() => {
                    setFavorite(songKey(s), !favs.has(songKey(s)))
                    refresh((n) => n + 1)
                  }}
                >
                  {favs.has(songKey(s)) ? '★' : '☆'}
                </button>
                <button className="song-row" onClick={() => props.onPlay(s)} title="Load this song">
                  <b>{s.title}</b> <span>{s.artist}</span>
                  <small>
                    {s.key}
                    {s.minor ? 'm' : ''} · {s.bpm} BPM · {totalMin(s)}
                    {s.lyrics?.some(Boolean) ? ' · 🎤 lyrics' : ''}
                  </small>
                </button>
                <button
                  className="icon-btn"
                  title="Remove from the list"
                  onClick={() => {
                    removeFromLibrary(songKey(s))
                    setFavorite(songKey(s), false)
                    if (songKey(s) === current) props.onPlay(null)
                    refresh((n) => n + 1)
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="song-hist">
          <div className="row spread">
            <h3>History</h3>
            {history.length > 0 && (
              <button
                className="link"
                onClick={() => {
                  if (confirm('Clear the play history?')) {
                    clearHistory()
                    refresh((n) => n + 1)
                  }
                }}
              >
                clear
              </button>
            )}
          </div>
          {!history.length && <p className="hint">Every song you play is logged here: when, how long, and who played.</p>}
          <ul>
            {(showAll ? history : history.slice(0, 12)).map((h) => {
              const lib = library.find((s) => songKey(s) === h.key)
              return (
                <li key={h.id}>
                  <div className="hist-main">
                    <b>{h.title}</b> <span>{h.artist}</span>
                    <small>
                      {when(h.startedAt)} · {mmss(h.playedSec)}
                      {h.totalSec ? ` / ${mmss(h.totalSec)}` : ''} {h.finished ? '· ✓ played to the end' : h.endedAt ? '· stopped' : '· playing'}
                      {h.withRecording ? ' · 🎧 with the record' : ''}
                    </small>
                    {h.players.length > 0 && <small className="hist-players">{h.players.join(' · ')}</small>}
                  </div>
                  {lib && (
                    <button className="btn small" onClick={() => props.onPlay(lib)}>
                      ▶ again
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {history.length > 12 && (
            <button className="link" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'show less' : `show all ${history.length}`}
            </button>
          )}
        </section>
      </div>
    </div>
  )
}
