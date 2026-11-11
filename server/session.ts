// Live jam sessions: the host (this Mac) publishes the jam state; participants on the same
// Wi-Fi join with a code and follow it in real time over server-sent events.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type Instrument = 'electric' | 'acoustic' | 'keys' | 'bass' | 'drums' | 'vocals'
const INSTRUMENTS: Instrument[] = ['electric', 'acoustic', 'keys', 'bass', 'drums', 'vocals']

export interface SessionMember {
  id: string
  name: string
  instrument: Instrument
  online: boolean
}

interface Session {
  id: string
  hostId: string | null // the one host page allowed to publish (another tab must take over)
  state: unknown // the host's jam state, passed through as-is
  members: Map<string, SessionMember>
  clients: Map<ServerResponse, string | null> // SSE stream → member id (null for the host)
}

// Saved to disk so a dev-server restart doesn't end a jam in progress.
const SAVE_FILE = path.resolve('.cache', 'live-session.json')
function save() {
  try {
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true })
    if (!session) fs.rmSync(SAVE_FILE, { force: true })
    else fs.writeFileSync(SAVE_FILE, JSON.stringify({ id: session.id, hostId: session.hostId, state: session.state, members: [...session.members.values()] }))
  } catch {
    /* best effort */
  }
}
function restore(): Session | null {
  try {
    const d = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')) as { id: string; hostId: string | null; state: unknown; members: SessionMember[] }
    return { id: d.id, hostId: d.hostId, state: d.state, members: new Map(d.members.map((m) => [m.id, { ...m, online: false }])), clients: new Map() }
  } catch {
    return null
  }
}

let session: Session | null = restore()

/** This Mac's own addresses (loopback and its network interfaces). */
function ownAddresses() {
  const out = new Set(['127.0.0.1', '::1'])
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) out.add(i.address)
  return out
}

/**
 * The request comes from this Mac itself (by localhost or by its own Wi-Fi address).
 * Decided by the socket address only, never the Host header, which any device can fake.
 * Windows + WSL2 (NAT): localhost on Windows arrives as 127.0.0.1 (WSL's localhost forwarding), so
 * it's the host. Phones forwarded by scripts/windows/wifi-access.ps1 arrive from the WSL gateway
 * (the Windows vEthernet address, e.g. 172.26.128.1), which is not one of WSL's own addresses, so
 * they stay guests. So does the Windows PC when it opens its own Wi-Fi address: use localhost there.
 */
export function isLocal(req: IncomingMessage) {
  const a = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  return ownAddresses().has(a)
}

/** This PC's Wi-Fi addresses saved by scripts/windows/wifi-access.ps1 (inside WSL the server only sees its own). */
function forwardedHosts(port: number): string[] {
  try {
    const d = JSON.parse(fs.readFileSync(path.resolve('.cache', 'lan-hosts.json'), 'utf8')) as { port?: unknown; hosts?: unknown }
    if (d.port !== port || !Array.isArray(d.hosts)) return []
    return d.hosts.filter((h): h is string => typeof h === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(h))
  } catch {
    return []
  }
}

function lanUrls(port: number, id: string) {
  const urls: string[] = forwardedHosts(port).map((h) => `http://${h}:${port}/join/${id}`)
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${port}/join/${id}`)
  return urls
}

function broadcast() {
  save()
  if (!session) return
  const msg = `data: ${JSON.stringify({ id: session.id, state: session.state, members: [...session.members.values()] })}\n\n`
  for (const res of session.clients.keys()) res.write(msg)
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 200_000) {
        req.destroy()
        reject(new Error('Body too large'))
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const MAX_MEMBERS = 24
const wrongCodes = new Map<string, number[]>() // Wi-Fi address → recent wrong session codes

const code = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')

/**
 * Handles /api/session/* and /api/time. Returns false for other paths.
 * Host-only: create, update state, end. Anyone on the network: time, events, join, leave.
 */
export async function handleSession(req: IncomingMessage, res: ServerResponse, port: number): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x')
  const p = url.pathname

  // Clock sync: participants measure their offset to this server's clock.
  if (p === '/api/time') {
    json(res, 200, { now: Date.now() })
    return true
  }
  if (!p.startsWith('/api/session')) return false

  if (p === '/api/session' && req.method === 'POST') {
    if (!isLocal(req)) return json(res, 403, { error: 'Only the host can start a session' }), true
    const { hostId, takeOver, id } = JSON.parse((await readBody(req)) || '{}') as { hostId?: string; takeOver?: boolean; id?: string }
    // The host page asks for its old code back if the server lost the session, so phones reconnect.
    if (!session) session = { id: id && /^[A-Z0-9]{4}$/.test(id) ? id : code(), hostId: null, state: null, members: new Map(), clients: new Map() }
    // A session belongs to one host page; another page sees it but must take over explicitly.
    if (session.hostId && hostId && session.hostId !== hostId && !takeOver) {
      json(res, 200, { id: session.id, urls: lanUrls(port, session.id), elsewhere: true })
      return true
    }
    if (hostId) session.hostId = hostId
    json(res, 200, { id: session.id, urls: lanUrls(port, session.id), members: [...session.members.values()] })
    return true
  }
  if (p === '/api/session/state' && req.method === 'POST') {
    if (!isLocal(req)) return json(res, 403, { error: 'Host only' }), true
    if (!session) return json(res, 404, { error: 'No session' }), true
    const from = req.headers['x-host-id']
    if (session.hostId && from !== session.hostId) return json(res, 409, { error: 'Another window is hosting this session' }), true
    session.state = JSON.parse(await readBody(req))
    broadcast()
    json(res, 200, { ok: true })
    return true
  }
  if (p === '/api/session/end' && req.method === 'POST') {
    if (!isLocal(req)) return json(res, 403, { error: 'Host only' }), true
    if (session) {
      const msg = `data: ${JSON.stringify({ ended: true })}\n\n`
      for (const r of session.clients.keys()) r.end(msg)
    }
    session = null
    save()
    json(res, 200, { ok: true })
    return true
  }

  // /api/session/<code>/events | join | leave
  const m = /^\/api\/session\/([A-Z0-9]{4})\/(events|join|leave)$/.exec(p)
  if (!m) return json(res, 404, { error: 'Not found' }), true
  if (!session || session.id !== m[1]) {
    // Guessing codes from the Wi-Fi: a handful of wrong ones, then wait.
    if (!isLocal(req)) {
      const addr = req.socket.remoteAddress ?? ''
      const now = Date.now()
      const recent = (wrongCodes.get(addr) ?? []).filter((t) => now - t < 10 * 60 * 1000)
      recent.push(now)
      wrongCodes.set(addr, recent)
      if (recent.length > 20) return json(res, 429, { error: 'Too many tries. Wait a few minutes.' }), true
    }
    return json(res, 404, { error: 'That session has ended or the code is wrong.' }), true
  }
  const s = session

  if (m[2] === 'events') {
    const memberId = url.searchParams.get('member')
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    s.clients.set(res, isLocal(req) && !memberId ? null : memberId)
    const member = memberId ? s.members.get(memberId) : undefined
    if (member) member.online = true
    broadcast()
    // Keep idle connections (phones, proxies) from timing out.
    const ping = setInterval(() => res.write(': ping\n\n'), 15000)
    req.on('close', () => {
      clearInterval(ping)
      s.clients.delete(res)
      if (member && ![...s.clients.values()].includes(member.id)) member.online = false
      broadcast()
    })
    return true
  }
  if (m[2] === 'join' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req)) as { id?: string; name?: string; instrument?: string }
    const instrument = INSTRUMENTS.includes(body.instrument as Instrument) ? (body.instrument as Instrument) : 'acoustic'
    const name = String(body.name ?? '').trim().slice(0, 24) || 'Player'
    // Rejoining (page reload) keeps the same id, so the host keeps their role settings.
    // Rejoining keeps the same id (also after a server restart), so the host keeps their role.
    const id = body.id && /^m[a-z0-9]{4,20}$/.test(body.id) ? body.id : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    // A band, not a crowd: a full session takes no new members (rejoining with a known id still works).
    if (!s.members.has(id) && s.members.size >= MAX_MEMBERS) return json(res, 429, { error: 'This session is full.' }), true
    s.members.set(id, { id, name, instrument, online: false })
    broadcast()
    json(res, 200, { id })
    return true
  }
  if (m[2] === 'leave' && req.method === 'POST') {
    const { id } = JSON.parse(await readBody(req)) as { id?: string }
    if (id) s.members.delete(id)
    broadcast()
    json(res, 200, { ok: true })
    return true
  }
  json(res, 405, { error: 'Method not allowed' })
  return true
}
