import { describe, expect, it } from 'vitest'
import { FRAMES, faviconSvg, faviconUrl } from '../favicon'

describe('the dino tab icon', () => {
  it('draws every frame as a 32×32 SVG with real numbers', () => {
    for (const f of FRAMES) {
      const s = faviconSvg(f)
      expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">')).toBe(true)
      expect(s.endsWith('</svg>')).toBe(true)
      expect(s).not.toMatch(/NaN|undefined/)
      // Every opened group is closed.
      expect(s.split('<g').length).toBe(s.split('</g>').length)
    }
  })

  it('moves: blinks, sings and bobs across the loop', () => {
    expect(new Set(FRAMES.map(faviconSvg)).size).toBeGreaterThan(3)
    expect(FRAMES.some((f) => f.blink)).toBe(true)
    expect(FRAMES.some((f) => f.sing)).toBe(true)
    expect(faviconUrl(FRAMES[0])).toMatch(/^data:image\/svg\+xml,%3Csvg/)
  })
})
