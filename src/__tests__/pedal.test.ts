import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PEDAL, loadPedal, pedalPress, pedalTarget, roleOf, savePedal } from '../pedal'

// Stand-in buttons: what pedalTarget looks at (the mark, disabled, whether it's laid out on screen).
const button = (id: string, role: 'go' | 'next', o: { hidden?: boolean; disabled?: boolean } = {}) =>
  ({ id, role, disabled: !!o.disabled, getAttribute: () => null, getClientRects: () => (o.hidden ? [] : [{}]) }) as unknown as HTMLElement & { role: string }
const page = (...buttons: (HTMLElement & { role: string })[]) =>
  ({ querySelectorAll: (sel: string) => buttons.filter((b) => sel === `[data-pedal="${b.role}"]`) }) as unknown as ParentNode

describe('the foot pedal', () => {
  beforeEach(() => localStorage.clear())

  it('Page Down presses the main button, Page Up moves on; switched off does nothing', () => {
    expect(roleOf(DEFAULT_PEDAL, 'PageDown')).toBe('go')
    expect(roleOf(DEFAULT_PEDAL, 'PageUp')).toBe('next')
    expect(roleOf(DEFAULT_PEDAL, 'a')).toBeNull()
    expect(roleOf({ ...DEFAULT_PEDAL, on: false }, 'PageDown')).toBeNull()
  })

  it('a taught pedal is kept', () => {
    savePedal({ on: true, go: ['ArrowRight'], next: ['ArrowLeft'] })
    expect(loadPedal()).toEqual({ on: true, go: ['ArrowRight'], next: ['ArrowLeft'] })
  })

  it('presses the first visible, enabled button marked for it', () => {
    const root = page(button('hidden', 'go', { hidden: true }), button('off', 'go', { disabled: true }), button('start', 'go'), button('next', 'next'))
    expect(pedalTarget('go', root)?.id).toBe('start')
    expect(pedalTarget('next', root)?.id).toBe('next')
  })

  it('not while typing in a field, holding a modifier, or a key held down', () => {
    const root = page(button('start', 'go'))
    const field = { tagName: 'INPUT' } as unknown as EventTarget
    expect(pedalPress({ key: 'PageDown', target: null }, DEFAULT_PEDAL, root)?.id).toBe('start')
    expect(pedalPress({ key: 'PageDown', target: field }, DEFAULT_PEDAL, root)).toBeNull()
    expect(pedalPress({ key: 'PageDown', metaKey: true, target: null }, DEFAULT_PEDAL, root)).toBeNull()
    expect(pedalPress({ key: 'PageDown', repeat: true, target: null }, DEFAULT_PEDAL, root)).toBeNull()
  })
})
