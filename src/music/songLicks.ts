// Licks from the player's own songs for the Jam tab: their part lessons' single-note runs (skills/ear.ts
// licksFrom), kept only when every note is in the scale being jammed, so they fit the band.
import type { FretPos } from './theory'
import { pc } from './theory'
import { licksFrom } from '../skills/ear'
import { madeLessons } from '../lessons/data'
import { buildChart } from '../lessons/charts'

/** Every note of the lick is in the scale. */
export const fitsScale = (lick: FretPos[], scalePcs: number[]) => lick.every((n) => scalePcs.includes(pc(n.midi)))

/** A lick for a chord: one that ends on a chord tone when there is one (it lands), else any; null with none. */
export function pickLick(licks: FretPos[][], chordTones: number[], rand = Math.random): FretPos[] | null {
  if (!licks.length) return null
  const landing = licks.filter((l) => chordTones.includes(pc(l[l.length - 1].midi)))
  const pool = landing.length ? landing : licks
  return pool[Math.floor(rand() * pool.length)]
}

let building: Promise<void> | null = null
/** The song part lessons, built if Lessons hasn't built them yet on this page. */
export function ensureSongParts(): Promise<void> {
  if (madeLessons().length) return Promise.resolve()
  building ??= (async () => {
    const { listSongs } = await import('./library')
    const { songLessons } = await import('../lessons/songLesson')
    for (const s of await listSongs()) songLessons(s)
  })().catch(() => {})
  return building
}

/** Licks of 4 to 7 notes from the player's songs that fit the scale, without repeats. */
export async function songLicksIn(scalePcs: number[]): Promise<FretPos[][]> {
  await ensureSongParts()
  const out: FretPos[][] = []
  const seen = new Set<string>()
  for (const l of madeLessons()) {
    const notes = buildChart(l).events.flatMap((e) => (e.kind === 'note' ? [{ string: e.string, fret: e.fret, midi: e.midi, beat: e.beat }] : []))
    for (let len = 4; len <= 7; len++)
      for (const lick of licksFrom(notes, len, !!l.tuning)) {
        const key = lick.map((n) => n.midi).join(',')
        if (!seen.has(key) && fitsScale(lick, scalePcs)) {
          seen.add(key)
          out.push(lick)
        }
      }
  }
  return out
}
