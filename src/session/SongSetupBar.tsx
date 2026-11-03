import { useState } from 'react'
import type { Cost } from '../aiCost'
import { describeCost, usd, useAiStatus } from '../aiCost'
import type { SongSetup } from '../music/songForm'
import { sectionBars } from '../music/songForm'
import { noteName, parseChord, pc, prefersFlats } from '../music/theory'
import { matchLyrics } from '../music/lyrics'
import { amdmSearchUrl, geniusSongUrl } from '../music/lyricsLinks'
import { TabPicker } from './TabPicker'

/** "Play a song": AI sets up the jam with the song's key, tempo and form (host only). */
export function SongSetupBar({ song, onPlay, onUpdate, singers = [] }: { song: SongSetup | null; onPlay: (s: SongSetup | null) => void; onUpdate: (s: SongSetup) => void; singers?: string[] }) {
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [tabOpen, setTabOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ song: SongSetup; cost?: Cost } | null>(null)
  const [tick, setTick] = useState(0)
  const status = useAiStatus(tick)

  const setUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    setError('')
    try {
      const r = (await (await fetch('/api/song-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })).json()) as {
        song?: SongSetup
        cost?: Cost
        error?: string
      }
      if (r.error || !r.song) throw new Error(r.error ?? 'No answer')
      setPreview({ song: r.song, cost: r.cost })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setTick((t) => t + 1)
    }
  }

  /** A song from a tab. Without words in the tab, words already pasted for this song move onto its form. */
  const useTab = (t: SongSetup) => {
    setTabOpen(false)
    if (!t.lyrics?.some(Boolean) && song?.lyrics?.some(Boolean) && song.title.toLowerCase() === t.title.toLowerCase()) {
      const text = song.lyrics.map((l, i) => (l ? `[${song.form[i]}]\n${l}` : '')).filter(Boolean).join('\n\n')
      const solos = new Set(t.sections.filter((x) => x.solo).map((x) => x.name))
      onPlay({ ...t, lyrics: matchLyrics(text, t.form, solos) })
    } else onPlay(t)
  }

  return (
    <div className="song-setup">
      <form className="row" onSubmit={setUp}>
        <span className="label">Play a song</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Wonderwall Oasis, Zombie, Knockin' on Heaven's Door" />
        <button className="btn small primary" disabled={busy || !query.trim() || status?.ai === false}>
          {busy ? 'Setting up…' : 'Set up'}
          {status?.ai && !busy && <span className="cost-tag">~{usd(status.estimates['song-setup'] ?? 0.02)}</span>}
        </button>
        <button type="button" className="btn small" onClick={() => setTabOpen(true)} title="Sections, chords, strum and words from a Guitar Pro tab you downloaded (free)">
          🎼 From a tab
        </button>
        {song && (
          <span className="playing">
            🎵 <b>{song.title}</b> – {song.artist}
            <button type="button" className="btn small" onClick={() => setPreview({ song })} title="Section lengths and order">
              ✎ Form
            </button>
            <button type="button" className="btn small" onClick={() => setLyricsOpen(true)} title="Words for the singer's screen">
              🎤 Lyrics{song.lyrics?.some(Boolean) ? ' ✓' : ''}
            </button>
            <KeyShift song={song} onUpdate={onUpdate} />
            <button type="button" className="link" onClick={() => onPlay(null)}>
              back to free jam
            </button>
          </span>
        )}
      </form>
      {song && singers.length > 0 && !song.lyrics?.some(Boolean) && !lyricsOpen && (
        <div className="lyrics-prompt">
          🎤 {singers.join(', ')} {singers.length > 1 ? 'have' : 'has'} a one-tap link to the {song.title} lyrics page, with section cues in Fretwise. For words inside the
          app, timed to each section, paste them once:
          <button className="btn small" onClick={() => setLyricsOpen(true)}>
            Add lyrics (optional)
          </button>
        </div>
      )}
      {tabOpen && <TabPicker onUse={useTab} onClose={() => setTabOpen(false)} />}
      {lyricsOpen && song && (
        <LyricsEditor
          song={song}
          onClose={() => setLyricsOpen(false)}
          onSave={(lyrics) => {
            onUpdate({ ...song, lyrics })
            setLyricsOpen(false)
          }}
        />
      )}
      {status?.ai === false && <p className="hint">Add ANTHROPIC_API_KEY to .env.local to set up songs with AI.</p>}
      {error && <div className="error">{error}</div>}
      {preview && (
        <div className="song-preview">
          <div className="row spread">
            <b>
              {preview.song.title} – {preview.song.artist}
            </b>
            <button className="link" onClick={() => setPreview(null)}>
              close
            </button>
          </div>
          <p className="hint">
            Key {preview.song.key} {preview.song.minor ? 'minor' : 'major'} · {preview.song.bpm} BPM · {preview.song.feel} feel
            {preview.song.capo ? ` · capo ${preview.song.capo} on the record (chords shown as they sound)` : ''}
          </p>
          <div className="form-chips">
            {preview.song.form.map((n, i) => (
              <span key={i} className={`form-chip ${preview.song.sections.find((s) => s.name === n)?.solo ? 'solo' : ''}`}>
                {n}
              </span>
            ))}
          </div>
          <div className="section-list">
            {preview.song.sections.map((s, si) => (
              <div key={s.name}>
                <span className="label">
                  {s.name}
                  {s.solo ? ' · solo' : ''}
                </span>{' '}
                <span className="rep">
                  <button
                    className="seg"
                    title="Fewer repeats"
                    onClick={() => setPreview({ ...preview, song: withRepeat(preview.song, si, (s.repeat ?? 1) - 1) })}
                  >
                    −
                  </button>
                  ×{s.repeat ?? 1}
                  <button className="seg" title="More repeats" onClick={() => setPreview({ ...preview, song: withRepeat(preview.song, si, (s.repeat ?? 1) + 1) })}>
                    +
                  </button>
                  <small>{sectionBars(s)} bars</small>
                </span>{' '}
                {s.chords.map((c, i) => (
                  <span key={i} className="sec-chord">
                    {c.chord}
                    {c.beats !== 4 && <small>×{c.beats}</small>}
                  </span>
                ))}
              </div>
            ))}
          </div>
          {preview.song.notes && <p className="hint">{preview.song.notes}</p>}
          <div className="row">
            {song && song.title === preview.song.title && song.artist === preview.song.artist && (
              <button
                className="btn primary"
                onClick={() => {
                  // Keep the lyrics and the place in the song; only the section lengths change.
                  onUpdate({ ...preview.song, lyrics: song.lyrics })
                  setPreview(null)
                }}
              >
                Apply changes
              </button>
            )}
            <button
              className={`btn ${song && song.title === preview.song.title ? '' : 'primary'}`}
              onClick={() => {
                onPlay({ ...preview.song, lyrics: song && song.title === preview.song.title ? song.lyrics : preview.song.lyrics })
                setPreview(null)
              }}
            >
              ▶ Play from the start
            </button>
            {preview.cost && <span className="hint cost-line">{describeCost(preview.cost)}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

/** Paste the song's words (from your songbook or lyrics source); they're matched to the form. */
function LyricsEditor({ song, onClose, onSave }: { song: SongSetup; onClose: () => void; onSave: (lyrics: string[]) => void }) {
  const [text, setText] = useState(() => (song.lyrics ?? []).map((l, i) => (l ? `[${song.form[i]}]\n${l}` : '')).filter(Boolean).join('\n\n'))
  const solos = new Set(song.sections.filter((s) => s.solo).map((s) => s.name))
  // AI arrangement: line ranges per form entry, applied to the user's own text (the AI returns no words).
  const [aiRanges, setAiRanges] = useState<{ text: string; ranges: (readonly [number, number] | null)[] } | null>(null)
  const [arranging, setArranging] = useState(false)
  const [arrangeInfo, setArrangeInfo] = useState('')
  const aiStatus = useAiStatus()
  const lines = text.replace(/\r/g, '').split('\n')
  const matched =
    aiRanges && aiRanges.text === text
      ? aiRanges.ranges.map((r) =>
          r
            ? lines
                .slice(r[0] - 1, r[1])
                .filter((l) => !/^\s*\[[^\]\n]+\]\s*$/.test(l)) // section headings are for us, not the singer
                .join('\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim()
            : '',
        )
      : matchLyrics(text, song.form, solos)
  const hasHeadings = /^\s*\[[^\]\n]+\]\s*$/m.test(text)

  const arrange = async (t = text) => {
    if (!t.trim()) return
    setArranging(true)
    setArrangeInfo('')
    try {
      const r = (await (
        await fetch('/api/lyrics-arrange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: song.title, artist: song.artist, form: song.form, solo: [...solos], text: t }),
        })
      ).json()) as { ranges?: (readonly [number, number] | null)[]; cost?: Cost; error?: string }
      if (r.error || !r.ranges) throw new Error(r.error ?? 'No answer')
      setAiRanges({ text: t, ranges: r.ranges })
      setArrangeInfo(describeCost(r.cost))
    } catch (err) {
      setArrangeInfo(err instanceof Error ? err.message : String(err))
    } finally {
      setArranging(false)
    }
  }
  return (
    <div className="panel-backdrop center" onClick={onClose}>
      <div className="dialog lyrics-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>🎤 Lyrics for {song.title}</h2>
        <p className="hint">
          Paste the words from your songbook or the lyrics site you use. Headings like <code>[Verse 1]</code>, <code>[Chorus]</code> put each part in the right
          place; without them, paragraphs fill the sung sections in order. A chorus written once is reused for every chorus.
        </p>
        <div className="row">
          <a className="btn small" href={geniusSongUrl(song.title, song.artist)} target="_blank" rel="noreferrer">
            🔎 Genius
          </a>
          <a className="btn small" href={amdmSearchUrl(song.title, song.artist)} target="_blank" rel="noreferrer">
            🎸 AmDm
          </a>
          <button
            className="btn small"
            title="Paste what you copied from the lyrics page"
            onClick={() =>
              navigator.clipboard
                .readText()
                .then((t) => {
                  if (!t.trim()) return
                  setText(t)
                  // Lyrics pages label sections differently from the song form, so let the AI place them;
                  // the free heading matcher is only the fallback when AI is off.
                  if (aiStatus?.ai) void arrange(t)
                })
                .catch(() => {})
            }
          >
            📋 Paste
          </button>
          <button className="btn small" disabled={arranging || !text.trim()} onClick={() => void arrange()} title="AI maps your text onto the song's sections (it returns line numbers only)">
            {arranging ? 'Arranging…' : '✨ Arrange with AI'}
            {!arranging && aiStatus?.ai && <span className="cost-tag">~{usd(aiStatus.estimates['lyrics-arrange'] ?? 0.002)}</span>}
          </button>
        </div>
        <p className="hint">
          Open the song, select and copy the lyrics, then Paste.{' '}
          {aiStatus?.ai
            ? 'After you paste, the AI places the words into the song’s sections; check the list below.'
            : hasHeadings
              ? 'Headings found: sections are matched by their names.'
              : 'Paragraphs fill the sung sections in order.'}
          {arrangeInfo && <> · {arrangeInfo}</>}
          {aiRanges && aiRanges.text === text && ' · arranged by AI'}
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={'[Verse 1]\n…\n\n[Chorus]\n…'} />
        <div className="lyrics-map">
          {song.form.map((name, i) => (
            <div key={i} className={matched[i] ? 'has' : ''}>
              <span className="label">
                {i + 1}. {name}
              </span>{' '}
              {matched[i] ? matched[i].split('\n')[0] : solos.has(name) ? '(solo)' : '—'}
            </div>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => onSave(matched)}>
            Save lyrics
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="hint">Lyrics stay on this Mac and your band's phones on this Wi-Fi.</p>
      </div>
    </div>
  )
}

/** A copy of the song with section `i` repeated `n` times (1–16). */
function withRepeat(song: SongSetup, i: number, n: number): SongSetup {
  return { ...song, sections: song.sections.map((s, j) => (j === i ? { ...s, repeat: Math.max(1, Math.min(16, n)) } : s)) }
}

/** Play the song in another key: every chord, the key and the solo scale move for everyone. */
function KeyShift({ song, onUpdate }: { song: SongSetup; onUpdate: (s: SongSetup) => void }) {
  const root = parseChord(song.key)?.root
  if (root === undefined) return null
  const t = song.transpose ?? 0
  const name = (n: number) => noteName(root + n, prefersFlats(pc(root + n), song.minor)) + (song.minor ? 'm' : '')
  const set = (n: number) => onUpdate({ ...song, transpose: Math.max(-6, Math.min(6, n)) })
  return (
    <span className="key-shift" title="Play the song in another key: chords, key and solos change for everyone">
      <span className="label">Key</span>
      <button type="button" className="seg" disabled={t <= -6} onClick={() => set(t - 1)} aria-label="Half a step down">
        −
      </button>
      <b>{name(t)}</b>
      <button type="button" className="seg" disabled={t >= 6} onClick={() => set(t + 1)} aria-label="Half a step up">
        +
      </button>
      {t !== 0 && (
        <>
          <small>
            {t > 0 ? '+' : ''}
            {t} from {name(0)}
            {t > 0 ? ` · guitars: or capo ${t} with the original shapes` : ''}
          </small>
          <button type="button" className="link" onClick={() => set(0)}>
            original key
          </button>
        </>
      )}
    </span>
  )
}
