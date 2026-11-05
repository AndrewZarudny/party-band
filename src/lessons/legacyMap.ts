// The old world map (8 worlds, before the map followed the 12-week plan), frozen.
// Only the migration uses it: what the old rules showed as open, and the old dino stage.
import type { Progress } from './types'
import { lessonById } from './data'

/** The old 8 worlds, in play order; each world's boss was last. */
export const LEGACY_WORLDS: string[][] = [
  ['w1-01', 'w1-02', 'w1-03', 'w1-05', 'w1-04'],
  ['w2-01', 'w2-02', 'w2-03', 'w2-05', 'w2-06', 'w2-07', 'w2-04'],
  ['w3-01', 'w3-02', 'w3-06', 'w3-07', 'w3-03', 'w3-05', 'w3-09', 'w3-10', 'w3-04'],
  ['w4-01', 'w4-02', 'w4-03', 'w4-05', 'w4-06', 'w4-04'],
  ['w5-01', 'w5-11', 'w5-02', 'w5-03', 'w5-04', 'w5-07', 'w5-08', 'w5-09', 'w5-06'],
  ['w6-01', 'w6-02', 'w6-03', 'w6-04', 'w6-05'],
  ['w7-01', 'w7-02', 'w7-03', 'w7-05', 'w7-04'],
  ['w8-01', 'w8-02', 'w8-03', 'w8-04', 'w8-06', 'w8-07', 'w8-08', 'w8-09', 'w8-10', 'w8-11', 'w8-12', 'w8-05'],
]
export const LEGACY_BOSSES = ['w1-04', 'w2-04', 'w3-04', 'w4-04', 'w5-06', 'w6-05', 'w7-04', 'w8-05']
export const LEGACY_FREE = ['w8-06', 'w8-07', 'w8-08', 'w8-09', 'w8-10', 'w8-11', 'w8-12']
const LEGACY_PLAN = [
  'w1-05', 'w3-06', 'w3-07', 'w4-01', 'w3-09', 'w3-10', 'w2-06', 'w5-01', 'w5-11', 'w5-07', 'w7-05',
  'w6-01', 'w6-02', 'w6-03', 'w6-04', 'w6-05', 'w3-05', 'w2-07', 'w5-08', 'w5-09', 'w8-06', 'w8-07', 'w8-10',
  'w8-11', 'w8-12', 'w8-08', 'w8-09',
]
export const LEGACY_PLAN_PATH = LEGACY_PLAN.filter((id) => !LEGACY_FREE.includes(id))

const passed = (p: Progress, id: string) => p.lessons[id]?.passedAt !== undefined
const isFree = (id: string) => LEGACY_FREE.includes(id)

function starsIn(p: Progress, w: number): { got: number; max: number } {
  const ids = LEGACY_WORLDS[w].filter((id) => !isFree(id))
  return { got: ids.reduce((a, id) => a + (p.lessons[id]?.stars ?? 0), 0), max: 3 * ids.length }
}

/** Old rule: world 0 always; else the previous boss passed, or 70% of the previous world's stars. */
function worldOpen(p: Progress, w: number): boolean {
  if (w === 0) return true
  if (passed(p, LEGACY_BOSSES[w - 1])) return true
  const s = starsIn(p, w - 1)
  return s.max > 0 && s.got >= Math.ceil(0.7 * s.max)
}

function planOpen(p: Progress, id: string): boolean {
  const i = LEGACY_PLAN_PATH.indexOf(id)
  return i === 0 || (i > 0 && passed(p, LEGACY_PLAN_PATH[i - 1]))
}

function openUnderOld(p: Progress, id: string): boolean {
  if (planOpen(p, id)) return true
  const w = LEGACY_WORLDS.findIndex((ids) => ids.includes(id))
  if (w < 0 || !worldOpen(p, w)) return false
  if (isFree(id)) return true
  const ids = LEGACY_WORLDS[w].filter((x) => !isFree(x))
  const i = ids.indexOf(id)
  if (i <= 0 || LEGACY_BOSSES.includes(id) || passed(p, id)) return true
  const prev = ids[i - 1]
  if (passed(p, prev)) return true
  return lessonById(prev)?.type === 'sync' && (p.lessons[prev]?.plays ?? 0) >= 1
}

/** Every lesson id the old map showed as open, in old map order. */
export function legacyOpen(p: Progress): string[] {
  return LEGACY_WORLDS.flat().filter((id) => openUnderOld(p, id))
}

/** The old dino stage: world bosses passed. */
export function legacyStage(p: Progress): number {
  return Math.min(8, LEGACY_BOSSES.filter((id) => passed(p, id)).length)
}
