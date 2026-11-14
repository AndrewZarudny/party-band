import { useState } from 'react'
import type { SongSetup } from '../music/songForm'
import { sectionBars } from '../music/songForm'
import { clearHistory, loadFavorites, loadHistory, loadLibrary, removeFromLibrary, setFavorite, songKey } from '../music/songLibrary'
import { SongSetupBar } from './SongSetupBar'
import { agoText, learnedState, loadSongNote, normTitle, rehearseList, saveSongNote, songStatus } from '../music/songStatus'
import { loadGoal } from '../lessons/goal'

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
  /** Plays songs back to back: the first is loaded, the next one comes up when it ends. */
  onPlaySet: (songs: SongSetup[]) => void
  singers: string[]
  historyTick: number
}) {
  const [, refresh] = useState(0)
  const [noteOpen, setNoteOpen] = useState<string | null>(null)
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
  const toRehearse = rehearseList(library, history)
  const goal = loadGoal()
  const isGoal = (s: SongSetup) => !!goal && normTitle(goal.title) === normTitle(s.title)
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
          {toRehearse.length > 0 && library.length > 1 && (
            <div className="rehearse-box">
              <b>To rehearse</b>
              <ul>
                {toRehearse.slice(0, 4).map(({ song: s, st }) => (
                  <li key={songKey(s)}>
                    <button className="link" onClick={() => props.onPlay(s)}>
                      {s.title}
                    </button>{' '}
                    <small>{st.rehearse}</small>
                  </li>
                ))}
              </ul>
              {toRehearse.length > 1 && (
                <button className="btn small" onClick={() => props.onPlaySet(toRehearse.slice(0, 4).map((x) => x.song))} title="Each one comes up when the one before ends">
                  ▶ Rehearse {Math.min(4, toRehearse.length)} back to back
                </button>
              )}
            </div>
          )}
          {favOnly && shown.length > 1 && (
            <button className="btn small" onClick={() => props.onPlaySet(shown)} title="Each one comes up when the one before ends">
              ▶ Play the favourites back to back
            </button>
          )}
          <ul>
            {shown.map((s) => {
              const st = songStatus(s, history)
              const learned = learnedState(s.title)
              const note = loadSongNote(songKey(s))
              return (
                <li key={songKey(s)} className={`${songKey(s) === current ? 'on' : ''} ${isGoal(s) ? 'goal' : ''}`}>
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
                  <small className="song-state">
                    {isGoal(s) && <span className="goal-tag">🎯 your goal song</span>}
                    {st.lastAt !== null ? `played ${agoText(st.lastAt)} · ${st.finished}/${st.plays} to the end` : 'not played yet'}
                    {learned?.state === 'ready' && (
                      <span className="ready-tag" title="Your part: a whole run at full tempo in Learn a song">
                        🎸 band-ready
                      </span>
                    )}
                    {learned?.state === 'learning' && (
                      <span title="Your part in Learn a song: parts passed">
                        🎸 {learned.done}/{learned.total} parts
                      </span>
                    )}
                  </small>
                  {note && noteOpen !== songKey(s) && <small className="song-note">📝 {note}</small>}
                </button>
                <button
                  className={`icon-btn ${note ? 'on' : ''}`}
                  title={note ? "Edit the band's notes on this song" : 'Add a note (what to watch, who plays what)'}
                  aria-pressed={noteOpen === songKey(s)}
                  onClick={() => setNoteOpen(noteOpen === songKey(s) ? null : songKey(s))}
                >
                  📝
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
                {noteOpen === songKey(s) && (
                  <textarea
                    className="song-note-edit"
                    autoFocus
                    defaultValue={note}
                    placeholder="Notes for this song: the tricky bit, who sings what, a capo…"
                    onBlur={(e) => {
                      saveSongNote(songKey(s), e.target.value)
                      setNoteOpen(null)
                    }}
                  />
                )}
              </li>
              )
            })}
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
