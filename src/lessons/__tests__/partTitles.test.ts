import { describe, expect, it } from 'vitest'
import { lessonById, lessonTitle, registerLesson } from '../data'
import type { Lesson } from '../types'

describe("a song part's name outlives a reload", () => {
  it('is kept when the part is built, so the plan and the coach can say "Numb: Intro" before the songs are read again', () => {
    registerLesson({ ...(lessonById('w1-02') as Lesson), id: 'song:numb2:0', title: 'Numb: Intro' })
    expect(JSON.parse(localStorage.getItem('song-part-titles') ?? '{}')['song:numb2:0']).toBe('Numb: Intro')
    expect(lessonTitle('song:numb2:0')).toBe('Numb: Intro')
    expect(lessonTitle('song:gone:3')).toBeUndefined()
  })
})
