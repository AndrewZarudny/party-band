import { describe, expect, it } from 'vitest'
import { lessonTuning } from '../songLesson'

// MIDI, low string first.
const STANDARD = [40, 45, 50, 55, 59, 64]
const DROP_D = [38, 45, 50, 55, 59, 64]

describe('which tunings a song lesson can use', () => {
  it('standard and standard moved down: no retuning, the tab read as standard', () => {
    expect(lessonTuning(STANDARD)).toEqual({ shift: 0, shape: null })
    expect(lessonTuning([39, 44, 49, 54, 58, 63])).toEqual({ shift: 1, shape: null }) // E flat standard
  })

  it('drop tunings: retune to Drop D, the tab keeps its frets', () => {
    expect(lessonTuning(DROP_D)).toEqual({ shift: 0, shape: DROP_D })
    expect(lessonTuning([37, 44, 49, 54, 58, 63])).toEqual({ shift: 1, shape: DROP_D }) // Drop C sharp
    expect(lessonTuning([36, 43, 48, 53, 57, 62])).toEqual({ shift: 2, shape: DROP_D }) // Drop C
  })

  it('open tunings and other string counts are not supported yet', () => {
    expect(lessonTuning([38, 43, 50, 55, 59, 62])).toHaveProperty('error') // Open G
    expect(lessonTuning([35, 40, 45, 50, 55, 59, 64])).toHaveProperty('error') // seven strings
  })
})
