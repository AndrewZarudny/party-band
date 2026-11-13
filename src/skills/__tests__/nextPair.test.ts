import { describe, expect, it } from 'vitest'
import { emptyStats, bestKey } from '../data'
import { nextPairInBlock } from '../chords'

const stats = (best: Record<string, number>) => {
  const s = emptyStats()
  for (const [k, v] of Object.entries(best)) s.best[bestKey('changes', k)] = v
  return s
}

describe('the next chord pair in a session block', () => {
  it('never the pair just played while another is known: the weakest one not retired', () => {
    expect(nextPairInBlock(stats({ 'A-E': 10, 'A-D': 30, 'D-E': 40 }), ['A', 'D', 'E'], 'A-E')).toBe('A-D')
  })

  it('the others all retired: still another pair, the lowest best', () => {
    expect(nextPairInBlock(stats({ 'A-A7': 20, 'A-E': 65, 'A7-E': 61 }), ['A', 'A7', 'E'], 'A-A7')).toBe('A7-E')
  })

  it('the only pair known: null (the same pair again)', () => {
    expect(nextPairInBlock(stats({ 'A-A7': 61 }), ['A', 'A7'], 'A-A7')).toBeNull()
  })
})
