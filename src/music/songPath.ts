// A song's path from its parts to the whole song: the parts as lessons, then each part with the song in Learn a
// song, then the whole song, then the whole song at full tempo. Pure: the caller passes what was played.
import type { SongLevels } from './songLevels'
import { BAND_READY_PCT } from './songLevels'

export type PathStepKey = 'parts' | 'sections' | 'whole' | 'ready'

export interface PathStep {
  key: PathStepKey
  label: string
  done: boolean
  /** e.g. "2 of 3 parts" */
  detail: string
}

export interface SongPath {
  steps: PathStep[]
  done: number
  /** What to do next: a part's lesson, the song in Learn a song, or nothing (the path is done). */
  next: { kind: 'part'; id: string } | { kind: 'song' } | null
  /** The next step's label, e.g. "Play the whole song". */
  nextLabel: string | null
}

/**
 * Where the song still breaks: its sections (by name, from the part lessons) not passed in Learn a song yet, or
 * passed under the band-ready share. `names`: section index to name.
 */
export function weakSpots(levels: SongLevels | null, names: Map<number, string>): string[] {
  if (!levels?.total) return []
  const out: string[] = []
  for (let i = 0; i < levels.total; i++) {
    const r = levels.passed[String(i)]
    if (!r || r.pct < BAND_READY_PCT) out.push(names.get(i) ?? `Section ${i + 1}`)
  }
  return out
}

/** A song's part lessons (ids like song:<songId>:<n>), in song order, and whether each is passed. */
export function partsOf(parts: { id: string }[], songId: string, passed: (id: string) => boolean): { id: string; passed: boolean }[] {
  const prefix = `song:${songId}:`
  return parts
    .filter((sp) => sp.id.startsWith(prefix))
    .sort((a, b) => Number(a.id.slice(prefix.length)) - Number(b.id.slice(prefix.length)))
    .map((sp) => ({ id: sp.id, passed: passed(sp.id) }))
}

/**
 * `parts`: the song's part lessons (ids, song order) and whether each is passed. `levels`: Learn a song's levels.
 * A song with no part lessons (an unusual tuning, too few notes) starts at the Learn a song steps.
 */
export function songPath(parts: { id: string; passed: boolean }[], levels: SongLevels | null): SongPath {
  const passedParts = parts.filter((p) => p.passed).length
  const sectionsDone = levels ? Math.min(levels.total, Object.keys(levels.passed).length) : 0
  const sectionsTotal = levels?.total ?? 0
  const steps: PathStep[] = []
  if (parts.length) steps.push({ key: 'parts', label: 'Learn the parts', done: passedParts === parts.length, detail: `${passedParts} of ${parts.length} parts` })
  steps.push({
    key: 'sections',
    label: 'Play each part with the song',
    done: sectionsTotal > 0 && sectionsDone >= sectionsTotal,
    detail: sectionsTotal ? `${sectionsDone} of ${sectionsTotal} in Learn a song` : 'in Learn a song',
  })
  steps.push({ key: 'whole', label: 'Play the whole song', done: !!levels?.full, detail: levels?.full ? `${levels.full.pct}% at ${levels.full.speed}% speed` : 'start to end' })
  steps.push({
    key: 'ready',
    label: 'Band-ready',
    done: !!levels?.ready,
    detail: levels?.ready ? `${levels.ready.pct}% in one run at full tempo` : `the whole song in one run at full tempo, ${BAND_READY_PCT}% or more`,
  })

  const first = steps.find((s) => !s.done) ?? null
  const unpassed = parts.find((p) => !p.passed)
  const next = !first ? null : first.key === 'parts' && unpassed ? ({ kind: 'part', id: unpassed.id } as const) : ({ kind: 'song' } as const)
  return { steps, done: steps.filter((s) => s.done).length, next, nextLabel: first?.label ?? null }
}
