// Calls to this computer's Fretwise account server (/api/accounts/...). Errors come back as plain sentences.
import type { RecordStore } from './notify'

const BASE = '/api/accounts/'

const MESSAGES: Record<string, string> = {
  name: 'Use 2 to 24 characters for the name.',
  password: 'Use at least 6 characters for the password.',
  taken: 'That name is taken. Sign in instead, or pick another.',
  wrong: "That name and password don't match.",
  wait: 'Too many tries. Wait a few minutes and try again.',
  'signed-out': 'You were signed out. Sign in again.',
  full: 'No room for more accounts on this computer.',
  quota: 'Your account is full (1 GB). Remove some recordings to keep saving.',
  'too-large': 'A file is too big to save to your account (over 100 MB).',
  network: "Can't reach Fretwise. Is it still running on the computer?",
  busy: 'Fretwise is busy. Trying again shortly.',
  disk: 'The computer running Fretwise is out of room for account files.',
}

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, status: number) {
    super(MESSAGES[code] ?? 'Something went wrong. Try again.')
    this.code = code
    this.status = status
  }
}

/** Not reachable right now (no network, server stopped or failing): try again later. */
export const isOffline = (err: unknown) => err instanceof ApiError && (err.code === 'network' || err.code === 'busy' || err.status >= 500)

interface Opts {
  method?: string
  token?: string
  json?: unknown
  body?: BodyInit
  signal?: AbortSignal
  keepalive?: boolean
  /** Give up after this long (JSON calls; file transfers have none). A timeout counts as offline: try again later. */
  timeoutMs?: number
}

async function send(path: string, o: Opts): Promise<Response> {
  const headers: Record<string, string> = {}
  if (o.token) headers.Authorization = `Bearer ${o.token}`
  if (o.json !== undefined) headers['Content-Type'] = 'application/json'
  else if (o.body !== undefined) headers['Content-Type'] = 'application/octet-stream'
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method: o.method ?? 'GET',
      headers,
      body: o.json !== undefined ? JSON.stringify(o.json) : o.body,
      signal: o.signal ?? (o.timeoutMs && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(o.timeoutMs) : undefined),
      keepalive: o.keepalive,
      cache: 'no-store',
    })
  } catch (err) {
    if (o.signal?.aborted) throw err
    throw new ApiError('network', 0)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown }
    throw new ApiError(typeof body.error === 'string' ? body.error : res.status >= 500 ? 'server' : 'unknown', res.status)
  }
  return res
}

async function json<T>(path: string, o: Opts): Promise<T> {
  // A server that never answers (a hung database) must not leave the tab saving forever.
  const res = await send(path, { timeoutMs: 20000, ...o })
  return (await res.json()) as T
}

// ---- Auth ----------------------------------------------------------------------

export interface AuthResult {
  token: string
  id: string
  name: string
  rev: number
}

export const auth = (mode: 'signup' | 'login', name: string, password: string) =>
  json<AuthResult>(mode, { method: 'POST', json: { name, password } })

export const me = (token: string, signal?: AbortSignal) =>
  json<{ id: string; name: string; rev: number; usage: { bytes: number; limit: number } }>('me', { token, signal })

export const logout = (token: string) => json<{ ok: true }>('logout', { method: 'POST', token, json: {} })

// ---- Changes -------------------------------------------------------------------

export interface KvItem {
  v: string | null
  t: number
  rev?: number // the account's version of this key (in pulls and stale answers)
  base?: number // list keys being sent: the account version they were based on
}

export interface RecordItem {
  store: RecordStore
  id: string
  meta: Record<string, unknown> | null
  hash: string | null
  size: number
  t: number
  deleted?: true
}

export interface Changes {
  rev: number
  kv: Record<string, KvItem>
  records: RecordItem[]
}

export const changes = (token: string, since: number, signal?: AbortSignal) => json<Changes>(`changes?since=${since}`, { token, signal })

// ---- Content -------------------------------------------------------------------

/** True when the account already has these bytes. */
export async function hasContent(token: string, hash: string): Promise<boolean> {
  try {
    await send(`content/${hash}`, { method: 'HEAD', token })
    return true
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return false
    throw err
  }
}

export const putContent = (token: string, hash: string, data: ArrayBuffer) =>
  json<{ hash: string; size: number }>(`content/${hash}`, { method: 'PUT', token, body: data })

/** Downloads content, reporting bytes as they arrive. */
export async function getContent(token: string, hash: string, onBytes?: (n: number) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await send(`content/${hash}`, { token, signal })
  if (!res.body || !onBytes) return res.arrayBuffer()
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    total += value.length
    onBytes(value.length)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out.buffer
}

// ---- Push ----------------------------------------------------------------------

export interface KvResult {
  rev: number
  applied: string[]
  revs?: Record<string, number> // applied key → its new rev
  stale: Record<string, KvItem>
  rejected: Record<string, string>
}

export const putKv = (token: string, items: Record<string, KvItem>) => json<KvResult>('kv', { method: 'PUT', token, json: { items } })

/** The tab is closing: send what fits in a keepalive request and don't wait for the answer. */
export function putKvKeepalive(token: string, items: Record<string, KvItem>): void {
  void send('kv', { method: 'PUT', token, json: { items }, keepalive: true }).catch(() => {})
}

export interface RecordsResult {
  rev: number
  applied: string[]
  stale: RecordItem[]
  missing: string[]
  rejected: Record<string, string>
}

export type PushRecord = RecordItem | { store: RecordStore; id: string; t: number; deleted: true }

export const putRecords = (token: string, items: PushRecord[]) => json<RecordsResult>('records', { method: 'PUT', token, json: { items } })
