import { useState, useSyncExternalStore } from 'react'
import { getPracticeSnapshot, subscribePractice } from '../../practice/log'
import { practiceDaySec } from '../../practice/data'
import { useDailyGoal } from '../../practice/goal'
import type { PainLevel, Progress, SessionPlan, StageDef, Stars } from '../types'
import type { SkillStart } from '../../skills/data'
import { STAGES, checkpointOf, lessonById, weeksLabel } from '../data'
import { DINO_STAGES, closestThirdStar, dinoStageFor, eggCracked, isPassed, isUnlocked, levelFor, nextLesson, stageOpen, starsInStage } from '../progress'
import type { ExtraKind } from '../session'
import { knownChords, planDone, pocketOpen } from '../session'
import { REVIEW_BRAKE, standingLabel, standingOf, strugglingList } from '../review'
import { FULL_SPEED, pct } from '../speed'
import { weakestPair } from '../../skills/chords'
import { loadStats } from '../../skills/store'
import { ACHIEVEMENTS } from '../achievements'
import { partsOf, songPath, weakSpots } from '../../music/songPath'
import type { SongLevels } from '../../music/songLevels'
import { PLAN_WEEKS, pace } from '../weeks'
import { CoachCard, WeeklyReview } from './CoachCard'
import { ThenAndNow } from './ThenAndNow'
import { GoalCard } from './GoalCard'
import { CheckInCard } from './CheckInCard'
import { Dino } from './Dino'
import { TodayCard } from './TodayPlan'
import { PocketCard, WeekDots, WeeklyNote } from './SessionCards'

// A guitar pick, point down. The node shape, star pips and bullets all reuse it.
const PICK = 'M20 41C13 34 3 23 3 13.5 3 6 10.5 2.5 20 2.5S37 6 37 13.5C37 23 27 34 20 41Z'

export function PickMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={`ls-pick ${className ?? ''}`} viewBox="0 0 40 44" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={PICK} />
    </svg>
  )
}

// The one star mark: results, pips and inline counts all draw this.
export const STAR = 'M12 2.6l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z'

/** An inline star at 1em, for counts like "12/24". */
export function StarGlyph() {
  return (
    <svg className="ls-star-glyph" viewBox="0 0 24 24" aria-hidden>
      <path d={STAR} />
    </svg>
  )
}

/** Three small stars, filled for each one earned. */
export function StarPips({ stars, className }: { stars: Stars | number; className?: string }) {
  return (
    <span className={`ls-pips ${className ?? ''}`} role="img" aria-label={`${stars} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={i < stars ? 'got' : ''} aria-hidden>
          <path d={STAR} />
        </svg>
      ))}
    </span>
  )
}

function LockGlyph() {
  return (
    <svg className="ls-lock" viewBox="0 0 16 16" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  )
}

// A checkpoint flag: a pole and a pennant.
function FlagGlyph() {
  return (
    <svg className="ls-flag" viewBox="0 0 16 16" aria-hidden>
      <path className="ls-flag-pole" d="M4 14.5V2" />
      <path d="M4 2.5h8l-2 3 2 3H4Z" />
    </svg>
  )
}

export function FootGlyph() {
  return (
    <svg className="ls-foot" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 21c-3.2 0-5.5-2.2-5.5-5 0-2.6 2.4-4.6 5.5-4.6s5.5 2 5.5 4.6c0 2.8-2.3 5-5.5 5Z" />
      <ellipse cx="5.2" cy="9.4" rx="1.9" ry="2.6" transform="rotate(-24 5.2 9.4)" />
      <ellipse cx="12" cy="6" rx="2" ry="2.9" />
      <ellipse cx="18.8" cy="9.4" rx="1.9" ry="2.6" transform="rotate(24 18.8 9.4)" />
    </svg>
  )
}

function DinoName({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState(name)
  if (!edit) {
    return (
      <button
        className="ls-name"
        title="Rename"
        onClick={() => {
          setDraft(name)
          setEdit(true)
        }}
      >
        {name}
      </button>
    )
  }
  const done = () => {
    setEdit(false)
    const n = draft.trim()
    if (n && n !== name) onRename(n)
  }
  return (
    <input
      className="ls-name-input"
      value={draft}
      maxLength={20}
      autoFocus
      aria-label="Dino name"
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={done}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') done()
        if (ev.key === 'Escape') setEdit(false)
      }}
    />
  )
}

function PathNode({ id, mark, extra, progress, current, onOpen }: { id: string; mark: number; extra: boolean; progress: Progress; current: string | null; onOpen: (id: string) => void }) {
  const l = lessonById(id)
  if (!l) return null
  const rec = progress.lessons[id]
  const passed = isPassed(progress, id)
  // Kept or played lessons stay open even in a stage that is still locked.
  const unlocked = isUnlocked(progress, id)
  const state = passed ? 'done' : !unlocked ? 'locked' : id === current ? 'current' : 'open'
  const kind = l.boss ? ', checkpoint' : extra ? ', optional' : ''
  const standing = standingLabel(rec)
  const label = `${l.title}${kind}: ${state === 'locked' ? 'locked' : passed ? `${rec?.stars ?? 0} stars, ${(standing ?? 'passed').toLowerCase()}` : 'open'}`
  // Passed but not learned shows its pass speed when under full tempo; learned items say so.
  const tag = standingOf(rec) === 'learned' ? 'learned' : rec?.passedSpeed !== undefined && rec.passedSpeed < FULL_SPEED - 1e-9 ? pct(rec.passedSpeed) : null
  return (
    <li className={`ls-fret ${l.boss ? 'boss' : ''}`}>
      <button className={`ls-node ${state}`} disabled={!unlocked} onClick={() => onOpen(id)} aria-label={label} aria-current={state === 'current' ? 'step' : undefined}>
        <span className="ls-node-pick">
          <PickMark />
          <span className="ls-node-mark ls-num">{state === 'locked' ? <LockGlyph /> : l.boss ? <FlagGlyph /> : extra ? '' : mark}</span>
        </span>
        <span className="ls-node-title">{l.title}</span>
        {passed && <StarPips stars={rec?.stars ?? 0} />}
        {passed && tag && (
          <span className={`ls-node-tag ls-num ${tag === 'learned' ? 'learned' : ''}`} aria-hidden>
            {tag}
          </span>
        )}
      </button>
    </li>
  )
}

/** A part of one of the player's songs, as a lesson placed in a course week. */
/** One of the player's songs on the map, with its Learn a song levels (for its path). */
export interface MapSong {
  id: string
  title: string
  done: number
  total: number
  full: boolean
  levels: SongLevels | null
  /** Learn a song this week: the busiest part and where it moved. */
  recent?: string | null
}

export interface MapSongPart {
  id: string // lesson id
  song: string
  part: string
  stage: number
}

/** A song part's node: open with its week (or once played), like an optional lesson. */
function SongNode({ sp, open, progress, onOpen }: { sp: MapSongPart; open: boolean; progress: Progress; onOpen: (id: string) => void }) {
  const rec = progress.lessons[sp.id]
  const passed = isPassed(progress, sp.id)
  const unlocked = open || (rec?.plays ?? 0) > 0
  const state = passed ? 'done' : unlocked ? 'open' : 'locked'
  return (
    <li className="ls-fret">
      <button
        className={`ls-node ${state}`}
        disabled={!unlocked}
        onClick={() => onOpen(sp.id)}
        aria-label={`${sp.song}, ${sp.part}: ${state === 'locked' ? 'locked' : passed ? `${rec?.stars ?? 0} stars, passed` : 'open'}`}
      >
        <span className="ls-node-pick">
          <PickMark />
          <span className="ls-node-mark ls-num">{state === 'locked' ? <LockGlyph /> : ''}</span>
        </span>
        <span className="ls-node-title">{sp.part}</span>
        <span className="ls-node-song">{sp.song}</span>
        {passed && <StarPips stars={rec?.stars ?? 0} />}
      </button>
    </li>
  )
}

function StageRow({ stage, progress, current, onOpen, parts = [] }: { stage: StageDef; progress: Progress; current: string | null; onOpen: (id: string) => void; parts?: MapSongPart[] }) {
  const open = stageOpen(progress, stage.id)
  const { got, max } = starsInStage(progress, stage.id)
  const i = STAGES.indexOf(stage)
  const gate = stage.weeks && i > 0 ? checkpointOf(STAGES[i - 1]) : null
  const lockText = !stage.weeks ? `Opens with ${weeksLabel(STAGES[1]).toLowerCase()}` : gate ? `Pass ${lessonById(gate)?.title ?? gate} to open` : ''
  const node = (id: string, n: number, extra: boolean) => <PathNode key={id} id={id} mark={n} extra={extra} progress={progress} current={current} onOpen={onOpen} />
  // What this stage sounds like when it's done: the plan's video for its fortnight.
  const video = stage.weeks ? PLAN_WEEKS.find((w) => w.stage === stage.id)?.video : undefined
  return (
    <section className={`ls-world ${open ? 'open' : 'locked'} ${stage.weeks ? '' : 'extras'}`} aria-labelledby={`ls-s${stage.id}`}>
      <header className="ls-world-head">
        <h3 id={`ls-s${stage.id}`}>
          {stage.weeks && <span className="ls-world-n ls-num">{stage.id}</span>}
          <span>
            {stage.weeks ? `${weeksLabel(stage)} · ${stage.title}` : stage.title}
          </span>
        </h3>
        <span className="ls-world-skill">{stage.skill}</span>
        {video && (
          <a className="ls-world-video" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" title={`${video.title} · ${video.by}`}>
            ▶ See it played
          </a>
        )}
        {max > 0 && (
          <span className="ls-world-stars ls-num" aria-label={`${got} of ${max} stars`}>
            <StarGlyph /> {got}/{max}
          </span>
        )}
      </header>
      {!open && lockText && (
        <p className="ls-world-lock">
          <LockGlyph /> {lockText}
        </p>
      )}
      {stage.core.length > 0 && <ol className="ls-path">{stage.core.map((id, n) => node(id, n + 1, false))}</ol>}
      {stage.extra.length > 0 && (
        <>
          {stage.core.length > 0 && <h4 className="ls-extra-h">Optional</h4>}
          <ol className="ls-path extra" aria-label={`${stage.weeks ? weeksLabel(stage) : 'Extras'}: optional lessons`}>
            {stage.extra.map((id, n) => node(id, n + 1, true))}
          </ol>
        </>
      )}
      {parts.length > 0 && (
        <>
          <h4 className="ls-extra-h">From your songs</h4>
          <ol className="ls-path extra" aria-label={`${stage.weeks ? weeksLabel(stage) : 'Extras'}: parts of your songs`}>
            {parts.map((sp) => (
              <SongNode key={sp.id} sp={sp} open={open} progress={progress} onOpen={onOpen} />
            ))}
          </ol>
        </>
      )}
    </section>
  )
}

export function LessonMap({
  progress,
  onOpen,
  onAchievements,
  onSettings,
  onRename,
  plan,
  onPlanStep,
  onPlanSwap,
  onPlanSkip,
  onPlanExtra,
  songs = [],
  onSong,
  songParts = [],
  onToday,
  onHeat,
  onSkills,
  onProgress,
  onWeeks,
  onPocket,
  onPain,
  onPressure,
  onSeenWeekly,
  notice,
}: {
  onPlanExtra: (kind: ExtraKind, leftSec: number) => void
  /** The player's own songs, shown as a row on the map; a tap opens the song in Learn a song. */
  songs?: MapSong[]
  onSong?: (id: string) => void
  /** The parts of those songs as lessons, each placed in a course week. */
  songParts?: MapSongPart[]
  progress: Progress
  onOpen: (id: string) => void
  onHeat: () => void
  onAchievements: () => void
  onSettings: () => void
  onRename: (name: string) => void
  plan: SessionPlan | null
  onPlanStep: (i: number) => void
  onPlanSwap: (i: number) => void
  onPlanSkip: (i: number) => void
  onToday: () => void
  onSkills?: () => void
  onProgress: () => void
  onWeeks: () => void
  onPocket: (s: SkillStart) => void
  onPain: (p: PainLevel) => void
  onPressure: () => void
  onSeenWeekly: () => void
  notice?: string | null
}) {
  const [now] = useState(() => new Date())
  const [pair] = useState(() => weakestPair(loadStats(), knownChords(progress)))
  // Where the lessons stand against the 12-week calendar, in one line; the plan screen says what to do about it.
  const [stats] = useState(loadStats)
  const pc = pace(progress, stats, now)
  const stage = dinoStageFor(progress)
  const stageName = DINO_STAGES[stage]?.name ?? ''
  const lv = levelFor(progress.xp)
  const current = nextLesson(progress)
  // Review brake (plan section 4): no new lesson is suggested, but every open lesson on the map still opens.
  const stuckIds = strugglingList(progress)
  const stuck = stuckIds.length
  const brake = stuck >= REVIEW_BRAKE
  // Clean first tries still needed before new lessons come back (the brake holds at REVIEW_BRAKE or more).
  const toLift = stuck - (REVIEW_BRAKE - 1)
  const currentLesson = current && !brake ? lessonById(current) : undefined
  const earned = Object.keys(progress.achievements).length
  // Today's session leads the home screen and Continue is one quiet line under it.
  // Once the session is done (or there is none), Continue is the main card again, above it.
  const showSet = !!plan && plan.steps.length > 0
  const setDone = showSet && planDone(plan)
  const star3 = closestThirdStar(progress)
  // The session already plays the current lesson next: no second link to it.
  const inSetTodo = !!plan && plan.steps.some((s) => s.lessonId === current && !s.drill && s.state === 'todo')
  // Session done but the day's minutes aren't: the session card offers one more block, so Continue stays a quiet link.
  const snap = useSyncExternalStore(subscribePractice, getPracticeSnapshot)
  const goal = useDailyGoal()
  const goalIn = !plan || goal * 60 - practiceDaySec(snap, plan.day) < 90
  const quietContinue = showSet && (!setDone || !goalIn)

  return (
    <div className="ls-home">
      <header className="ls-hud">
        <div className="ls-hud-dino">
          <Dino stage={stage} mood="idle" size={140} cosmetics={progress.cosmetics} cracked={eggCracked(progress)} />
        </div>
        <div className="ls-hud-who">
          <p className="ls-hud-name">
            <DinoName name={progress.dinoName} onRename={onRename} /> <span className="ls-muted">· {stageName}</span>
          </p>
          <div className="ls-level">
            <span className="ls-level-n ls-num">Lv {lv.level}</span>
            <div className="ls-bar" role="progressbar" aria-valuemin={0} aria-valuemax={lv.need} aria-valuenow={lv.into} aria-label="XP to next level">
              <span style={{ transform: `scaleX(${lv.need ? lv.into / lv.need : 0})` }} />
            </div>
            <span className="ls-muted ls-num">
              {lv.into} / {lv.need} XP
            </span>
          </div>
        </div>
        <div className="ls-hud-day">
          <WeekDots progress={progress} now={now} />
        </div>
      </header>

      {progress.seenWeekly !== true && <WeeklyNote goal={progress.weekGoal} onDone={onSeenWeekly} />}
      {notice && (
        <p className="sc-quiet-note" role="status">
          {notice}
        </p>
      )}


      {/* Today first: the plan and its Play button, right under the dino. Then how it went, then the rest. */}
      {showSet && (
        <TodayCard progress={progress} plan={plan} onStep={onPlanStep} onSwap={onPlanSwap} onSkip={onPlanSkip} onToday={onToday} onPain={onPain} onPressure={onPressure} onExtra={onPlanExtra} />
      )}
      {setDone && <CheckInCard />}
      <CoachCard progress={progress} moment={setDone ? 'done' : 'open'} />
      <WeeklyReview progress={progress} />
      {onSong && <GoalCard progress={progress} songs={songs} songParts={songParts} onOpen={onOpen} onSong={onSong} />}
      <ThenAndNow progress={progress} />
      {star3 && (
        <p className="sc-quiet-note ls-star3-goal">
          Closest third star: <b>{star3.title}</b>, {star3.gap > 0 ? `${star3.gap}% to go at full tempo` : 'the score is there, now at full tempo'}.{' '}
          <button className="ls-link" onClick={() => onOpen(star3.id)}>
            Go for it
          </button>
        </p>
      )}

      <p className="ls-pace-line">
        <button className="ls-link" onClick={onWeeks}>
          {pc.headline}
        </button>
        <span className="ls-muted"> · {pc.advice[0]}</span>
      </p>

      {brake && (
        <p className="sc-quiet-note ls-brake-note" role="status">
          Review first: {stuck} lessons aren't sticking yet:{' '}
          {stuckIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <button className="ls-link" onClick={() => onOpen(id)}>
                {lessonById(id)?.title ?? id}
              </button>
            </span>
          ))}
          . New lessons come back once <b className="ls-num">{toLift}</b> more of them {toLift === 1 ? 'passes its' : 'pass their'} first try (clean, or at 2 stars); your plan puts their first tries first. Any open lesson on the map still plays.
        </p>
      )}

      {onSkills && (
        <div className="sk-entry">
          <p>
            <b>Skills</b> <span className="ls-muted">· short games: notes, changes, timing, ear</span>
          </p>
          <button className="ls-btn small" onClick={onSkills}>
            Open
          </button>
        </div>
      )}

      {currentLesson && !quietContinue && (
        <div className="ls-continue">
          <div>
            <p className="ls-continue-label">Continue: {currentLesson.title}</p>
            <p className="ls-muted">{currentLesson.goal}</p>
          </div>
          <button className="ls-btn primary" onClick={() => onOpen(currentLesson.id)} autoFocus>
            Play
          </button>
        </div>
      )}


      {showSet && <PocketCard open={pocketOpen(progress, now)} pair={pair} onPick={onPocket} />}

      {currentLesson && quietContinue && !inSetTodo && (
        <p className="ls-continue-also">
          or continue with:{' '}
          <button className="ls-link" onClick={() => onOpen(currentLesson.id)}>
            {currentLesson.title}
          </button>
        </p>
      )}

      <div className="ls-worlds">
        {songs.length > 0 && onSong && (
          <section className="ls-world open extras" aria-labelledby="ls-songs">
            <header className="ls-world-head">
              <h3 id="ls-songs">
                <span>Your songs</span>
              </h3>
              <span className="ls-world-skill">Each song's path: learn its parts, play each with the song, then the whole song at full tempo. Hover for the steps.</span>
            </header>
            <ol className="ls-path extra" aria-label="Your songs">
              {songs.map((sg) => {
                // The song's path: parts as lessons, then each part with the song, the whole song, full tempo.
                const path = songPath(partsOf(songParts, sg.id, (id) => isPassed(progress, id)), sg.levels)
                // Where it still breaks, by section name (the part lessons carry the names).
                const names = new Map(songParts.filter((sp) => sp.id.startsWith(`song:${sg.id}:`)).map((sp) => [Number(sp.id.split(':').pop()), sp.part] as [number, string]))
                const weak = sg.levels?.ready ? [] : weakSpots(sg.levels, names)
                const open = () => (path.next?.kind === 'part' ? onOpen(path.next.id) : onSong(sg.id))
                return (
                  <li key={sg.id} className="ls-fret">
                    <button
                      className={`ls-node ${path.next ? 'open' : 'done'}`}
                      onClick={open}
                      title={[...path.steps.map((st) => `${st.done ? '✓' : '·'} ${st.label} (${st.detail})`), ...(weak.length ? [`Still breaks: ${weak.join(', ')}`] : []), ...(sg.recent ? [sg.recent] : [])].join('\n')}
                      aria-label={`${sg.title}: song path ${path.done} of ${path.steps.length}${path.nextLabel ? `, next: ${path.nextLabel}` : ', done'}`}
                    >
                      <span className="ls-node-pick">
                        <PickMark />
                        <span className="ls-node-mark ls-num">{path.done}</span>
                      </span>
                      <span className="ls-node-title">{sg.title}</span>
                      <span className="ls-node-tag" aria-hidden>
                        <span className="ls-num">
                          {path.done}/{path.steps.length}
                        </span>{' '}
                        · {path.next ? path.nextLabel : 'Band-ready ✓'}
                        {sg.recent && <span className="ls-muted"> · {sg.recent}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        )}
        {STAGES.map((s) => (
          <StageRow key={s.id} stage={s} progress={progress} current={brake ? null : current} onOpen={onOpen} parts={songParts.filter((sp) => sp.stage === s.id)} />
        ))}
      </div>

      <footer className="ls-foot-bar">
        <button className="ls-btn ghost" onClick={onProgress}>
          Your progress
        </button>
        <button className="ls-btn ghost" onClick={onWeeks}>
          12-week plan
        </button>
        <button className="ls-btn ghost" onClick={onAchievements}>
          Achievements <span className="ls-num">{earned}/{ACHIEVEMENTS.length || 16}</span>
        </button>
        <button className="ls-btn ghost" onClick={onHeat}>
          Trouble spots
        </button>
        <button className="ls-btn ghost" onClick={onSettings}>
          Settings
        </button>
      </footer>
    </div>
  )
}