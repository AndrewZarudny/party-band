// The song goal on the Lessons home: pick a song and a date; then how it is going and the next step.
import { useState } from 'react'
import type { Progress } from '../types'
import { isPassed } from '../progress'
import { goalPace, loadGoal, pathShare, saveGoal } from '../goal'
import { partsOf, songPath } from '../../music/songPath'
import type { MapSong, MapSongPart } from './LessonMap'

const STATUS = { done: 'Band-ready. Goal reached.', ahead: 'Ahead of schedule.', 'on track': 'On track.', behind: 'Behind schedule: the Song block works on it every session.', past: 'The date has passed. Pick a new one.' } as const

const inWeeks = (n: number) => {
  const d = new Date(Date.now() + n * 7 * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dateLabel = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' })

export function GoalCard({ progress, songs, songParts, onOpen, onSong }: { progress: Progress; songs: MapSong[]; songParts: MapSongPart[]; onOpen: (id: string) => void; onSong: (id: string) => void }) {
  const [goal, setGoal] = useState(loadGoal)
  const [songId, setSongId] = useState('')
  const [by, setBy] = useState(() => inWeeks(8))
  if (!songs.length) return null
  const set = (g: ReturnType<typeof loadGoal>) => {
    saveGoal(g)
    setGoal(g)
  }

  if (!goal) {
    const pick = songId || songs[0].id
    return (
      <section className="ls-goal-card" aria-label="Song goal">
        <p className="ls-weekly-h">Your goal</p>
        <div className="ls-then-row">
          <span>Band-ready with</span>
          <select value={pick} onChange={(ev) => setSongId(ev.target.value)} aria-label="Song">
            {songs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <span>by</span>
          <input type="date" value={by} min={inWeeks(1)} onChange={(ev) => setBy(ev.target.value)} aria-label="Date" />
          <button className="ls-btn small primary" onClick={() => set({ songId: pick, title: songs.find((s) => s.id === pick)?.title ?? 'Your song', by, setAt: Date.now() })}>
            Set goal
          </button>
        </div>
      </section>
    )
  }

  const song = songs.find((s) => s.id === goal.songId)
  if (!song) return null
  const parts = partsOf(songParts, song.id, (id) => isPassed(progress, id))
  const path = songPath(parts, song.levels)
  const pace = goalPace(goal, pathShare(parts, song.levels), new Date())
  const go = () => (path.next?.kind === 'part' ? onOpen(path.next.id) : onSong(song.id))
  return (
    <section className={`ls-goal-card ${pace.status.replace(' ', '-')}`} aria-label="Song goal">
      <p className="ls-weekly-h">Your goal</p>
      <p>
        <b>{goal.title}</b>, band-ready by {dateLabel(goal.by)} · <span className="ls-num">{Math.round(pace.share * 100)}%</span>
        {pace.daysLeft >= 0 && pace.status !== 'done' && (
          <>
            {' '}
            · <span className="ls-num">{pace.daysLeft}</span> days left
          </>
        )}
      </p>
      <div className="ls-goal-bar" aria-hidden>
        <i style={{ width: `${Math.round(pace.share * 100)}%` }} />
        <s style={{ left: `${Math.round(pace.due * 100)}%` }} title="Where you'd be on schedule" />
      </div>
      <div className="ls-then-row">
        <span className="ls-muted">{STATUS[pace.status]}</span>
        {path.next && (
          <button className="ls-btn small primary" onClick={go}>
            Next: {path.nextLabel}
          </button>
        )}
        <button className="ls-btn small ghost" onClick={() => set(null)}>
          Change goal
        </button>
      </div>
    </section>
  )
}
