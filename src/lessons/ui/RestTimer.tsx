import { useEffect, useRef, useState } from 'react'
import './timing.css'

const R = 20
const C = 2 * Math.PI * R

/** A short rest between reps: a countdown with a thin ring, and a "Go now" button. */
export function RestTimer({ sec, onDone }: { sec: number; onDone: () => void }) {
  const [left, setLeft] = useState(sec)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    const end = performance.now() + sec * 1000
    let fired = false
    const id = window.setInterval(() => {
      const l = Math.max(0, Math.ceil((end - performance.now()) / 1000))
      setLeft(l)
      if (l === 0 && !fired) {
        fired = true
        window.clearInterval(id)
        done.current()
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [sec])

  // screen readers hear every 5 seconds, not every second
  const spoken = left === sec || left % 5 === 0 ? left : Math.ceil(left / 5) * 5
  const share = sec > 0 ? left / sec : 0

  return (
    <div className="tm-rest">
      <svg className="tm-rest-ring" viewBox="0 0 48 48" aria-hidden>
        <circle className="tm-rest-track" cx="24" cy="24" r={R} />
        <circle className="tm-rest-left" cx="24" cy="24" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - share)} />
        <text x="24" y="24" className="ls-num">
          {left}
        </text>
      </svg>
      <span className="ls-sr" aria-live="polite">
        {spoken} seconds of rest left
      </span>
      <button className="ls-btn small" onClick={() => done.current()}>
        Go now
      </button>
    </div>
  )
}
