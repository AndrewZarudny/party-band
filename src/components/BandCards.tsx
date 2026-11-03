import { useState, useSyncExternalStore } from 'react'
import type { Instrument, Member, RolePref } from '../music/band'
import { INSTRUMENTS } from '../music/band'
import type { Feel, KeysVoicing } from '../music/parts'
import { bassNotes, guitarShape, topTriad } from '../music/parts'
import type { LyricLine } from '../music/lyrics'
import { amdmSearchUrl, geniusSearchUrl, geniusSongUrl, splitSongTitle } from '../music/lyricsLinks'
import type { Chord } from '../music/theory'
import { noteName, pc } from '../music/theory'
import { ChordDiagram, Keyboard, RhythmGrid } from './PartViews'

export interface CardContext {
  chord: Chord
  next: Chord | null
  feel: Feel
  eighth: number | null
  soloist: Member | null
  scaleLabel: string
  scalePcs: number[]
  keyName: string
  flats: boolean
  boxFret: number
  keys: KeysVoicing
  nextKeys: KeysVoicing | null
  // Song form, for the singer: words per form entry, where we are, and what's next.
  lyrics?: string[]
  formIdx?: number
  section?: string
  nextSection?: string
  beatsToNext?: number
  songTitle?: string // "Title – Artist", for the singer's lyrics link
  lyricLines?: LyricLine[] // every sung line on the song's beat clock (karaoke)
  songBeat?: number // beats since the song's start
  strum?: string // this section's rhythm guitar pattern (from the song); else the feel's
  technique?: string
}

const names = (pcs: number[], flats: boolean) => pcs.map((p) => noteName(p, flats)).join(' ')

export function MemberCard({ m, ctx }: { m: Member; ctx: CardContext }) {
  const info = INSTRUMENTS[m.instrument]
  const lead = ctx.soloist?.id === m.id
  const role = lead ? 'Solo' : m.instrument === 'drums' ? 'Groove' : m.instrument === 'bass' ? 'Bass line' : m.instrument === 'vocals' ? 'Vocals' : 'Rhythm'
  return (
    <div className={`member-card ${lead ? 'lead' : ''} ${m.me ? 'me' : ''}`}>
      <div className="mc-head">
        <span className="mc-icon">{info.icon}</span>
        <span className="mc-name">{m.name}</span>
        <span className="mc-inst">{info.label}</span>
        <span className={`mc-role ${lead ? 'solo' : ''}`}>{role}</span>
      </div>
      {lead ? <LeadPart m={m} ctx={ctx} /> : <AccompanyPart m={m} ctx={ctx} />}
      {m.instrument !== 'vocals' && !!ctx.lyricLines?.length && !!ctx.section && <CardWords lines={ctx.lyricLines} beat={ctx.songBeat ?? 0} />}
    </div>
  )
}

// Whether instrument cards show the words: one choice per device (all cards on a screen follow it).
const WORDS_KEY = 'card-words'
const wordsListeners = new Set<() => void>()
const readWords = () => {
  try {
    return localStorage.getItem(WORDS_KEY) !== 'off'
  } catch {
    return true
  }
}
function setWords(on: boolean) {
  try {
    localStorage.setItem(WORDS_KEY, on ? 'on' : 'off')
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
  wordsListeners.forEach((l) => l())
}
const subscribeWords = (l: () => void) => {
  wordsListeners.add(l)
  return () => wordsListeners.delete(l)
}

/** The words on a player's card, small (the current line and the next), with a switch to hide them. */
function CardWords({ lines, beat }: { lines: LyricLine[]; beat: number }) {
  const show = useSyncExternalStore(subscribeWords, readWords)
  return (
    <div className={`mc-words ${show ? '' : 'off'}`}>
      <button className="link mc-words-toggle" onClick={() => setWords(!show)}>
        {show ? 'hide words' : '🎤 show words'}
      </button>
      {show && <Karaoke lines={lines} beat={beat} playing compact />}
    </div>
  )
}

function LeadPart({ m, ctx }: { m: Member; ctx: CardContext }) {
  return (
    <div className="mc-body">
      <p className="mc-big">
        Improvise in <b>{ctx.keyName} {ctx.scaleLabel.toLowerCase()}</b>
      </p>
      <p className="mc-notes">
        Scale: <b>{names(ctx.scalePcs, ctx.flats)}</b>
      </p>
      <p className="mc-notes">
        Aim for <b className="tone-now">{names(ctx.chord.tones, ctx.flats)}</b> over {ctx.chord.symbol}
        {ctx.next && (
          <>
            , then <b className="tone-next">{names(ctx.next.tones, ctx.flats)}</b> on {ctx.next.symbol}
          </>
        )}
      </p>
      {m.instrument === 'keys' && <Keyboard right={ctx.keys.right.filter((n) => n >= 60)} scale={ctx.scalePcs} from={48} to={83} flats={ctx.flats} />}
      {m.instrument !== 'keys' && <p className="mc-notes">Position: box starting at fret {ctx.boxFret}{m.me ? ' (fretboard and phrase below)' : ''}</p>}
      <p className="mc-tip">{ctx.feel.leadTip}</p>
    </div>
  )
}

/** The singer: the words in time with the song, and which section is coming. */
function VocalPart({ ctx }: { ctx: CardContext }) {
  const bars = ctx.beatsToNext !== undefined ? Math.ceil(ctx.beatsToNext / 4) : 0
  return (
    <div className="mc-body vocal">
      {ctx.section && (
        <div className="vocal-head">
          <b>{ctx.section}</b>
          {ctx.nextSection && (
            <span className={bars <= 1 ? 'soon' : ''}>
              {ctx.nextSection} in {bars} bar{bars === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}
      {ctx.lyricLines?.length ? (
        <Karaoke lines={ctx.lyricLines} beat={ctx.songBeat ?? 0} playing={!!ctx.section} />
      ) : (
        <p className="mc-tip">{ctx.section ? 'Follow the sections here and read the words on the lyrics page:' : 'Words appear here when the host plays a song.'}</p>
      )}
      {ctx.songTitle && !ctx.lyricLines?.length && <LyricsLink songTitle={ctx.songTitle} />}
      <p className="mc-notes">
        Key of <b>{ctx.keyName}</b> · chord <b className="tone-now">{ctx.chord.symbol}</b> (notes {names(ctx.chord.tones, ctx.flats)})
      </p>
    </div>
  )
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** How much of a line is sung by now: word by word when the words have times (from a tab), else evenly. */
function fillOf(line: LyricLine, beat: number): number {
  const words = line.text.split(' ')
  if (!line.words || line.words.length !== words.length) return clamp01((beat - line.start) / Math.max(0.5, line.end - line.start))
  let w = -1
  while (w + 1 < words.length && line.words[w + 1] <= beat) w++
  if (w < 0) return 0
  const end = Math.min(line.words[w + 1] ?? line.end, line.words[w] + 2)
  const before = words.slice(0, w).reduce((a, x) => a + x.length + 1, 0)
  return clamp01((before + words[w].length * clamp01((beat - line.words[w]) / Math.max(0.25, end - line.words[w]))) / line.text.length)
}

/**
 * Karaoke: the line being sung is large with a fill sweeping across it in time; the next line shows
 * early, and a bar before it starts it lights up with a beat countdown so the singer comes in on time.
 */
export function Karaoke({ lines, beat, playing, compact = false }: { lines: LyricLine[]; beat: number; playing: boolean; compact?: boolean }) {
  let cur = -1
  while (cur + 1 < lines.length && lines[cur + 1].start <= beat) cur++
  const now = cur >= 0 && beat < lines[cur].end ? lines[cur] : null
  const fill = now ? fillOf(now, beat) : 0
  const next = lines[cur + 1]
  const toNext = next ? next.start - beat : Infinity
  const ready = playing && toNext <= 4 // the last bar before the next line: count it in
  const after = compact ? [] : lines.slice(cur + 2, cur + 4)
  return (
    <div className={`karaoke ${compact ? 'compact' : ''}`}>
      {!compact && cur >= 0 && (now ? cur > 0 && <p className="k-prev">{lines[cur - 1].text}</p> : <p className="k-prev">{lines[cur].text}</p>)}
      {now ? (
        <p className="k-now" style={{ '--fill': `${Math.round(fill * 100)}%` } as React.CSSProperties}>
          {now.text}
        </p>
      ) : (
        <p className="k-wait">{!playing ? 'Ready' : next ? (toNext > 4 ? `♪ next line in ${Math.ceil(toNext / 4)} bar${Math.ceil(toNext / 4) === 1 ? '' : 's'}` : '♪') : '♪ end of the words'}</p>
      )}
      {next && (
        <p className={`k-next ${ready ? 'ready' : ''} ${now ? '' : 'up'}`}>
          {ready && (
            <span className="k-count" aria-label={`in ${Math.ceil(toNext)} beats`}>
              {[4, 3, 2, 1].map((n) => (
                <i key={n} className={toNext <= n ? 'on' : ''} />
              ))}
            </span>
          )}
          {next.text}
        </p>
      )}
      {after.map((l, i) => (
        <p key={cur + 2 + i} className="k-later">
          {l.text}
        </p>
      ))}
    </div>
  )
}

/** One tap to the song's lyrics page (opened by the singer; Fretwise doesn't copy lyrics). */
function LyricsLink({ songTitle }: { songTitle: string }) {
  const { title, artist } = splitSongTitle(songTitle)
  return (
    <div className="lyrics-link">
      <a className="btn primary big" href={geniusSongUrl(title, artist)} target="_blank" rel="noreferrer">
        📖 Open “{title}” lyrics ↗
      </a>
      <a className="btn big" href={amdmSearchUrl(title, artist)} target="_blank" rel="noreferrer">
        🎸 AmDm: words + chords ↗
      </a>
      <a className="link" href={geniusSearchUrl(title, artist)} target="_blank" rel="noreferrer">
        Genius page wrong? search instead
      </a>
    </div>
  )
}

function AccompanyPart({ m, ctx }: { m: Member; ctx: CardContext }) {
  const { chord, next, feel, eighth } = ctx
  if (m.instrument === 'vocals') return <VocalPart ctx={ctx} />
  if (m.instrument === 'keys') {
    return (
      <div className="mc-body">
        <Keyboard right={ctx.keys.right} left={ctx.keys.left} flats={ctx.flats} />
        <p className="mc-notes">
          Right hand <b className="tone-now">{ctx.keys.right.map((n) => noteName(n, ctx.flats)).join(' ')}</b>, left hand <b className="tone-root">{noteName(ctx.keys.left, ctx.flats)}</b>
          {next && ctx.nextKeys && (
            <span className="mc-next">
              {' '}
              → next {next.symbol}: {ctx.nextKeys.right.map((n) => noteName(n, ctx.flats)).join(' ')}
            </span>
          )}
        </p>
        <RhythmGrid rows={[{ cells: [...feel.keys] }]} now={eighth} />
        <p className="mc-tip">{feel.keysTip}</p>
      </div>
    )
  }
  if (m.instrument === 'bass') {
    const notes = bassNotes(feel.bass, chord)
    const rootE = pc(chord.root - 4)
    const rootA = pc(chord.root - 9)
    return (
      <div className="mc-body">
        <p className="mc-big">
          Root: <b className="tone-root">{noteName(chord.root, ctx.flats)}</b>
          {next && <span className="mc-next"> → next {noteName(next.root, ctx.flats)}</span>}
        </p>
        <p className="mc-notes">
          E string fret {rootE} · or A string fret {rootA}
        </p>
        <RhythmGrid rows={[{ cells: [...feel.bass].map((c, i) => (notes[i] !== null ? noteName(notes[i]!, ctx.flats) : c)) }]} now={eighth} />
        <p className="mc-tip">{feel.bassTip}</p>
      </div>
    )
  }
  if (m.instrument === 'drums') {
    return (
      <div className="mc-body">
        <RhythmGrid
          rows={[
            { label: 'Hat', cells: [...feel.drums.hat] },
            { label: 'Snare', cells: [...feel.drums.snare] },
            { label: 'Kick', cells: [...feel.drums.kick] },
          ]}
          now={eighth}
        />
        <p className="mc-tip">Count everyone in: “1, 2, 3, 4”. Keep it simple and steady{feel.swing ? ', with a shuffle (long-short) feel' : ''}.</p>
      </div>
    )
  }
  // Guitars
  const triad = m.instrument === 'electric' ? topTriad(chord, 7) : []
  return (
    <div className="mc-body">
      <div className="mc-chords">
        <ChordDiagram shape={guitarShape(chord)} name={chord.symbol} size={1.25} />
        {next && (
          <div className="mc-next-chord">
            <span>next</span>
            <ChordDiagram shape={guitarShape(next)} name={next.symbol} size={0.8} />
          </div>
        )}
      </div>
      <RhythmGrid rows={[{ cells: [...(ctx.strum || feel.strum)] }]} now={eighth} />
      {ctx.technique ? (
        <p className="mc-technique">
          🎸 {ctx.section ? <b>{ctx.section}: </b> : null}
          {ctx.technique}
        </p>
      ) : null}
      <p className="mc-tip">{ctx.strum ? 'D = down, U = up, x = muted chop, – = let it ring. Follow the green box.' : feel.guitarTip}</p>
      {triad.length > 0 && (
        <p className="mc-notes">
          Lighter option, top 3 strings (G B e): frets <b>{triad.map((t) => t.fret).join(' – ')}</b>
        </p>
      )}
    </div>
  )
}

/** Edit who is playing tonight. */
export function BandSetup({ band, setBand, live }: { band: Member[]; setBand: (b: Member[]) => void; live?: boolean }) {
  const [editing, setEditing] = useState(false)
  const update = (id: string, patch: Partial<Member>) => setBand(band.map((m) => (m.id === id ? { ...m, ...patch } : patch.me ? { ...m, me: false } : m)))
  return (
    <div className="band-setup">
      <span className="label">{live ? 'Band (live)' : "Tonight's band"}</span>
      {!editing &&
        band.map((m) => (
          <span key={m.id} className={`band-chip ${m.me ? 'me' : ''}`}>
            {INSTRUMENTS[m.instrument].icon} {m.name}
            <small>{INSTRUMENTS[m.instrument].label}</small>
          </span>
        ))}
      <button className="btn small" onClick={() => setEditing(!editing)}>
        {editing ? 'Done' : 'Edit band'}
      </button>
      {editing && (
        <div className="band-edit">
          {band.map((m) => (
            <div key={m.id} className="band-row">
              <input value={m.name} disabled={live && !m.me} onChange={(e) => update(m.id, { name: e.target.value })} aria-label="Name" />
              <select value={m.instrument} disabled={live && !m.me} onChange={(e) => update(m.id, { instrument: e.target.value as Instrument })}>
                {Object.entries(INSTRUMENTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.icon} {v.label}
                  </option>
                ))}
              </select>
              <select value={m.role} onChange={(e) => update(m.id, { role: e.target.value as RolePref })} title="Role">
                <option value="auto">Takes solos in turn</option>
                <option value="lead">Always lead</option>
                <option value="rhythm">Never solos</option>
              </select>
              <label className="toggle-inline" title="The app listens to this player through the Scarlett" hidden={live}>
                <input type="radio" name="me" checked={!!m.me} onChange={() => update(m.id, { me: true })} /> me
              </label>
              <button className="icon-btn" title="Remove" onClick={() => setBand(band.filter((x) => x.id !== m.id))} disabled={band.length <= 1 || live}>
                ×
              </button>
            </div>
          ))}
          {!live && (
            <button
              className="btn small"
              onClick={() => setBand([...band, { id: `p${Date.now()}`, name: `Player ${band.length + 1}`, instrument: 'acoustic', role: 'auto' }])}
            >
              + Add player
            </button>
          )}
          {live && <span className="hint">Players join from their phones; you set their solo roles here.</span>}
        </div>
      )}
    </div>
  )
}
