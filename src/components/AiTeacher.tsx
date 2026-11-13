// The top bar's "AI teacher" control: signs Claude Code in on this computer, so the coach runs on your
// Claude subscription. Nothing to type in a terminal: the app runs the sign-in (server/claudeCode.ts).
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ClaudeStatus {
  installed: boolean
  loggedIn: boolean
  authMethod: string | null
  email: string | null
  subscription: string | null
  pending: boolean
  url: string | null
  error: string | null
}

async function getStatus(): Promise<ClaudeStatus | null> {
  try {
    const r = await fetch('/api/claude/status', { cache: 'no-store' })
    return r.ok ? ((await r.json()) as ClaudeStatus) : null
  } catch {
    return null
  }
}

const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

export function AiTeacher() {
  const [st, setSt] = useState<ClaudeStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => setSt(await getStatus()), [])
  useEffect(() => {
    let alive = true
    void getStatus().then((s) => {
      if (alive) setSt(s)
    })
    return () => {
      alive = false
    }
  }, [])

  // While a sign-in waits for the browser, check every 2 s: it usually finishes on its own.
  useEffect(() => {
    if (!open || !st?.pending) return
    const t = setInterval(() => void refresh(), 2000)
    return () => clearInterval(t)
  }, [open, st?.pending, refresh])

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Other devices on the Wi-Fi can't sign this computer in: no button there.
  if (!st) return null

  const signIn = async () => {
    setBusy(true)
    setErr(null)
    const r = await post('/api/claude/login').catch(() => null)
    if (!r?.ok) setErr(((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't start the sign-in.")
    await refresh()
    setBusy(false)
  }

  const sendCode = async () => {
    setBusy(true)
    await post('/api/claude/code', { code }).catch(() => null)
    setCode('')
    // Claude Code checks the code with Anthropic: give it a moment, then look.
    setTimeout(() => {
      void refresh().then(() => setBusy(false))
    }, 2500)
  }

  const cancel = async () => {
    await post('/api/claude/cancel').catch(() => null)
    await refresh()
  }

  const plan = st.subscription ? ` (${st.subscription.replace(/^\w/, (c) => c.toUpperCase())})` : ''
  const dialog =
    open &&
    createPortal(
      <div
        className="acct-backdrop"
        onMouseDown={(ev) => {
          if (ev.target === ev.currentTarget) setOpen(false)
        }}
      >
        <div className="acct-dialog ai-teacher" role="dialog" aria-modal="true" aria-labelledby="ai-teacher-h">
          <header className="acct-dialog-head">
            <h2 id="ai-teacher-h">AI teacher</h2>
            <button type="button" className="acct-close" onClick={() => setOpen(false)}>
              Close
            </button>
          </header>
          <p className="acct-sub">Claude writes your coach notes in Lessons. It runs through Claude Code on this computer, on your Claude subscription: no API key.</p>

          {!st.installed ? (
            <p className="ai-teacher-note">
              Claude Code isn't installed on this computer. Install it from{' '}
              <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">
                claude.com/claude-code
              </a>
              , then open this again.
            </p>
          ) : st.loggedIn ? (
            <div className="ai-teacher-on" role="status">
              <p>
                <span className="ai-dot on" aria-hidden /> Signed in{st.email ? ` as ${st.email}` : ''}
                {plan}.
              </p>
              {st.authMethod && !/claude/i.test(st.authMethod) && (
                <p className="ai-teacher-note">This sign-in bills API usage, not a Claude subscription. To use your subscription, sign out in Claude Code and sign in here again.</p>
              )}
              <p className="ai-teacher-note">Your coach is ready. It is the same sign-in Claude Code uses in the terminal.</p>
            </div>
          ) : st.pending ? (
            <div className="ai-teacher-wait" role="status" aria-live="polite">
              <p>
                <span className="ai-dot busy" aria-hidden /> A Claude sign-in page opened in your browser. Sign in there and click Authorize. This window updates by itself.
              </p>
              {st.url && (
                <p className="ai-teacher-note">
                  No page?{' '}
                  <a href={st.url} target="_blank" rel="noreferrer">
                    Open the sign-in page
                  </a>
                  .
                </p>
              )}
              <form
                className="acct-form"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  if (code.trim()) void sendCode()
                }}
              >
                <label>
                  <span>If the page shows a code, paste it here</span>
                  <input value={code} autoComplete="off" spellCheck={false} disabled={busy} onChange={(ev) => setCode(ev.target.value)} />
                </label>
                <div className="ai-teacher-row">
                  <button type="submit" className="btn primary" disabled={busy || !code.trim()}>
                    {busy ? 'Checking…' : 'Send code'}
                  </button>
                  <button type="button" className="btn" onClick={() => void cancel()}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="acct-form">
              {(err ?? st.error) && (
                <p className="acct-err" role="alert">
                  {err ?? st.error}
                </p>
              )}
              <button type="button" className="btn primary" disabled={busy} onClick={() => void signIn()}>
                {busy ? 'Opening…' : 'Sign in with Claude'}
              </button>
              <p className="ai-teacher-note">Opens the Claude sign-in page in your browser. Use your Claude account (Pro or Max).</p>
            </div>
          )}
        </div>
      </div>,
      document.body,
    )

  return (
    <>
      <button
        className="acct-signin ai-teacher-btn"
        onClick={() => {
          setOpen(true)
          void refresh()
        }}
        title={st.loggedIn ? 'AI teacher: signed in to Claude' : 'AI teacher: sign in to Claude'}
      >
        <span className={`ai-dot ${st.loggedIn ? 'on' : ''}`} aria-hidden /> <span className="long">AI teacher</span>
        <span className="short">AI</span>
      </button>
      {dialog}
    </>
  )
}
