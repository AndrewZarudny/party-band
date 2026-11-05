// Technique basics: the six cards and which two a lesson shows first. Pure: no DOM.
import type { Chart, ChartFingering, Lesson } from '../../types'

export type BasicsId = 'grip' | 'wrist' | 'fret' | 'thumb' | 'pickMute' | 'fretMute'

export const BASICS_ORDER: BasicsId[] = ['grip', 'wrist', 'fret', 'thumb', 'pickMute', 'fretMute']

export const BASICS: Record<BasicsId, { title: string; copy: string; chip: string }> = {
  grip: {
    title: 'Hold the pick',
    chip: 'Pick grip',
    copy: 'Pinch it between the pad of your thumb and the side of your index finger. About 2 mm of tip shows.',
  },
  wrist: {
    title: 'Pick from the wrist',
    chip: 'Wrist motion',
    copy: 'Small down-up swings from the wrist, like shaking water off your hand. The arm stays relaxed and nearly still.',
  },
  fret: {
    title: 'Fret just behind the wire',
    chip: 'Where to press',
    copy: 'Press with the fingertip right behind the fret wire. Less pressure, cleaner note.',
  },
  thumb: {
    title: 'Thumb behind the neck',
    chip: 'Thumb and arch',
    copy: "Rest your thumb pad behind the neck, roughly behind your middle finger. Arch your fingers so they don't touch other strings.",
  },
  pickMute: {
    title: 'Mute with the picking hand',
    chip: 'Palm mute',
    copy: "Rest the edge of your picking hand where the strings meet the bridge. That's palm mute: a short 'chk'.",
  },
  fretMute: {
    title: 'Mute with the fretting hand',
    chip: 'Fretting-hand mute',
    copy: 'Ease off the pressure but keep touching the string: the note stops. The underside of your index quiets the strings above.',
  },
}

// Strumming swings the forearm; single notes stay in the wrist.
const STRUM_WRIST = {
  title: 'Strum from the elbow',
  chip: 'Strum motion',
  copy: 'Let the forearm swing from the elbow with a loose wrist, like a pendulum. Keep it going down and up, even when you skip a strum.',
}

/** True when the chart strums chords, so the wrist card shows the strumming version. */
export const strums = (chart: Chart): boolean => chart.events.some((e) => e.kind === 'chord')

/** A card's text; the wrist card has a strumming version. */
export function basicsCard(id: BasicsId, strum: boolean): { title: string; copy: string; chip: string } {
  return id === 'wrist' && strum ? STRUM_WRIST : BASICS[id]
}

/** The two cards this lesson needs most, in the order pickMute, fretMute, wrist, fret, thumb, grip. */
export function basicsFor(lesson: Lesson, chart: Chart, fingering: ChartFingering): BasicsId[] {
  let pickMute = false
  let fretMute = false
  let wrist = false
  let fretted = false
  chart.events.forEach((e, i) => {
    const f = fingering.events[i]
    if (f && f.kind !== 'rest' && f.pick === 'U') wrist = true
    if (e.kind === 'note') {
      if (e.tech === 'pm') pickMute = true
      if (e.fret > 0) fretted = true
    } else if (e.kind === 'chord') {
      if (e.dir === 'P') pickMute = true
      if (e.power) fretMute = true
      if (e.frets.some((x) => x > 0)) fretted = true
    } else {
      fretMute = true // a rest or a mute scratch
    }
  })
  const early = lesson.world <= 2
  const flags: [BasicsId, boolean][] = [
    ['pickMute', pickMute],
    ['fretMute', fretMute],
    ['wrist', wrist],
    ['fret', fretted],
    ['thumb', early && fretted],
    ['grip', early],
  ]
  return flags
    .filter(([, on]) => on)
    .map(([id]) => id)
    .slice(0, 2)
}
