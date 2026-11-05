import { beforeEach, describe, expect, it } from 'vitest'
import { loadHearAmp, saveHearAmp } from '../hearAmp'

describe('the Hear amp choice', () => {
  beforeEach(() => localStorage.clear())

  it('is on until the player turns it off', () => {
    expect(loadHearAmp()).toBe(true)
  })

  it('stays off after a reload, and back on once switched on', () => {
    saveHearAmp(false)
    expect(loadHearAmp()).toBe(false)
    saveHearAmp(true)
    expect(loadHearAmp()).toBe(true)
    expect(localStorage.getItem('hear-amp')).toBeNull()
  })
})
