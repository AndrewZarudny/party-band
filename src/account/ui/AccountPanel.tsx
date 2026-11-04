import { useEffect, useRef, useState } from 'react'
import { useAccount } from '../session'
import { signInFlow } from '../sync'

/** Sign in or create an account, in a modal. Accounts live on this computer's Fretwise. */
export function AccountPanel({ initial, initialName, onClose }: { initial: 'signup' | 'login'; initialName?: string; onClose: () => void }) {
  const { progress } = useAccount()
  const [mode, setMode] = useState(initial)
  const [name, setName] = useState(initialName ?? '')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const locked = busy || progress !== null

  useEffect(() => {
    first.current?.focus()
  }, [])

  // The form gives way to the progress line: keep focus inside the dialog.
  const syncing = progress !== null
  useEffect(() => {
    if (syncing) box.current?.focus()
  }, [syncing])

  // Escape closes (not while saving); Tab stays inside the dialog. Heard first and kept from the app's own
  // shortcuts behind the dialog (Space starting the jam, Escape closing a lessons panel); typing still works.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      ev.stopPropagation()
      if (ev.key === 'Escape' && !locked) {
        ev.preventDefault()
        onClose()
        return
      }
      if (ev.key !== 'Tab' || !box.current) return
      const items = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
      if (!items.length) {
        ev.preventDefault()
        return
      }
      const i = items.indexOf(document.activeElement as HTMLElement)
      if (ev.shiftKey && i <= 0) {
        ev.preventDefault()
        items[items.length - 1].focus()
      } else if (!ev.shiftKey && i === items.length - 1) {
        ev.preventDefault()
        items[0].focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [locked, onClose])

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await signInFlow(mode, name.trim(), pw)
      // The page reloads from here.
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Something went wrong. Try again.')
      setBusy(false)
    }
  }

  const signup = mode === 'signup'
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : null
  return (
    <div
      className="acct-backdrop"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget && !locked) onClose()
      }}
    >
      <div ref={box} tabIndex={-1} className="acct-dialog" role="dialog" aria-modal="true" aria-labelledby="acct-dialog-h" aria-describedby="acct-dialog-sub">
        <header className="acct-dialog-head">
          <h2 id="acct-dialog-h">{signup ? 'Create your account' : 'Sign in'}</h2>
          {!locked && (
            <button type="button" className="acct-close" onClick={onClose}>
              Close
            </button>
          )}
        </header>
        <p id="acct-dialog-sub" className="acct-sub">
          {signup
            ? 'Everything in this browser is saved to it.'
            : 'Your songs, tones, recordings and lessons follow you to any browser on this computer and on your Wi-Fi.'}
        </p>
        {progress ? (
          <div className="acct-progress" role="status" aria-live="polite">
            <p>{progress.label}</p>
            <div className={`acct-bar ${pct === null ? 'busy' : ''}`}>
              <i style={pct === null ? undefined : { width: `${pct}%` }} />
            </div>
          </div>
        ) : (
          <>
            <form
              className="acct-form"
              onSubmit={(ev) => {
                ev.preventDefault()
                void submit()
              }}
            >
              <label>
                <span>Name</span>
                <input ref={first} value={name} maxLength={24} autoComplete="username" disabled={busy} onChange={(ev) => setName(ev.target.value)} />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={pw}
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  disabled={busy}
                  onChange={(ev) => setPw(ev.target.value)}
                />
                {signup && <small>At least 6 characters. Don't reuse a password from another site.</small>}
              </label>
              {err && (
                <p className="acct-err" role="alert">
                  {err}
                </p>
              )}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}
              </button>
            </form>
            <p className="acct-switch">
              {signup ? 'Already have one? ' : 'New here? '}
              <button
                type="button"
                className="acct-link"
                disabled={busy}
                onClick={() => {
                  setMode(signup ? 'login' : 'signup')
                  setErr(null)
                }}
              >
                {signup ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
