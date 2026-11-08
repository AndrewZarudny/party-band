// The accounts API on MariaDB. Runs only when FRETWISE_TEST_DB_URL points at a test database (its name must end
// in _test: every run empties it), e.g. mysql://fretwise:<password>@127.0.0.1:3316/fretwise_test.
// scripts/db-setup.sh creates fretwise_test.
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createConnection, type RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accountsSuite, sha, startApp, type App, type Json } from './accounts-suite'

const url = process.env.FRETWISE_TEST_DB_URL ?? ''
const isTestDb = url !== '' && /_test$/.test(new URL(url).pathname)

/** Runs SQL on the test database with a connection of its own (not the app's). */
async function sql(query: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const c = await createConnection({ uri: url })
  try {
    const [rows] = await c.query<RowDataPacket[]>(query, params)
    return rows
  } finally {
    await c.end()
  }
}

/** Starts from an empty database: the app makes its tables again. */
async function reset() {
  const c = await createConnection({ uri: url })
  try {
    await c.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const t of ['tokens', 'kv', 'records', 'users', 'schema_migrations', 'kv_off', 'records_off', 'tokens_off']) await c.query(`DROP TABLE IF EXISTS ${t}`)
  } finally {
    await c.end()
  }
}

const count = async (table: string) => Number((await sql(`SELECT COUNT(*) AS n FROM ${table}`))[0].n)

describe.skipIf(!isTestDb)('accounts on MariaDB', () => {
  accountsSuite('the shared cases', {
    db: url,
    reset,
    stored: async () => JSON.stringify([await sql('SELECT * FROM users'), await sql('SELECT * FROM tokens')]),
  })

  describe('the one-time import from the JSON files', () => {
    let dir = ''
    let token = ''
    let before: Json = {}
    const bytes = new TextEncoder().encode('an old recording')

    beforeAll(async () => {
      await reset()
      // Accounts made the old way, on the files.
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fretwise-import-'))
      const old = await startApp({ dir })
      token = (await old.api('POST', 'signup', { body: { name: 'Old Timer', password: 'secret-pw' } })).json.token as string
      await old.api('PUT', 'kv', { token, body: { items: { 'lessons-prefs': { v: '{"x":1}', t: 5 }, Case: { v: 'A', t: 5 }, case: { v: 'a', t: 5 }, gone: { v: 'x', t: 5 } } } })
      await old.api('PUT', 'kv', { token, body: { items: { gone: { v: null, t: 6 } } } })
      await old.api('PUT', 'content/' + sha(bytes), { token, raw: bytes })
      await old.api('PUT', 'records', { token, body: { items: [{ store: 'recordings', id: 'take-1', t: 7, hash: sha(bytes), meta: { title: 'Take 1' } }] } })
      before = (await old.api('GET', 'changes?since=0', { token })).json
      await old.close()
      // And one from the Lessons-only days: a blob in accounts.json, no index file.
      const file = path.join(dir, 'accounts.json')
      const store = JSON.parse(fs.readFileSync(file, 'utf8')) as { users: Record<string, Json> }
      const first = Object.values(store.users)[0]
      const id = '00000000-0000-4000-8000-000000000001'
      store.users[id] = { ...first, id, name: 'Blob User', nameKey: 'blob user', data: { progress: { lesson: 3 } }, updated: 1234 }
      fs.writeFileSync(file, JSON.stringify(store))
    })

    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('copies users, sign-ins, key/values and records in once, and leaves the files as they were', async () => {
      const filesBefore = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8')
      const app = await startApp({ dir, db: url })
      try {
        expect(await count('users')).toBe(2)
        expect(await count('tokens')).toBe(1)
        // the same sign-in still works, and the data is the same
        expect((await app.api('GET', 'me', { token })).json).toMatchObject({ name: 'Old Timer', rev: before.rev })
        expect((await app.api('GET', 'changes?since=0', { token })).json).toEqual(before)
        const res = await fetch(app.base + 'content/' + sha(bytes), { headers: { authorization: `Bearer ${token}` } })
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
        // the old Lessons blob became its key
        const blob = await app.api('POST', 'login', { body: { name: 'blob user', password: 'secret-pw' } })
        expect(blob.json).toMatchObject({ name: 'Blob User', rev: 1 })
        const kv = (await app.api('GET', 'changes?since=0', { token: blob.json.token as string })).json.kv as Json
        expect(kv['lessons-progress']).toEqual({ v: '{"lesson":3}', t: 1234, rev: 1 })
        expect(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8')).toBe(filesBefore)
        // a later start doesn't import again
        await app.api('POST', 'signup', { body: { name: 'New One', password: 'secret-pw' } })
        await app.restart()
        expect(await count('users')).toBe(3)
        expect((await app.api('GET', 'changes?since=0', { token })).json).toEqual(before)
      } finally {
        await app.close()
      }
    })
  })

  describe('when a database write fails', () => {
    let app: App
    let token = ''
    let rev = 0
    const bytes = new TextEncoder().encode('kept file')

    beforeAll(async () => {
      await reset()
      app = await startApp({ db: url })
      token = (await app.api('POST', 'signup', { body: { name: 'Unlucky', password: 'secret-pw' } })).json.token as string
      rev = (await app.api('PUT', 'kv', { token, body: { items: { a: { v: '1', t: 1 } } } })).json.rev as number
      await app.api('PUT', 'content/' + sha(bytes), { token, raw: bytes })
    })

    afterAll(async () => {
      await sql('RENAME TABLE kv_off TO kv').catch(() => {})
      await sql('RENAME TABLE records_off TO records').catch(() => {})
      await sql('RENAME TABLE tokens_off TO tokens').catch(() => {})
      await app.close()
    })

    it('answers 503, and memory goes back to what the database has', async () => {
      await sql('RENAME TABLE kv TO kv_off')
      expect(await app.api('PUT', 'kv', { token, body: { items: { b: { v: '2', t: 2 } } } })).toEqual({ status: 503, json: { error: 'db' } })
      // the user can't be read back while the table is missing
      expect((await app.api('GET', 'changes?since=0', { token })).status).toBe(503)
      await sql('RENAME TABLE kv_off TO kv')
      const ch = await app.api('GET', 'changes?since=0', { token })
      expect(ch.json.rev).toBe(rev)
      expect(Object.keys(ch.json.kv as Json)).toEqual(['a'])
      expect(Number((await sql('SELECT rev FROM users'))[0].rev)).toBe(rev)
      // the client's retry goes through
      const again = await app.api('PUT', 'kv', { token, body: { items: { b: { v: '2', t: 2 } } } })
      expect(again.json).toMatchObject({ applied: ['b'], rev: rev + 1 })
    })

    it('records too', async () => {
      const r = (await app.api('GET', 'me', { token })).json.rev as number
      await sql('RENAME TABLE records TO records_off')
      const item = { store: 'recordings', id: 'take', t: 3, hash: sha(bytes), meta: { title: 'Take' } }
      expect((await app.api('PUT', 'records', { token, body: { items: [item] } })).status).toBe(503)
      await sql('RENAME TABLE records_off TO records')
      const ch = await app.api('GET', 'changes?since=0', { token })
      expect(ch.json).toMatchObject({ rev: r, records: [] })
      // the grace time keeps the uploaded file for the retry (a file the database still lists: see the next case)
      expect((await app.api('PUT', 'records', { token, body: { items: [item] } })).json.applied).toEqual(['recordings/take'])
    })

    it('sign-ins answer 503 and are not kept when the database refuses them', async () => {
      const tokens = (await sql('SELECT hash FROM tokens')).length
      await sql('RENAME TABLE tokens TO tokens_off')
      expect((await app.api('POST', 'login', { body: { name: 'Unlucky', password: 'secret-pw' } })).status).toBe(503)
      expect((await app.api('POST', 'signup', { body: { name: 'Newcomer', password: 'secret-pw' } })).status).toBe(503)
      await sql('RENAME TABLE tokens_off TO tokens')
      expect((await sql('SELECT hash FROM tokens')).length).toBe(tokens)
      // the sign-up got its account but no sign-in: it can log in now
      expect((await app.api('POST', 'login', { body: { name: 'Newcomer', password: 'secret-pw' } })).status).toBe(200)
      // and everything matches the database after a restart
      const before = (await app.api('GET', 'changes?since=0', { token })).json
      await app.restart()
      expect((await app.api('GET', 'changes?since=0', { token })).json).toEqual(before)
    })

    it('a sign-up the database took but whose answer got lost can still log in', async () => {
      // As if the insert landed and the connection dropped before its OK: the row is there, memory never got it.
      const salt = crypto.randomBytes(16).toString('hex')
      const hash = crypto.scryptSync('secret-pw', salt, 64).toString('hex')
      await sql('INSERT INTO users (id, name, name_key, salt, hash, created, rev) VALUES (?, ?, ?, ?, ?, ?, 0)', [crypto.randomUUID(), 'Ghost', 'ghost', salt, hash, Date.now()])
      expect((await app.api('POST', 'signup', { body: { name: 'Ghost', password: 'secret-pw' } })).json).toEqual({ error: 'taken' })
      const in2 = await app.api('POST', 'login', { body: { name: 'Ghost', password: 'secret-pw' } })
      expect(in2.status).toBe(200)
      expect((await app.api('GET', 'changes?since=0', { token: in2.json.token as string })).json).toMatchObject({ rev: 0, kv: {}, records: [] })
    })

    it('a sign-out while the database is down ends the token at once, and in the database once it is back', async () => {
      const other = (await app.api('POST', 'login', { body: { name: 'Unlucky', password: 'secret-pw' } })).json.token as string
      await sql('RENAME TABLE tokens TO tokens_off')
      expect((await app.api('POST', 'logout', { token: other, body: {} })).status).toBe(503)
      expect((await app.api('GET', 'me', { token: other })).status).toBe(401)
      await sql('RENAME TABLE tokens_off TO tokens')
      expect((await sql('SELECT hash FROM tokens WHERE hash = ?', [sha(other)])).length).toBe(1)
      // the next sign-in catches up
      expect((await app.api('POST', 'login', { body: { name: 'Unlucky', password: 'secret-pw' } })).status).toBe(200)
      expect((await sql('SELECT hash FROM tokens WHERE hash = ?', [sha(other)])).length).toBe(0)
      expect((await app.api('GET', 'me', { token: other })).status).toBe(401)
    })
  })

  describe('a file the database still lists', () => {
    let app: App
    let token = ''
    const bytes = new TextEncoder().encode('still listed')

    beforeAll(async () => {
      await reset()
      // No grace time: any sweep on the wrong data would remove the file right away.
      process.env.ACCOUNTS_GC_GRACE_MS = '0'
      app = await startApp({ db: url })
      token = (await app.api('POST', 'signup', { body: { name: 'Keeper', password: 'secret-pw' } })).json.token as string
      await app.api('PUT', 'content/' + sha(bytes), { token, raw: bytes })
      await app.api('PUT', 'records', { token, body: { items: [{ store: 'recordings', id: 'keep', t: 1, hash: sha(bytes), meta: {} }] } })
    })

    afterAll(async () => {
      delete process.env.ACCOUNTS_GC_GRACE_MS
      await sql('RENAME TABLE records_off TO records').catch(() => {})
      await app.close()
    })

    it("isn't removed when deleting its record fails", async () => {
      await sql('RENAME TABLE records TO records_off')
      expect((await app.api('PUT', 'records', { token, body: { items: [{ store: 'recordings', id: 'keep', t: 2, deleted: true }] } })).status).toBe(503)
      await sql('RENAME TABLE records_off TO records')
      // read back from the database: the record is still there, and so is its file
      const ch = await app.api('GET', 'changes?since=0', { token })
      expect(ch.json.records).toMatchObject([{ id: 'keep', hash: sha(bytes) }])
      expect((await app.api('GET', 'content/' + sha(bytes), { token })).status).toBe(200)
    })
  })

  describe('switching between the JSON files and MariaDB', () => {
    let dir = ''
    const a = new TextEncoder().encode('saved on MariaDB')
    const b = new TextEncoder().encode('saved on the files')

    beforeAll(async () => {
      await reset()
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fretwise-switch-'))
      // No grace time: a sweep on one backend's view alone would remove the other's files right away.
      process.env.ACCOUNTS_GC_GRACE_MS = '0'
    })

    afterAll(() => {
      delete process.env.ACCOUNTS_GC_GRACE_MS
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('never removes a file the other backend still uses', async () => {
      const files = await startApp({ dir })
      const token = (await files.api('POST', 'signup', { body: { name: 'Switcher', password: 'secret-pw' } })).json.token as string
      await files.close()

      // On MariaDB (imported once): a recording only the database lists.
      const onDb = await startApp({ dir, db: url })
      await onDb.api('PUT', 'content/' + sha(a), { token, raw: a })
      expect((await onDb.api('PUT', 'records', { token, body: { items: [{ store: 'recordings', id: 'a', t: 1, hash: sha(a), meta: {} }] } })).json.applied).toEqual(['recordings/a'])
      await onDb.close()

      // Back on the files: index.json doesn't know that recording, and a new one goes only there.
      const back = await startApp({ dir })
      await back.api('GET', 'changes?since=0', { token })
      expect((await back.api('GET', 'content/' + sha(a), { token })).status).toBe(200)
      await back.api('PUT', 'content/' + sha(b), { token, raw: b })
      expect((await back.api('PUT', 'records', { token, body: { items: [{ store: 'recordings', id: 'b', t: 2, hash: sha(b), meta: {} }] } })).json.applied).toEqual(['recordings/b'])
      await back.close()

      // MariaDB again: both files are still there.
      const again = await startApp({ dir, db: url })
      try {
        expect((await again.api('GET', 'content/' + sha(a), { token })).status).toBe(200)
        expect((await again.api('GET', 'content/' + sha(b), { token })).status).toBe(200)
      } finally {
        await again.close()
      }
    })
  })

  describe('when the database is down at start', () => {
    it('answers 503 for accounts only, and works once the database is back', async () => {
      await reset()
      // A relay to the database that isn't listening yet.
      const real = new URL(url)
      const free = net.createServer()
      await new Promise<void>((resolve) => free.listen(0, '127.0.0.1', resolve))
      const port = (free.address() as net.AddressInfo).port
      await new Promise((resolve) => free.close(resolve))
      const socks = new Set<net.Socket>()
      const relay = net.createServer((c) => {
        const up = net.connect(Number(real.port || 3306), real.hostname)
        socks.add(c)
        socks.add(up)
        const end = () => {
          c.destroy()
          up.destroy()
        }
        c.on('error', end).on('close', end)
        up.on('error', end).on('close', end)
        c.pipe(up).pipe(c)
      })
      const down = new URL(url)
      down.host = `127.0.0.1:${port}`

      const app = await startApp({ db: down.toString() })
      try {
        expect(await app.api('POST', 'signup', { body: { name: 'Early Bird', password: 'secret-pw' } })).toEqual({ status: 503, json: { error: 'db' } })
        expect((await app.api('GET', 'me', { token: '0'.repeat(64) })).status).toBe(503)
        // other routes don't wait for it (the harness answers 404 for what accounts doesn't handle)
        expect((await app.raw({ method: 'GET', path: '/api/ai-status' })).status).toBe(404)
        await new Promise<void>((resolve) => relay.listen(port, '127.0.0.1', resolve))
        expect((await app.api('POST', 'signup', { body: { name: 'Early Bird', password: 'secret-pw' } })).status).toBe(200)
        expect(await count('users')).toBe(1)
      } finally {
        await app.close()
        for (const s of socks) s.destroy()
        await new Promise((resolve) => relay.close(resolve))
      }
    })
  })
})
