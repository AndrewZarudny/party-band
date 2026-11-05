import { describe, expect, it } from 'vitest'
import type { LatencyCal } from '../types'
import { LATENCY_WARN_MS, latencyAdvice } from '../calibration'

const cal = (offsetMs: number): LatencyCal => ({ v: 1, offsetMs, pitchLagMs: 35, spreadMs: 5, device: 'x', at: 0 })

describe('latencyAdvice', () => {
  it('warns above about 20 ms of output delay', () => {
    expect(LATENCY_WARN_MS).toBe(20)
    expect(latencyAdvice(19, null)).toEqual({ outMs: 19, roundMs: null, warn: false })
    expect(latencyAdvice(21, null).warn).toBe(true)
  })

  it('also warns when half the measured round trip is over 20 ms', () => {
    expect(latencyAdvice(10, cal(50))).toEqual({ outMs: 10, roundMs: 50, warn: true })
    expect(latencyAdvice(10, cal(38)).warn).toBe(false)
  })
})
