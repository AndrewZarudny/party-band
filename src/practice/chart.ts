// The practice panel's 30-day chart: its scale and its caption (ui/PracticePanel.tsx draws it).
import { KINDS } from './data'
import { reachedGoal } from './goal'
import type { PracticeSummary } from './stats'
import { KIND_LABEL, fmtDuration } from './stats'

const STEPS = [300, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200, 10800, 14400]
// Room above the goal line for its label: on the top line it would be cut off by the chart's edge.
const GOAL_HEADROOM = 1.15

/** Gridline step and top of the scale: about three lines, never below 30 minutes. */
export function scaleOf(max: number): { step: number; top: number } {
  const want = Math.max(max, 1800) / 3
  const step = STEPS.find((s) => s >= want) ?? Math.ceil(want / 3600) * 3600
  return { step, top: Math.ceil(Math.max(max, 1800) / step) * step }
}

/** The scale for the busiest day, with the goal line (and its label) always below the top. */
export const chartScale = (max: number, goalSec: number) => scaleOf(Math.max(max, goalSec * GOAL_HEADROOM))

function summaryText(p: PracticeSummary): string {
  if (!p.total30) return 'No practice in the last 30 days yet.'
  const days = p.last30.filter((d) => d.total > 0).length
  const lead = KINDS.map((k, i) => [k, p.byKind30[i]] as const).sort((a, b) => b[1] - a[1])[0]
  return `Last 30 days: ${fmtDuration(p.total30)} over ${days} ${days === 1 ? 'day' : 'days'}, most of it ${KIND_LABEL[lead[0]].toLowerCase()}.`
}

/** What the chart shows, in words. Days that reached the goal are told; a month without one isn't counted against. */
export function chartCaption(p: PracticeSummary, goal: number): string {
  const met = p.last30.filter((d) => reachedGoal(d.total, goal)).length
  return summaryText(p) + (met ? ` The goal was reached on ${met} ${met === 1 ? 'day' : 'days'}.` : '')
}
