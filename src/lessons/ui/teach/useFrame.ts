// Small hooks for the teaching demos: one rAF loop, reduced motion, element width, on-screen.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { onStillChange, prefersStill } from '../../runwayDraw'

/** Calls cb(nowSec) every animation frame while `active` and the element is on screen and the tab visible. */
export function useFrame(cb: (nowSec: number) => void, active: boolean, el?: RefObject<Element | null>) {
  const fn = useRef(cb)
  useLayoutEffect(() => {
    fn.current = cb
  })
  useEffect(() => {
    if (!active) return
    let id = 0
    let seen = true
    let io: IntersectionObserver | null = null
    const node = el?.current
    if (node && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((es) => {
        seen = es.some((e) => e.isIntersecting)
      })
      io.observe(node)
    }
    const tick = () => {
      id = requestAnimationFrame(tick)
      if (!seen || document.hidden) return
      fn.current(performance.now() / 1000)
    }
    fn.current(performance.now() / 1000) // the first frame now, so the first paint is already placed
    id = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(id)
      io?.disconnect()
    }
  }, [active, el])
}

/** True while the viewer asks for reduced motion. */
export function useStill(): boolean {
  const [still, setStill] = useState(prefersStill)
  useEffect(() => onStillChange(setStill), [])
  return still
}

/** The element's content width in CSS px (0 until measured). */
export function useWidth(el: RefObject<Element | null>): number {
  const [w, setW] = useState(0)
  useEffect(() => {
    const node = el.current
    if (!node) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measures the element once now; the ResizeObserver follows changes
    setW(Math.round(node instanceof HTMLElement ? node.clientWidth : node.getBoundingClientRect().width)) // now; the observer follows changes
    const ro = new ResizeObserver((es) => {
      const cw = Math.round(es[0]?.contentRect.width ?? 0)
      setW((old) => (old === cw ? old : cw))
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [el])
  return w
}
