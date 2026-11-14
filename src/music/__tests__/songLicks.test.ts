import { describe, expect, it } from 'vitest'
import { fitsScale, pickLick } from '../songLicks'
import { STANDARD_TUNING } from '../theory'

const n = (string: number, fret: number) => ({ string, fret, midi: STANDARD_TUNING[string] + fret })
const A_MINOR_PENT = [9, 0, 2, 4, 7] // A C D E G

describe('licks from your songs in the jam', () => {
  it('only licks with every note in the scale', () => {
    expect(fitsScale([n(3, 5), n(3, 7), n(4, 5)], A_MINOR_PENT)).toBe(true) // C D E
    expect(fitsScale([n(3, 5), n(3, 6)], A_MINOR_PENT)).toBe(false) // C and C#: C# is out
  })

  it('a lick that ends on a chord tone first, so it lands', () => {
    const ending = (midi: number) => [n(3, 5), { ...n(3, 7), midi }]
    const onA = ending(57) // ends on A
    const onD = ending(62) // ends on D
    const am = [9, 0, 4] // A C E
    for (let i = 0; i < 5; i++) expect(pickLick([onD, onA], am, () => i / 5)).toBe(onA)
    expect(pickLick([onD], am)).toBe(onD) // none lands: any
    expect(pickLick([], am)).toBeNull()
  })
})
