import { describe, expect, it } from 'vitest'
import { splitAction } from '../liveCoach'

describe('the live coach taking an action', () => {
  it('the tag is taken off what is spoken, and read as an action with its argument', () => {
    expect(splitAction('Sure, let’s loop those two bars. <<do:loop 3-4>>')).toEqual({ say: 'Sure, let’s loop those two bars.', action: { name: 'loop', arg: '3-4' } })
    expect(splitAction('Okay, a bit slower. <<do: slower >>')).toEqual({ say: 'Okay, a bit slower.', action: { name: 'slower', arg: undefined } })
  })

  it('no tag: nothing to do', () => {
    expect(splitAction('Nice run. Watch bar three.')).toEqual({ say: 'Nice run. Watch bar three.', action: null })
  })
})
