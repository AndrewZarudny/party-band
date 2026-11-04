import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../account.css'
import type { SyncStatus } from '../session'
import { closeAccountDialog, openAccountDialog, useAccount } from '../session'
import { reloadWithUpdates, signOutFlow } from '../sync'
import { AccountPanel } from './AccountPanel'
import { PracticeCard } from '../../practice/ui/PracticeCard'
import { PracticePanel } from '../../practice/ui/PracticePanel'
import { fmtDuration, usePractice } from '../../practice/stats'

const SHORT: Record<SyncStatus, string> = {
  guest: 'guest',
  saved: 'saved',
  saving: 'saving',
  offline: 'offline',
  'signed-out': 'signed out',
  error: 'not saving',
}

/** The top bar's account control: Sign in for guests, the name and save state when signed in. */
export function AccountMenu() {
  const st = useAccount()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [outBusy, setOutBusy] = useState(false)
  const [outErr, setOutErr] = useState<string | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const closeDialog = useCallback(() => {
    closeAccountDialog()
    btn.current?.focus()
  }, [])
  const [practiceOpen, setPracticeOpen] = useState(false)
  const closePractice = useCallback(() => {
    setPracticeOpen(false)
    btn.current?.focus()
  }, [])
  const today = usePractice().today

  // The menu closes on a click outside it or on Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (ev: MouseEvent) => {
      if (!wrap.current?.contains(ev.target as Node)) setOpen(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Keys pressed on these buttons stay here: Space on "Sign out" mustn't also start the jam behind it.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!wrap.current?.contains(ev.target as Node)) return
      ev.stopPropagation()
      if (ev.key === 'Escape' && open) {
        setOpen(false)
        btn.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const signOut = async (force: boolean) => {
    setOutBusy(true)
    setOutErr(null)
    try {
      const r = await signOutFlow(force)
      if (r === 'confirm') setConfirm(true)
      // Otherwise the page reloads as a guest.
    } catch (err) {
      setOutErr(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    }
    setOutBusy(false)
  }

  const a = st.account
  // Rendered on <body> so it sits over everything, not inside the top bar.
  const dialog =
    st.dialog &&
    createPortal(
      <AccountPanel key={st.dialog} initial={st.dialog} initialName={st.status === 'signed-out' ? a?.name : undefined} onClose={closeDialog} />,
      document.body,
    )
  const practicePanel = practiceOpen && createPortal(<PracticePanel guest={!a} onClose={closePractice} />, document.body)
  const practiceCard = (
    <PracticeCard
      onOpen={() => {
        setOpen(false)
        setPracticeOpen(true)
      }}
    />
  )

  if (!a)
    return (
      <div className="acct" ref={wrap}>
        <button
          ref={btn}
          className="prac-btn"
          title="Practice time"
          aria-label={`Practice time, today ${fmtDuration(today)}`}
          aria-expanded={open}
          aria-controls="acct-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="prac-btn-text">{fmtDuration(today)}</span>
        </button>
        <button className="acct-signin" onClick={() => openAccountDialog('login')}>
          Sign in
        </button>
        {open && (
          <div id="acct-menu" className="acct-menu" role="group" aria-label="Practice time">
            {practiceCard}
            <p className="prac-guest-note">Kept in this browser only. Sign in to keep it in your account.</p>
            <button
              className="btn small primary"
              onClick={() => {
                setOpen(false)
                openAccountDialog('login')
              }}
            >
              Sign in
            </button>
          </div>
        )}
        {dialog}
        {practicePanel}
      </div>
    )

  const line =
    st.status === 'saved'
      ? 'Saved to your account'
      : st.status === 'saving'
        ? 'Saving…'
        : st.status === 'offline'
          ? 'Offline. Changes will sync.'
          : st.status === 'signed-out'
            ? 'Signed out. Sign in to keep saving.'
            : (st.error ?? 'Not saving right now.')
  const label = `${a.name}, ${SHORT[st.status]}`

  return (
    <div className="acct" ref={wrap}>
      {st.reloadReady && (
        <button
          className="acct-reload"
          onClick={() => void reloadWithUpdates()}
          disabled={st.progress !== null}
          title="Updated elsewhere. Reload"
          aria-label={st.progress && !st.dialog ? 'Updating…' : 'Updated elsewhere. Reload'}
        >
          {st.progress && !st.dialog ? (
            'Updating…'
          ) : (
            <>
              <span className="long">Updated elsewhere. Reload</span>
              <span className="short">Reload</span>
            </>
          )}
        </button>
      )}
      <button
        ref={btn}
        className="acct-btn"
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-controls="acct-menu"
        onClick={() => {
          setOpen((o) => !o)
          setConfirm(false)
          setOutErr(null)
        }}
      >
        <span className={`acct-dot ${st.status}`} aria-hidden="true" />
        <span className="acct-name">{a.name}</span>
      </button>
      {open && (
        <div id="acct-menu" className="acct-menu" role="group" aria-label="Account">
          <p className="acct-line" role="status">
            <span className={`acct-dot ${st.status}`} aria-hidden="true" />
            {line}
          </p>
          {st.status === 'signed-out' && (
            <button
              className="btn small primary"
              onClick={() => {
                setOpen(false)
                openAccountDialog('login')
              }}
            >
              Sign in
            </button>
          )}
          {practiceCard}
          {confirm ? (
            <div className="acct-confirm">
              <p>Some changes haven't reached your account yet. Sign out anyway? They'll be kept in a backup on this browser.</p>
              <div className="acct-row">
                <button className="btn small" disabled={outBusy} onClick={() => void signOut(true)}>
                  Sign out anyway
                </button>
                <button className="btn small" disabled={outBusy} onClick={() => setConfirm(false)}>
                  Stay signed in
                </button>
              </div>
            </div>
          ) : (
            <button className="btn small" disabled={outBusy} onClick={() => void signOut(false)}>
              {outBusy ? 'Signing out…' : 'Sign out'}
            </button>
          )}
          {outErr && (
            <p className="acct-err" role="alert">
              {outErr}
            </p>
          )}
        </div>
      )}
      {dialog}
      {practicePanel}
    </div>
  )
}
