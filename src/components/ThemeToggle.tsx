import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { THEME_EVENT, getTheme, setTheme } from '../theme'
import type { Theme } from '../theme'

const OPTIONS: { v: Theme; label: string }[] = [
  { v: 'system', label: 'Match device' },
  { v: 'light', label: 'Light' },
  { v: 'dark', label: 'Dark' },
]

function Icon({ v }: { v: Theme }) {
  if (v === 'light')
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="3" fill="currentColor" />
        <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  if (v === 'dark')
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13.2 10.2A5.6 5.6 0 0 1 5.8 2.8a5.6 5.6 0 1 0 7.4 7.4Z" fill="currentColor" />
      </svg>
    )
  // half light, half dark: follows the device
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2Z" fill="currentColor" />
    </svg>
  )
}

/** Light / dark / match device, as a small radio group for the top bar. */
export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(getTheme)
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  // stay in step with any other toggle on the page
  useEffect(() => {
    const sync = () => setLocal(getTheme())
    window.addEventListener(THEME_EVENT, sync)
    return () => window.removeEventListener(THEME_EVENT, sync)
  }, [])

  const pick = (t: Theme) => {
    setTheme(t)
    setLocal(t)
  }

  // radio-group keys: arrows move and select, focus follows
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const n = (i + step + OPTIONS.length) % OPTIONS.length
    pick(OPTIONS[n].v)
    refs.current[n]?.focus()
  }

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map((o, i) => (
        <button
          key={o.v}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={theme === o.v}
          aria-label={o.label}
          title={o.label}
          tabIndex={theme === o.v ? 0 : -1}
          className={theme === o.v ? 'on' : undefined}
          onClick={() => pick(o.v)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <Icon v={o.v} />
        </button>
      ))}
    </div>
  )
}
