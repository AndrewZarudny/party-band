// The accounts API on a real HTTP server, with its files in a temp folder. The same cases run on the JSON
// files (accounts.test.ts) and on MariaDB (accounts.db.test.ts).
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as Accounts from '../accounts'

export type Json = Record<string, unknown>
export interface Reply {
  status: number
  json: Json
}
type ApiOptions = { body?: unknown; token?: string; headers?: Record<string, string>; raw?: Uint8Array }
type RawOptions = { method: string; path: string; headers?: http.OutgoingHttpHeaders; body?: string; end?: boolean }

export interface App {
  dir: string
  base: string
  api(method: string, route: string, o?: ApiOptions): Promise<Reply>
  /** A request sent as written (no URL clean-up); resolves on the answer, whatever happens to the socket after. */
  raw(o: RawOptions): Promise<{ status: number; body: string }>
  /** A fresh copy of the accounts module on the same data, as after a server restart. */
  restart(): Promise<void>
  close(): Promise<void>
}

export const sha = (b: Uint8Array | string) => crypto.createHash('sha256').update(b).digest('hex')

/** Starts the accounts API on its own port. `db` picks MariaDB; `dir` reuses a folder of earlier data. */
export async function startApp(o: { dir?: string; db?: string } = {}): Promise<App> {
  const dir = o.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fretwise-accounts-'))
  let mod: typeof Accounts
  const load = async () => {
    process.env.ACCOUNTS_DIR = dir
    if (o.db) process.env.FRETWISE_DB_URL = o.db
    else delete process.env.FRETWISE_DB_URL
    vi.resetModules()
    mod = await import('../accounts')
    await mod.accountsReady() // reads the settings above now, before another app changes them
  }
  await load()
  const server = http.createServer((req, res) => {
    mod
      .handleAccounts(req, res)
      .then((handled) => {
        if (!handled) {
          res.statusCode = 404
          res.end()
        }
      })
      .catch(() => {
        res.statusCode = 500
        res.end()
      })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const base = `http://127.0.0.1:${port}/api/accounts/`

  async function api(method: string, route: string, a: ApiOptions = {}): Promise<Reply> {
    const headers: Record<string, string> = { ...a.headers }
    if (a.token) headers.authorization = `Bearer ${a.token}`
    let body: string | Uint8Array | undefined = a.raw
    if (a.body !== undefined) {
      body = JSON.stringify(a.body)
      headers['content-type'] ??= 'application/json'
    }
    const res = await fetch(base + route, { method, headers, body })
    const text = await res.text()
    let json: Json = {}
    try {
      json = text ? (JSON.parse(text) as Json) : {}
    } catch {
      json = { text }
    }
    return { status: res.status, json }
  }

  function raw(r: RawOptions): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      let done = false
      const req = http.request({ host: '127.0.0.1', port, method: r.method, path: r.path, headers: r.headers }, (res) => {
        let b = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => (b += c))
        res.on('end', () => {
          done = true
          resolve({ status: res.statusCode ?? 0, body: b })
        })
        res.on('error', () => {})
      })
      req.on('error', (e) => {
        if (!done) reject(e)
      })
      if (r.body) req.write(r.body)
      if (r.end === false) req.flushHeaders()
      else req.end()
    })
  }

  return {
    dir,
    base,
    api,
    raw,
    async restart() {
      await mod.closeAccounts()
      await load()
    },
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
      await mod.closeAccounts()
      delete process.env.ACCOUNTS_DIR
      delete process.env.FRETWISE_DB_URL
      if (!o.dir) fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * The accounts API's rules, the same on every storage. `stored` returns what the storage holds about users and
 * tokens, as text (to check no password is kept as is).
 */
export function accountsSuite(name: string, o: { db?: string; reset?: () => Promise<void>; stored: (app: App) => Promise<string> }) {
  describe(name, () => {
    let app: App
    let token = ''
    const api = (method: string, route: string, a?: ApiOptions) => app.api(method, route, a)
    const signup = (n: string, password = 'secret-pw') => api('POST', 'signup', { body: { name: n, password } })
    const login = (n: string, password = 'secret-pw') => api('POST', 'login', { body: { name: n, password } })

    beforeAll(async () => {
      await o.reset?.()
      app = await startApp({ db: o.db })
    })

    afterAll(async () => {
      await app.close()
    })

    describe('signup, login, logout', () => {
      it('signs up and answers with a token', async () => {
        const r = await signup('  Andy   Rocks ')
        expect(r.status).toBe(200)
        expect(r.json).toMatchObject({ name: 'Andy Rocks', rev: 0 })
        expect(r.json.token).toMatch(/^[0-9a-f]{64}$/)
        token = r.json.token as string
        const kept = await o.stored(app)
        expect(kept).toContain('Andy Rocks')
        // the password is never stored as is
        expect(kept).not.toContain('secret-pw')
      })

      it('refuses a taken name (any case), and bad names or passwords', async () => {
        expect((await signup('andy rocks')).json).toEqual({ error: 'taken' })
        expect((await signup('a')).json).toEqual({ error: 'name' })
        expect((await signup('x'.repeat(25))).json).toEqual({ error: 'name' })
        expect((await signup('Bob', '12345')).json).toEqual({ error: 'password' })
        // half a surrogate pair has no UTF-8 form: the database would keep a different name
        const half = await api('POST', 'signup', { raw: new TextEncoder().encode('{"name":"Ab\\ud800","password":"secret-pw"}'), headers: { 'content-type': 'application/json' } })
        expect(half).toEqual({ status: 400, json: { error: 'name' } })
      })

      it('logs in with the right password only', async () => {
        const bad = await login('Andy Rocks', 'wrong-pw')
        expect(bad).toEqual({ status: 401, json: { error: 'wrong' } })
        expect((await login('nobody here')).status).toBe(401)
        const ok = await login('ANDY ROCKS')
        expect(ok.status).toBe(200)
        expect(ok.json.token).not.toBe(token)
      })

      it('needs a valid token for everything else', async () => {
        expect((await api('GET', 'me')).json).toEqual({ error: 'signed-out' })
        expect((await api('GET', 'me', { token: '0'.repeat(64) })).status).toBe(401)
        expect((await api('GET', 'me', { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
        expect((await api('PUT', 'kv', { body: { items: {} } })).status).toBe(401)
        const me = await api('GET', 'me', { token })
        expect(me.status).toBe(200)
        expect(me.json).toMatchObject({ name: 'Andy Rocks', rev: 0 })
      })

      it('logout ends only that token', async () => {
        const other = (await login('Andy Rocks')).json.token as string
        expect((await api('POST', 'logout', { token: other, body: {} })).json).toEqual({ ok: true })
        expect((await api('GET', 'me', { token: other })).status).toBe(401)
        expect((await api('GET', 'me', { token })).status).toBe(200)
      })

      it('refuses other sites, non-JSON posts and the old data route', async () => {
        const evil = await api('POST', 'signup', { body: { name: 'Mallory', password: 'secret-pw' }, headers: { origin: 'http://evil.example' } })
        expect(evil).toEqual({ status: 403, json: { error: 'origin' } })
        const form = await api('POST', 'login', { raw: new TextEncoder().encode('name=a'), headers: { 'content-type': 'text/plain' } })
        expect(form.status).toBe(415)
        expect((await api('GET', 'data')).status).toBe(410)
        expect((await api('GET', 'nope', { token })).status).toBe(404)
      })
    })

    describe('paths', () => {
      it('refuses path traversal in the content route', async () => {
        for (const p of ['content/../../accounts.json', 'content/..%2F..%2Faccounts.json', 'content/' + 'a'.repeat(63) + 'G', 'content/' + sha('x') + '/../x']) {
          const r = await app.raw({ method: 'GET', path: '/api/accounts/' + p, headers: { authorization: `Bearer ${token}` } })
          expect(r.status, p).toBe(400)
          expect(r.body).not.toContain('tokens')
        }
      })

      it('keys that look like object internals stay plain keys', async () => {
        const body = '{"items":{"__proto__":{"v":"x","t":1},"constructor":{"v":"y","t":1}}}'
        const r = await api('PUT', 'kv', { token, raw: new TextEncoder().encode(body) })
        expect(r.json.applied).toEqual(['__proto__', 'constructor'])
        const ch = await api('GET', 'changes?since=0', { token })
        const keys = Object.keys(ch.json.kv as Json)
        expect(keys).toContain('__proto__')
        expect(keys).toContain('constructor')
      })
    })

    describe('key/values: the stale and base rev rules', () => {
      let rev = 0

      it('applies a new value and bumps the rev', async () => {
        const r = await api('PUT', 'kv', { token, body: { items: { 'lessons-prefs': { v: '{"a":1}', t: 1000 } } } })
        expect(r.status).toBe(200)
        expect(r.json.applied).toEqual(['lessons-prefs'])
        rev = (r.json.revs as Json)['lessons-prefs'] as number
        expect(r.json.rev).toBe(rev)
      })

      it('an older write is stale and gets the current value back', async () => {
        const r = await api('PUT', 'kv', { token, body: { items: { 'lessons-prefs': { v: '{"a":0}', t: 500 } } } })
        expect(r.json.applied).toEqual([])
        expect((r.json.stale as Json)['lessons-prefs']).toEqual({ v: '{"a":1}', t: 1000, rev })
      })

      it('a list edited from an older base rev is stale even with a newer time', async () => {
        const r = await api('PUT', 'kv', { token, body: { items: { 'lessons-prefs': { v: '{"a":2}', t: 2000, base: rev - 1 } } } })
        expect(Object.keys(r.json.stale as Json)).toEqual(['lessons-prefs'])
        const ok = await api('PUT', 'kv', { token, body: { items: { 'lessons-prefs': { v: '{"a":2}', t: 2000, base: rev } } } })
        expect(ok.json.applied).toEqual(['lessons-prefs'])
      })

      it('refuses per-browser keys and bad items', async () => {
        const r = await api('PUT', 'kv', { token, body: { items: { 'fretwise-account': { v: 'x', t: 1 }, 't3k-tokens': { v: 'x', t: 1 }, nonum: { v: 'x' }, notstr: { v: 5, t: 1 } } } })
        expect(r.json.rejected).toEqual({ 'fretwise-account': 'forbidden', 't3k-tokens': 'forbidden', nonum: 'invalid', notstr: 'invalid' })
        expect((await api('PUT', 'kv', { token, body: { items: [] } })).status).toBe(400)
        expect((await api('PUT', 'kv', { token, body: { items: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`k${i}`, { v: '', t: 1 }])) } })).status).toBe(400)
      })

      it('changes since a rev lists only newer items', async () => {
        const all = await api('GET', 'changes?since=0', { token })
        expect((all.json.kv as Json)['lessons-prefs']).toMatchObject({ v: '{"a":2}', t: 2000 })
        const none = await api('GET', `changes?since=${all.json.rev as number}`, { token })
        expect(none.json).toMatchObject({ kv: {}, records: [] })
        expect((await api('GET', 'changes?since=abc', { token })).status).toBe(400)
        expect((await api('GET', 'changes?since=-1', { token })).status).toBe(400)
      })

      it('a delete keeps a tombstone with its rev', async () => {
        const r = await api('PUT', 'kv', { token, body: { items: { 'lessons-prefs': { v: null, t: 3000 } } } })
        expect(r.json.applied).toEqual(['lessons-prefs'])
        const ch = await api('GET', `changes?since=${(r.json.rev as number) - 1}`, { token })
        expect((ch.json.kv as Json)['lessons-prefs']).toMatchObject({ v: null, t: 3000 })
      })

      it('keys differing only in case or a trailing space stay separate (localStorage keys are case-sensitive)', async () => {
        const items = { 'Tone-Mode': { v: 'upper', t: 10 }, 'tone-mode': { v: 'lower', t: 10 }, 'tone-mode ': { v: 'space', t: 10 }, 'TONE-MODE': { v: 'caps', t: 10 } }
        const r = await api('PUT', 'kv', { token, body: { items } })
        expect(r.json.applied).toEqual(Object.keys(items))
        await api('PUT', 'kv', { token, body: { items: { 'tone-mode': { v: 'lower 2', t: 11 } } } })
        const kv = (await api('GET', 'changes?since=0', { token })).json.kv as Record<string, { v: string }>
        expect([kv['Tone-Mode'].v, kv['tone-mode'].v, kv['tone-mode '].v, kv['TONE-MODE'].v]).toEqual(['upper', 'lower 2', 'space', 'caps'])
      })

      it('keeps any Unicode, but refuses half a surrogate pair (it has no UTF-8 form)', async () => {
        const ok = await api('PUT', 'kv', { token, body: { items: { 'emoji-🎸': { v: 'Ünïcødé 🎶 日本', t: 1 } } } })
        expect(ok.json.applied).toEqual(['emoji-🎸'])
        const body = '{"items":{"half-\\ud800":{"v":"x","t":1},"half-value":{"v":"\\udc00","t":1}}}'
        const bad = await api('PUT', 'kv', { token, raw: new TextEncoder().encode(body) })
        expect(bad.json.rejected).toEqual({ 'half-\ud800': 'invalid', 'half-value': 'invalid' })
        const kv = (await api('GET', 'changes?since=0', { token })).json.kv as Record<string, { v: string }>
        expect(kv['emoji-🎸'].v).toBe('Ünïcødé 🎶 日本')
      })
    })

    describe('size limits', () => {
      it('a signup or login body over 4 KB is refused', async () => {
        const r = await api('POST', 'signup', { body: { name: 'Big', password: 'x'.repeat(5000) } })
        expect(r).toEqual({ status: 413, json: { error: 'too-large' } })
      })

      it('a key/value over 4 MB is rejected, the rest of the batch still applies', async () => {
        const r = await api('PUT', 'kv', { token, body: { items: { huge: { v: 'x'.repeat(4 * 1024 * 1024 + 1), t: 1 }, small: { v: 'ok', t: 1 } } } })
        expect(r.json.rejected).toEqual({ huge: 'too-large' })
        expect(r.json.applied).toEqual(['small'])
      })

      it('a 4 MB key/value is kept whole', async () => {
        const v = 'é'.repeat(4 * 1024 * 1024)
        const r = await api('PUT', 'kv', { token, body: { items: { big: { v, t: 1 } } } })
        expect(r.json.applied).toEqual(['big'])
        const kv = (await api('GET', `changes?since=${(r.json.rev as number) - 1}`, { token })).json.kv as Record<string, { v: string }>
        expect(kv.big.v === v).toBe(true)
      })

      it('a file declared over 100 MB is refused before it is read', async () => {
        const r = await app.raw({
          method: 'PUT',
          path: '/api/accounts/content/' + sha('big'),
          headers: { authorization: `Bearer ${token}`, 'content-length': String(200 * 1024 * 1024) },
          end: false,
        })
        expect(r.status).toBe(413)
        expect(JSON.parse(r.body)).toEqual({ error: 'too-large' })
      })

      it('record details over 16 KB are rejected', async () => {
        const bytes = new TextEncoder().encode('song bytes')
        await api('PUT', 'content/' + sha(bytes), { token, raw: bytes })
        const r = await api('PUT', 'records', { token, body: { items: [{ store: 'songs', id: 'big', t: 1, hash: sha(bytes), meta: { pad: 'x'.repeat(17000) } }] } })
        expect(r.json.rejected).toEqual({ 'songs/big': 'too-large' })
      })
    })

    describe('content and records', () => {
      const bytes = new TextEncoder().encode('a recording')
      const hash = sha(bytes)

      it('stores a file under its hash and refuses a wrong hash', async () => {
        expect((await api('PUT', 'content/' + sha('other'), { token, raw: bytes })).json).toEqual({ error: 'hash' })
        const up = await api('PUT', 'content/' + hash, { token, raw: bytes })
        expect(up).toEqual({ status: 200, json: { hash, size: bytes.length } })
        const res = await fetch(app.base + 'content/' + hash, { headers: { authorization: `Bearer ${token}` } })
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
        expect((await fetch(app.base + 'content/' + hash, { method: 'HEAD', headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
        expect((await api('GET', 'content/' + sha('none'), { token })).status).toBe(404)
      })

      it('a record needs its file first; older writes are stale; deletes leave a tombstone', async () => {
        const miss = await api('PUT', 'records', { token, body: { items: [{ store: 'recordings', id: 'r1', t: 10, hash: sha('not uploaded'), meta: {} }] } })
        expect(miss.json.missing).toEqual([sha('not uploaded')])
        const ok = await api('PUT', 'records', { token, body: { items: [{ store: 'recordings', id: 'r1', t: 10, hash, meta: { title: 'Take 1' } }] } })
        expect(ok.json.applied).toEqual(['recordings/r1'])
        const old = await api('PUT', 'records', { token, body: { items: [{ store: 'recordings', id: 'r1', t: 5, hash, meta: { title: 'Older' } }] } })
        expect(old.json.stale).toEqual([{ store: 'recordings', id: 'r1', meta: { title: 'Take 1' }, hash, size: bytes.length, t: 10 }])
        const del = await api('PUT', 'records', { token, body: { items: [{ store: 'recordings', id: 'r1', t: 20, deleted: true }] } })
        expect(del.json.applied).toEqual(['recordings/r1'])
        const ch = await api('GET', 'changes?since=0', { token })
        expect((ch.json.records as Json[]).find((r) => r.id === 'r1')).toMatchObject({ deleted: true, hash: null, t: 20 })
        const bad = await api('PUT', 'records', { token, body: { items: [{ store: 'nope', id: 'x', t: 1, hash, meta: {} }, { store: 'songs', id: '', t: 1, hash, meta: {} }] } })
        expect(bad.json.rejected).toEqual({ 'nope/x': 'invalid', 'songs/': 'invalid' })
      })

      it('record ids differing only in case stay separate', async () => {
        const items = ['Song-A', 'song-a'].map((id, i) => ({ store: 'songs', id, t: 30, hash, meta: { n: i } }))
        expect((await api('PUT', 'records', { token, body: { items } })).json.applied).toEqual(['songs/Song-A', 'songs/song-a'])
        const recs = (await api('GET', 'changes?since=0', { token })).json.records as Json[]
        expect(recs.filter((r) => r.store === 'songs' && /^song-a$/i.test(r.id as string)).map((r) => [r.id, r.meta])).toEqual(
          expect.arrayContaining([
            ['Song-A', { n: 0 }],
            ['song-a', { n: 1 }],
          ]),
        )
      })

      it("one user can't read another's files", async () => {
        const other = (await signup('Second Player')).json.token as string
        expect((await api('GET', 'content/' + hash, { token: other })).status).toBe(404)
        expect((await api('GET', 'changes?since=0', { token: other })).json).toMatchObject({ rev: 0, kv: {}, records: [] })
      })
    })

    describe('login lockout', () => {
      it('after repeated wrong passwords even the right one waits', async () => {
        let status = 0
        for (let i = 0; i < 9 && status !== 429; i++) status = (await login('Andy Rocks', 'wrong-pw')).status
        expect(status).toBe(429)
        expect((await login('Andy Rocks')).json).toEqual({ error: 'wait' })
      })
    })

    describe('restart', () => {
      it('after a restart every account, sign-in, key/value, record and file is still there', async () => {
        const before = await api('GET', 'changes?since=0', { token })
        const me = await api('GET', 'me', { token })
        await app.restart()
        expect(await api('GET', 'changes?since=0', { token })).toEqual(before)
        expect(await api('GET', 'me', { token })).toEqual(me)
        const bytes = new TextEncoder().encode('a recording')
        const res = await fetch(app.base + 'content/' + sha(bytes), { headers: { authorization: `Bearer ${token}` } })
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
        // the lockout was in memory only; the password still works
        expect((await login('Andy Rocks')).status).toBe(200)
        expect((await signup('second player')).json).toEqual({ error: 'taken' })
        // and the rev carries on from where it was
        const next = await api('PUT', 'kv', { token, body: { items: { after: { v: '1', t: 1 } } } })
        expect(next.json.rev).toBe((before.json.rev as number) + 1)
      })
    })
  })
}
