// TONE3000 sign-in (OAuth 2.0 + PKCE with the user's publishable key) and the Select flow.
// Docs: https://www.tone3000.com/api

const API = 'https://www.tone3000.com/api/v1'
export const REDIRECT_PATH = '/tone3000/callback'
export const redirectUri = () => `${location.origin}${REDIRECT_PATH}`

export interface T3kUser {
  id: number | string
  username: string
  avatar_url?: string | null
  url?: string
}

export interface T3kTone {
  id: number
  title: string
  description?: string | null
  gear: 'amp' | 'amp-cab' | 'pedal' | 'outboard' | 'cab' | 'space' | 'experimental'
  format: 'nam' | 'ir' | 'aida-x' | 'aa-snapshot' | 'proteus'
  license: string
  images?: string[] | null
  user: T3kUser
  url?: string
  makes?: { name: string }[]
}

export interface T3kModel {
  id: number
  name: string
  size?: string | null
  model_url: string
  architecture_version?: number | string | null
}

// ---- Settings and tokens --------------------------------------------------

const read = <T,>(k: string, store: Storage = localStorage): T | null => {
  try {
    return JSON.parse(store.getItem(k) ?? 'null') as T | null
  } catch {
    return null
  }
}
const write = (k: string, v: unknown, store: Storage = localStorage) => {
  try {
    if (v === null) store.removeItem(k)
    else store.setItem(k, JSON.stringify(v))
  } catch {
    /* storage unavailable */
  }
}

export const getClientId = () => read<string>('t3k-client-id')
export const setClientId = (id: string | null) => write('t3k-client-id', id?.trim() || null)

interface Tokens {
  access: string
  refresh: string
  expiresAt: number
}
const getTokens = () => read<Tokens>('t3k-tokens')
export const isSignedIn = () => !!getTokens()
export const signOut = () => write('t3k-tokens', null)

// ---- Transport: direct, or through the local server if the browser blocks it (CORS) --

async function t3kFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    return fetch('/api/t3k', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, ...init }) })
  }
}

async function tokenRequest(fields: Record<string, string>): Promise<void> {
  const res = await t3kFetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })
  if (!res.ok) {
    if (fields.grant_type === 'refresh_token') signOut()
    throw new Error(`TONE3000 sign-in failed (${res.status})`)
  }
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  write('t3k-tokens', { access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 })
}

async function accessToken(): Promise<string> {
  const t = getTokens()
  const clientId = getClientId()
  if (!t || !clientId) throw new Error('Not signed in to TONE3000')
  if (Date.now() < t.expiresAt) return t.access
  await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId })
  return getTokens()!.access
}

async function api<T>(path: string): Promise<T> {
  const res = await t3kFetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } })
  if (!res.ok) throw new Error(`TONE3000 request failed (${res.status})`)
  return (await res.json()) as T
}

// TONE3000 hides A2 captures unless asked (legacy default is A1 + custom), and the browser
// engine only runs A2, so every request says architecture=2.
export const getTone = (id: number | string) => api<T3kTone>(`/tones/${id}?architecture=2`)
export async function listModels(toneId: number | string, ir = false): Promise<T3kModel[]> {
  // Up to 300 per page (the API maximum); big packs have 100+ versions. IRs have no architecture.
  const r = await api<{ data?: T3kModel[] } | T3kModel[]>(`/models?tone_id=${toneId}&page_size=300${ir ? '' : '&architecture=2'}`)
  return Array.isArray(r) ? r : (r.data ?? [])
}

/** Downloads one model file (.nam JSON or IR .wav) on the user's behalf. */
export async function downloadModel(m: T3kModel): Promise<ArrayBuffer> {
  const res = await t3kFetch(m.model_url, { headers: { Authorization: `Bearer ${await accessToken()}` } })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.arrayBuffer()
}

// ---- Select flow ----------------------------------------------------------

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export interface SelectContext {
  songId: string
  track: string
  variant: string
  slot: 'capture' | 'ir'
  plan?: boolean // part of "Get original tone"
}

/** Sends the user to TONE3000 to pick a tone; they come back to REDIRECT_PATH. */
export function startSelect(slot: 'capture' | 'ir', context: SelectContext) {
  return authorize(context, slot === 'ir' ? { prompt: 'select_tone', format: 'ir' } : { prompt: 'select_tone', format: 'nam', architecture: '2', gears: 'amp_amp-cab_pedal' })
}

/** Loads one specific tone (by id) through TONE3000's Load Tone flow. */
export function startLoad(toneId: string, context: SelectContext) {
  return authorize(context, { prompt: 'load_tone', tone_id: toneId, architecture: '2' })
}

async function authorize(context: SelectContext, extra: Record<string, string>) {
  const clientId = getClientId()
  if (!clientId) throw new Error('Add your TONE3000 publishable key first')
  const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const state = crypto.randomUUID().replace(/-/g, '')
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  write('t3k-flow', { verifier, state, context }, sessionStorage)
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    menubar: 'true',
    ...extra,
  })
  location.href = `${API}/oauth/authorize?${params}`
}

export type SelectResult = { toneId: string; context: SelectContext } | { canceled: true; context?: SelectContext } | { error: string; context?: SelectContext }

/** Handles the return from TONE3000 (call once on page load). Null when this isn't a callback. */
export async function handleCallback(): Promise<SelectResult | null> {
  if (location.pathname !== REDIRECT_PATH) return null
  const q = new URLSearchParams(location.search)
  const flow = read<{ verifier: string; state: string; context: SelectContext }>('t3k-flow', sessionStorage)
  write('t3k-flow', null, sessionStorage)
  history.replaceState(null, '', '/')
  const context = flow?.context
  if (q.get('error')) return { error: q.get('error') === 'access_denied' ? 'Access was denied.' : `TONE3000: ${q.get('error')}`, context }
  if (!flow || q.get('state') !== flow.state) return { error: 'Sign-in could not be verified. Please try again.', context }
  const code = q.get('code')
  if (code) {
    try {
      await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: flow.verifier, redirect_uri: redirectUri(), client_id: getClientId() ?? '' })
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), context }
    }
  }
  const toneId = q.get('tone_id')
  if (q.get('canceled') === 'true' || !toneId) return { canceled: true, context }
  return { toneId, context: flow.context }
}

/** What a TONE3000 tone becomes in the app's signal chain. */
export function captureKindFor(tone: T3kTone): 'amp' | 'amp-cab' | 'pedal' {
  if (tone.gear === 'amp-cab') return 'amp-cab'
  if (tone.gear === 'pedal' || tone.gear === 'outboard') return 'pedal'
  return 'amp'
}

const LICENSES: Record<string, string> = {
  t3k: 'TONE3000 license',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
  'cc-by-nc': 'CC BY-NC',
  'cc-by-nc-sa': 'CC BY-NC-SA',
  'cc-by-nd': 'CC BY-ND',
  'cc-by-nc-nd': 'CC BY-NC-ND',
  cco: 'CC0',
}
export const licenseLabel = (l?: string) => (l ? (LICENSES[l] ?? l) : '')

// ---- Popup flow: load a tone without leaving the app ------------------------------

const CHANNEL = 'fretwise-t3k'
const POPUP_NAME = 'fretwise-tone3000'

/** In the popup: hand the callback to the app window and close. Returns true if this is that popup. */
export function relayPopupCallback(): boolean {
  // The popup is recognised by its window name, which survives the trip to TONE3000 and back.
  if (location.pathname !== REDIRECT_PATH || window.name !== POPUP_NAME) return false
  const msg = { type: 't3k-callback', search: location.search }
  try {
    window.opener?.postMessage(msg, location.origin)
  } catch {
    /* opener gone */
  }
  new BroadcastChannel(CHANNEL).postMessage(msg)
  window.close()
  document.body.textContent = 'Tone loaded in Fretwise. You can close this window.'
  return true
}

/**
 * Opens TONE3000's Load Tone page for one tone in a small window. Must be called straight from a
 * click (pop-up blockers). Resolves once the user has signed in/confirmed and the window closed.
 */
export function loadToneInPopup(toneId: string): Promise<string> {
  const clientId = getClientId()
  if (!clientId) return Promise.reject(new Error('Add your TONE3000 publishable key first'))
  const popup = window.open('', POPUP_NAME, 'width=520,height=760')
  if (!popup) return Promise.reject(new Error('Allow pop-ups for localhost:5173 so TONE3000 can open.'))
  popup.document.title = 'TONE3000'
  return (async () => {
    const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const state = crypto.randomUUID().replace(/-/g, '')
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    const redirect = redirectUri()
    popup.location.href = `${API}/oauth/authorize?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      prompt: 'load_tone',
      tone_id: toneId,
      architecture: '2',
    })}`
    const q = await new Promise<URLSearchParams>((resolve, reject) => {
      const bc = new BroadcastChannel(CHANNEL)
      const done = (search: string) => {
        cleanup()
        resolve(new URLSearchParams(search))
      }
      const onMsg = (e: MessageEvent) => {
        if (e.origin === location.origin && e.data?.type === 't3k-callback') done(e.data.search)
      }
      bc.onmessage = (e) => e.data?.type === 't3k-callback' && done(e.data.search)
      let closedFor = 0
      const timer = window.setInterval(() => {
        closedFor = popup.closed ? closedFor + 1 : 0
        if (closedFor > 3) {
          cleanup()
          reject(new Error('The TONE3000 window was closed before the tone loaded.'))
        }
      }, 400)
      const cleanup = () => {
        window.removeEventListener('message', onMsg)
        bc.close()
        clearInterval(timer)
      }
      window.addEventListener('message', onMsg)
    })
    if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'Access was denied on TONE3000.' : `TONE3000: ${q.get('error')}`)
    if (q.get('state') !== state) throw new Error('Sign-in could not be verified. Please try again.')
    const code = q.get('code')
    if (!code) throw new Error('TONE3000 did not return a sign-in code.')
    await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect, client_id: clientId })
    return q.get('tone_id') ?? toneId
  })()
}
