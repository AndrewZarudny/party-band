import { useEffect, useReducer } from 'react'
import { onSampleStatus, sampleStatus } from './bank'
import { bandSound, onBandSound, setBandSound } from './sound'

/** The band's sound choice and sample loading progress, for a switch and a "loading" hint. */
export function useBandSound() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const a = onBandSound(force)
    const b = onSampleStatus(force)
    return () => {
      a()
      b()
    }
  }, [])
  return { sound: bandSound(), setSound: setBandSound, status: sampleStatus() }
}
