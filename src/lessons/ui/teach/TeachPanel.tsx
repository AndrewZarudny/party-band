// Before you play: the fretting-hand and picking-hand demos, this world's hand tips and the technique basics.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Chart, ChartFingering, Lesson, Prefs } from '../../types'
import { HAND_TIPS } from '../../fingering'
import { engine } from '../../../audio/engine'
import { LeadVoice } from '../../synth'
import { basicsCard, basicsFor, strums } from './basics'
import type { BasicsId } from './basics'
import { BasicsSheet } from './BasicsSheet'
import { DemoClock } from './clock'
import { Filmstrip } from './Filmstrip'
import { HandDemo } from './HandDemo'
import { PickDemo } from './PickDemo'
import { loopBpm } from './phrase'
import { useFrame, useStill, useWidth } from './useFrame'
import './teach.css'

const SIDE_MIN = 560

export function TeachPanel({
  lesson,
  chart,
  fingering,
  prefs,
  onPrefs,
  follow,
}: {
  lesson: Lesson
  chart: Chart
  fingering: ChartFingering
  prefs: Prefs
  onPrefs: (p: Prefs) => void
  /** While Watch runs: the demos follow its beat instead of looping. */
  follow: { beatNow: () => number | null; bpm: number } | null
}) {
  const still = useStill()
  const boxRef = useRef<HTMLElement>(null)
  const width = useWidth(boxRef)
  const side = width >= SIDE_MIN
  const hasSteps = chart.events.some((e) => e.kind !== 'rest')
  const bpm = loopBpm(lesson.bpm)
  const clock = useMemo(() => new DemoClock(chart, fingering, bpm), [chart, fingering, bpm])
  const [sound, setSound] = useState(false)
  const lead = useRef<LeadVoice | null>(null)
  const following = !!follow
  const tips = HAND_TIPS[lesson.world]
  const first = useMemo(() => basicsFor(lesson, chart, fingering), [lesson, chart, fingering])
  const strum = useMemo(() => strums(chart), [chart])
  // The basics open once by themselves, on the first intro ever.
  const [sheet, setSheet] = useState<{ start?: BasicsId } | null>(() => (prefs.seenBasics ? null : {}))
  const closeSheet = () => {
    setSheet(null)
    if (!prefs.seenBasics) onPrefs({ ...prefs, seenBasics: true })
  }

  // Sound: the loop then runs on the audio clock so notes and pictures agree.
  useEffect(() => {
    if (!sound || following || !hasSteps) return
    let alive = true
    void engine.ensureContext().then((ctx) => {
      if (!alive) return
      lead.current = new LeadVoice(ctx)
      clock.setAudio(ctx)
    })
    return () => {
      alive = false
      lead.current?.stopAll()
      lead.current = null
      clock.setAudio(null)
    }
  }, [sound, following, hasSteps, clock])
  useFrame(
    () => {
      if (lead.current) clock.schedule(lead.current)
    },
    sound && !following,
  )

  const beat = useMemo(() => (follow ? () => follow.beatNow() ?? -1e3 : clock.beat), [follow, clock])
  const mode = following ? 'follow' : 'loop'
  const demoBpm = follow ? follow.bpm : bpm

  return (
    <section ref={boxRef} className="tc-panel" aria-label="How to play it">
      {hasSteps &&
        (still ? (
          <Filmstrip chart={chart} fingering={fingering} mode={mode} beatNow={beat} />
        ) : (
          <div className={`tc-demos ${side ? 'side' : 'stack'}`}>
            <HandDemo chart={chart} fingering={fingering} mode={mode} beatNow={beat} bpm={demoBpm} />
            <PickDemo chart={chart} fingering={fingering} mode={mode} beatNow={beat} bpm={demoBpm} layout={side ? 'side' : 'strip'} />
          </div>
        ))}
      {hasSteps && (
        <div className="tc-demo-bar">
          <p className="tc-demo-note">{following ? 'Following the music' : still ? 'The first phrase, step by step' : `The first phrase, looping at ${bpm} bpm`}</p>
          {!following && !still && (
            <button className={`tc-sound ${sound ? 'on' : ''}`} role="switch" aria-checked={sound} onClick={() => setSound((v) => !v)}>
              <span className="tc-sound-track" aria-hidden>
                <span />
              </span>
              Sound
            </button>
          )}
        </div>
      )}
      <dl className="tc-hands">
        <div>
          <dt>Fretting hand</dt>
          <dd>{tips.fret}</dd>
        </div>
        <div>
          <dt>Picking hand</dt>
          <dd>{tips.pick}</dd>
        </div>
      </dl>
      <div className="tc-basics">
        {first.length > 0 && <span className="tc-basics-lead">Before you play:</span>}
        {first.map((id) => (
          <button key={id} className="tc-chip-btn" onClick={() => setSheet({ start: id })}>
            {basicsCard(id, strum).chip}
          </button>
        ))}
        <button className="ls-link tc-basics-all" onClick={() => setSheet({})}>
          Technique basics
        </button>
      </div>
      {sheet && <BasicsSheet first={first} strum={strum} startAt={sheet.start} onClose={closeSheet} />}
    </section>
  )
}
