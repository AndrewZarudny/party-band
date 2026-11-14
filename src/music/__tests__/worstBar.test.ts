import { describe, expect, it } from 'vitest'
import { worstBar } from '../songRuns'

describe('where a song run missed', () => {
  it('the bar with the most misses; ties go to the earlier bar; one miss is no pattern', () => {
    expect(worstBar([13, 14, 13, 20, 13])).toEqual({ bar: 13, misses: 3 })
    expect(worstBar([5, 9, 9, 5])).toEqual({ bar: 5, misses: 2 })
    expect(worstBar([4, 8])).toBeNull()
    expect(worstBar([])).toBeNull()
  })
})
