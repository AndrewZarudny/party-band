// "What's sticking" in the practice dialog must not skip a new player's Welcome and timing setup.
import { describe, expect, it } from 'vitest'
import { lessonsStartScreen } from '../progressLink'

describe('the screen Lessons opens on', () => {
  it('a new player gets the Welcome, even when the progress screen was asked for', () => {
    expect(lessonsStartScreen(false, true)).toBe('welcome')
    expect(lessonsStartScreen(false, false)).toBe('welcome')
  })

  it('with saved progress: the progress screen when asked, else home', () => {
    expect(lessonsStartScreen(true, true)).toBe('progress')
    expect(lessonsStartScreen(true, false)).toBe('home')
  })
})
