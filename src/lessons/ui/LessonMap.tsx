import { useState } from 'react'
import type { DayPlan, Progress, Stars, WorldDef } from '../types'
import { WORLDS, lessonById } from '../data'
import { DINO_STAGES, dayKey, dinoStageFor, eggCracked, isPassed, isUnlocked, levelFor, nextLesson, starsInWorld, streakStatus, worldUnlocked } from '../progress'
import { planDone } from '../plan'
import { ACHIEVEMENTS } from '../achievements'
import { Dino } from './Dino'
import { TodayCard } from './TodayPlan'

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

function DailyRing({ xp, goal }: { xp: number; goal: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  const share = Math.min(1, xp / goal)
  return (
    <div className="ls-daily">
      <svg viewBox="0 0 56 56" aria-hidden>
        <circle cx="28" cy="28" r={r} className="track" />
        <circle cx="28" cy="28" r={r} className={`fill ${share >= 1 ? 'done' : ''}`} strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 28 28)" />
      </svg>
      <span>
        <b className="ls-num">{xp}</b> / {goal} XP today
      </span>
    </div>
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

function WorldRow({ world, progress, current, onOpen }: { world: WorldDef; progress: Progress; current: string | null; onOpen: (id: string) => void }) {
  const open = worldUnlocked(progress, world.id)
  const { got, max } = starsInWorld(progress, world.id)
  const prev = WORLDS.find((w) => w.id === world.id - 1)
  const need = prev ? Math.ceil(0.7 * 3 * prev.lessons.length) : 0
  return (
    <section className={`ls-world ${open ? 'open' : 'locked'}`} aria-labelledby={`ls-w${world.id}`}>
      <header className="ls-world-head">
        <h3 id={`ls-w${world.id}`}>
          <span className="ls-world-n ls-num">{world.id}</span>
          {world.title}
        </h3>
        <span className="ls-world-skill">{world.skill}</span>
        <span className="ls-world-stars ls-num" aria-label={`${got} of ${max} stars`}>
          <StarGlyph /> {got}/{max}
        </span>
      </header>
      {!open && prev && (
        <p className="ls-world-lock">
          <LockGlyph /> Clear World {prev.id}'s boss or get {need} <StarGlyph />
          <span className="ls-sr">stars</span>
        </p>
      )}
      <ol className="ls-path">
        {world.lessons.map((id) => {
          const l = lessonById(id)
          if (!l) return null
          const rec = progress.lessons[id]
          const passed = isPassed(progress, id)
          const unlocked = open && isUnlocked(progress, id)
          const state = passed ? 'done' : !unlocked ? 'locked' : id === current ? 'current' : 'open'
          const label = `${l.title}${l.boss ? ', boss' : ''}: ${state === 'locked' ? 'locked' : passed ? `${rec?.stars ?? 0} stars` : 'open'}`
          return (
            <li key={id} className={`ls-fret ${l.boss ? 'boss' : ''}`}>
              <button className={`ls-node ${state}`} disabled={!unlocked} onClick={() => onOpen(id)} aria-label={label} aria-current={state === 'current' ? 'step' : undefined}>
                <span className="ls-node-pick">
                  <PickMark />
                  <span className="ls-node-mark ls-num">{state === 'locked' ? <LockGlyph /> : l.boss ? 'Boss' : l.order}</span>
                </span>
                <span className="ls-node-title">{l.title}</span>
                {passed && <StarPips stars={rec?.stars ?? 0} />}
              </button>
            </li>
          )
        })}
      </ol>
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
  onPlanSwap,
  onPlanSkip,
  onToday,
  onSkills,
}: {
  progress: Progress
  onOpen: (id: string) => void
  onAchievements: () => void
  onSettings: () => void
  onRename: (name: string) => void
  plan: DayPlan | null
  onPlanSwap: (i: number) => void
  onPlanSkip: (i: number) => void
  onToday: () => void
  onSkills?: () => void
}) {
  const [now] = useState(() => new Date())
  const stage = dinoStageFor(progress)
  const stageName = DINO_STAGES[stage]?.name ?? ''
  const lv = levelFor(progress.xp)
  const streak = streakStatus(progress, now)
  const dailyXp = progress.daily.day === dayKey(now) ? progress.daily.xp : 0
  const current = nextLesson(progress)
  const currentLesson = current ? lessonById(current) : undefined
  const earned = Object.keys(progress.achievements).length
  // Today's set leads the home screen; Continue returns once the set is done (or there is none).
  const showSet = !!plan && plan.steps.length > 0
  const setDone = showSet && planDone(plan)

  return (
    <div className="ls-home">
      <header className="ls-hud">
        <div className="ls-hud-dino">
          <Dino stage={stage} mood={streak.away >= 2 ? 'sleepy' : 'idle'} size={140} cosmetics={progress.cosmetics} cracked={eggCracked(progress)} />
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
          <DailyRing xp={dailyXp} goal={progress.dailyGoal} />
          <p className="ls-streak">
            <FootGlyph />
            <b className="ls-num">{streak.alive ? streak.days : 0}</b> days
            {progress.streak.eggs > 0 && (
              <span className="ls-eggs" title="Nest eggs keep your streak if you miss a day" aria-label={`${progress.streak.eggs} nest eggs`}>
                {'●'.repeat(progress.streak.eggs)}
              </span>
            )}
          </p>
        </div>
      </header>

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

      {showSet && <TodayCard progress={progress} plan={plan} onOpen={onOpen} onSwap={onPlanSwap} onSkip={onPlanSkip} onToday={onToday} />}

      {currentLesson && (!showSet || setDone) && (
        <div className="ls-continue">
          <div>
            <p className="ls-continue-label">Continue: {currentLesson.title}</p>
            <p className="ls-muted">{currentLesson.goal}</p>
          </div>
          <button className="ls-btn primary" onClick={() => onOpen(currentLesson.id)} autoFocus={!showSet || setDone}>
            Play
          </button>
        </div>
      )}

      <div className="ls-worlds">
        {WORLDS.map((w) => (
          <WorldRow key={w.id} world={w} progress={progress} current={current} onOpen={onOpen} />
        ))}
      </div>

      <footer className="ls-foot-bar">
        <button className="ls-btn ghost" onClick={onAchievements}>
          Achievements <span className="ls-num">{earned}/{ACHIEVEMENTS.length || 16}</span>
        </button>
        <button className="ls-btn ghost" onClick={onSettings}>
          Settings
        </button>
      </footer>
    </div>
  )
}
