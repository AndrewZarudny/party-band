// What the AI features cost: estimates before a call, the actual cost after it.
import { useEffect, useState } from 'react'

export interface Cost {
  usd: number
  model: string
  searches: number
  cached: boolean
}

export interface AiStatus {
  ai: boolean
  estimates: { 'song-search': number; 'original-tone': number; 'song-setup'?: number; 'lyrics-arrange'?: number }
  models: { 'song-search': string; 'original-tone': string; 'song-setup'?: string; 'lyrics-arrange'?: string }
  monthUsd: number
}

export const usd = (v: number) => (v < 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`)

/** "$0.022 · Haiku 5.5 · 2 web searches", or "from cache, free". */
export const describeCost = (c?: Cost) => (!c ? '' : c.cached ? 'Answered from cache: free' : `Cost ${usd(c.usd)} · ${c.model} · ${c.searches} web search${c.searches === 1 ? '' : 'es'}`)

/** AI availability, typical cost per feature and this month's spend; refreshes when `tick` changes. */
export function useAiStatus(tick = 0): AiStatus | null {
  const [s, setS] = useState<AiStatus | null>(null)
  useEffect(() => {
    fetch('/api/ai-status')
      .then((r) => r.json())
      .then(setS)
      .catch(() => setS(null))
  }, [tick])
  return s
}
