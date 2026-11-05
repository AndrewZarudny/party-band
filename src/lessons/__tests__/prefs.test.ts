import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, parsePrefs } from '../prefs'

describe('parsePrefs: guides and the basics sheet', () => {
  it('defaults to Auto guides and an unseen basics sheet', () => {
    const p = parsePrefs({})
    expect(p.guides).toBe('auto')
    expect(p.seenBasics).toBe(false)
    expect(DEFAULT_PREFS.guides).toBe('auto')
  })

  it('keeps a saved choice', () => {
    expect(parsePrefs({ guides: 'off' }).guides).toBe('off')
    expect(parsePrefs({ guides: 'on' }).guides).toBe('on')
    expect(parsePrefs({ seenBasics: true }).seenBasics).toBe(true)
  })

  it('falls back to Auto on a bad value', () => {
    expect(parsePrefs({ guides: 'sometimes' }).guides).toBe('auto')
    expect(parsePrefs({ guides: true }).guides).toBe('auto')
    expect(parsePrefs({ seenBasics: 'yes' }).seenBasics).toBe(false)
    expect(parsePrefs(null).guides).toBe('auto')
  })
})
