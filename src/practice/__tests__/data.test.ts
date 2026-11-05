import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeLogs, mergePracticeRaw, parseLog, prune, totalsOf } from '../data'

const log = (devices: Record<string, { days: Record<string, number[]>; before?: number[]; upto?: string }>) =>
  JSON.stringify({ v: 1, devices: Object.fromEntries(Object.entries(devices).map(([id, d]) => [id, { before: [0, 0, 0, 0], upto: '', ...d }])) })
const NOW = new Date(2026, 10, 4, 12)
const totals = (raw: string) => {
  const t = totalsOf(parseLog(raw))
  return { days: Object.fromEntries(t.days), before: t.before }
}

describe('practice log merge', () => {
  // mergePracticeRaw prunes against today's date: pin it so the fixed days below stay in the keep window.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const a = log({ A: { days: { '2026-11-04': [100, 0, 0, 5] } }, B: { days: { '2026-11-04': [0, 50, 0, 0] } } })
  const b = log({ A: { days: { '2026-11-04': [60, 0, 0, 9], '2026-11-03': [10, 0, 0, 0] } }, B: { days: { '2026-11-04': [0, 80, 0, 0] } } })

  it('per device and day the larger count wins; devices add up in the totals', () => {
    expect(totals(mergePracticeRaw(a, b))).toEqual({
      days: { '2026-11-04': [100, 80, 0, 9], '2026-11-03': [10, 0, 0, 0] },
      before: [0, 0, 0, 0],
    })
  })

  it('is the same in both orders and when merged again', () => {
    const ab = mergePracticeRaw(a, b)
    expect(totals(ab)).toEqual(totals(mergePracticeRaw(b, a)))
    expect(totals(mergePracticeRaw(ab, b))).toEqual(totals(ab))
    expect(totals(mergePracticeRaw(ab, ab))).toEqual(totals(ab))
  })

  it('a missing or unreadable side is empty', () => {
    expect(JSON.parse(mergePracticeRaw(null, null))).toEqual({ v: 1, devices: {} })
    expect(totals(mergePracticeRaw(a, '{bad'))).toEqual(totals(mergePracticeRaw(a, null)))
  })

  it('parseLog drops bad days and numbers', () => {
    const p = parseLog(JSON.stringify({ v: 1, devices: { A: { days: { 'nope': [1], '2026-11-04': [5.4, -3, 'x'] }, before: 'x', upto: 'bad' } } }))
    expect(p.devices.A).toEqual({ days: { '2026-11-04': [5, 0, 0, 0] }, before: [0, 0, 0, 0], upto: '' })
  })
})

describe('prune', () => {
  const raw = log({ A: { days: { '2024-01-01': [7, 0, 0, 0], '2026-11-04': [1, 0, 0, 0] } } })

  it('folds days older than the keep window into the device total', () => {
    const p = prune(parseLog(raw), NOW)
    expect(p.devices.A.days).toEqual({ '2026-11-04': [1, 0, 0, 0] })
    expect(p.devices.A.before).toEqual([7, 0, 0, 0])
    expect(p.devices.A.upto).not.toBe('')
  })

  it('a pruned copy merged with an unpruned one does not count old days twice', () => {
    const pruned = prune(parseLog(raw), NOW)
    const m = mergeLogs(pruned, parseLog(raw), NOW)
    const t = totalsOf(m)
    expect(t.before).toEqual([7, 0, 0, 0])
    expect(Object.fromEntries(t.days)).toEqual({ '2026-11-04': [1, 0, 0, 0] })
  })
})
