import type { Segment } from '../music/songForm'

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * The whole song as a bar of sections (solos highlighted) with a moving marker and time.
 * With `onSeek` (host only), clicking a section jumps there.
 */
export function SongProgress({ segments, beat, bpm, ended, onSeek }: { segments: Segment[]; beat: number; bpm: number; ended?: boolean; onSeek?: (beat: number) => void }) {
  const total = segments.reduce((a, s) => a + s.beats, 0)
  if (!total) return null
  const pos = ended ? total : Math.max(0, Math.min(beat, total))
  const spb = 60 / bpm
  return (
    <div className="song-progress">
      <div className="sp-bar">
        {segments.map((s, i) => {
          const done = pos >= s.start + s.beats
          const now = pos >= s.start && pos < s.start + s.beats
          return (
            <button
              key={i}
              className={`sp-seg ${s.solo ? 'solo' : ''} ${done ? 'done' : ''} ${now ? 'now' : ''}`}
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
