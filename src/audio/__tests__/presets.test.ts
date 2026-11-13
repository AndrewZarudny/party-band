import { beforeEach, describe, expect, it, vi } from 'vitest'

// The engine and the capture library, faked: loading a capture takes a while, like the real NAM model.
const loads: (string | null)[] = []
let slow = 0
vi.mock('../engine', () => ({
  engine: {
    setTone: vi.fn(),
    setCapture: vi.fn(async (c: { name: string } | null) => {
      await new Promise((r) => setTimeout(r, slow))
      loads.push(c?.name ?? null)
    }),
    setIr: vi.fn(async () => {}),
  },
}))
vi.mock('../../music/library', () => ({
  getCapture: vi.fn(async (id: string) => ({ id, name: id, gear: 'amp', data: new TextEncoder().encode('{}').buffer })),
  saveCapture: vi.fn(),
}))

const { applyTone } = await import('../presets')
const { PRESETS } = await import('../tone')
const builtIn = { id: 'builtin:Clean', name: 'Clean', settings: PRESETS[0] }
const captured = (id: string) => ({ id, name: id, settings: PRESETS[0], capture: { id, name: id } })

describe('switching tones', () => {
  beforeEach(() => {
    loads.length = 0
    slow = 0
  })

  it('a quick click on a starting point while a captured amp loads ends on the starting point', async () => {
    slow = 30
    const a = applyTone(captured('ZOMBIE'))
    const b = applyTone(builtIn)
    await Promise.all([a, b])
    // The capture finished loading after the click, and was then taken off again.
    expect(loads).toEqual(['ZOMBIE', null])
  })

  it('several quick clicks end on the last one', async () => {
    slow = 20
    await Promise.all([applyTone(captured('Numb')), applyTone(captured('ZOMBIE')), applyTone(captured('Numb'))])
    expect(loads.at(-1)).toBe('Numb')
  })
})
