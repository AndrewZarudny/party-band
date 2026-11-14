import { sectionJump, segmentAt, type Segment } from '../music/songForm'

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * The whole song as a bar of sections (solos highlighted) with a moving marker and time.
 * With `onSeek` (host only), clicking a section jumps there, and ◀ / ▶ step a section (▶ is the next pedal).
 * With `onLoop`, 🔁 loops the section playing (or the one clicked last); `loopIdx` is the looped one.
 */
export function SongProgress({
  segments,
  beat,
  bpm,
  ended,
  onSeek,
  loopIdx = null,
  onLoop,
}: {
  segments: Segment[]
  beat: number
  bpm: number
  ended?: boolean
  onSeek?: (beat: number) => void
  loopIdx?: number | null
  onLoop?: (idx: number | null) => void
}) {
  const total = segments.reduce((a, s) => a + s.beats, 0)
  if (!total) return null
  const pos = ended ? total : Math.max(0, Math.min(beat, total))
  const spb = 60 / bpm
  const prev = onSeek ? sectionJump(segments, pos, -1) : null
  const next = onSeek && !ended ? sectionJump(segments, pos, 1) : null
  const here = Math.max(0, segmentAt(segments, pos))
  return (
    <div className="song-progress">
      {onSeek && (
        <button className="btn small sp-step" disabled={prev === null} onClick={() => prev !== null && onSeek(prev)} title="Back to the start of this section (twice: the one before)">
          ◀
        </button>
      )}
      <div className="sp-bar">
        {segments.map((s, i) => {
          const done = pos >= s.start + s.beats
          const now = pos >= s.start && pos < s.start + s.beats
          return (
            <button
              key={i}
              className={`sp-seg ${s.solo ? 'solo' : ''} ${done ? 'done' : ''} ${now ? 'now' : ''} ${loopIdx === i ? 'looped' : ''}`}
              style={{ flexGrow: s.beats }}
              title={`${s.section} · ${clock(s.start * spb)}${onSeek ? ' · click to jump here' : ''}`}
              disabled={!onSeek}
              onClick={() => onSeek?.(s.start)}
            >
              <span>{s.section}</span>
            </button>
          )
        })}
        <i className="sp-marker" style={{ left: `${(pos / total) * 100}%` }} />
      </div>
      {onSeek && (
        <button className="btn small sp-step" disabled={next === null} onClick={() => next !== null && onSeek(next)} data-pedal="next" title="Next section (the next pedal)">
          ▶
        </button>
      )}
      {onLoop && (
        <button
          className={`btn small sp-step ${loopIdx !== null ? 'on' : ''}`}
          aria-pressed={loopIdx !== null}
          onClick={() => onLoop(loopIdx !== null ? null : here)}
          title={loopIdx !== null ? `Looping ${segments[loopIdx]?.section}: click to play on` : `Loop ${segments[here]?.section} until you stop it`}
        >
          🔁{loopIdx !== null ? ` ${segments[loopIdx]?.section}` : ''}
        </button>
      )}
      <div className="sp-time">
        {ended ? (
          <b>🏁 End of song</b>
        ) : (
          <>
            {clock(pos * spb)} / {clock(total * spb)}
          </>
        )}
      </div>
    </div>
  )
}
