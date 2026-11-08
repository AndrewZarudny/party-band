// Local Fretwise accounts: a name and password, and everything the player saves in the app (songs, tones,
// recordings, lessons, settings) follows the account to any browser on this computer and on the Wi-Fi.
// With FRETWISE_DB_URL set, users, hashed tokens and each user's index (key/values and record info) live in
// MariaDB (server/db.ts). Without it they live in JSON files: users and tokens in .cache/accounts.json
// (git-ignored), each user's index in .cache/accounts/<id>/index.json. Either way file bytes stay on disk in
// .cache/accounts/<id>/content/<sha256> (stored once). Everything is kept in memory and written through.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DbError, openDb, type AccountsDb, type DbKv, type DbRecord, type DbToken, type DbUser, type DbUserData } from './db'

// ACCOUNTS_DIR: tests point this at a temp folder.
const ROOT = path.resolve(process.env.ACCOUNTS_DIR || '.cache')
const FILE = path.join(ROOT, 'accounts.json')
const DATA_DIR = path.join(ROOT, 'accounts')
const TOKEN_DAYS = 180
const FAIL_WINDOW_MS = 10 * 60 * 1000
const FAIL_LIMIT = 8
const MAX_USERS = 50 // signup is open to the Wi-Fi
const LOCAL_EXTRA_USERS = 5 // this computer can still make an account when the Wi-Fi filled the list
const SIGNUP_WINDOW_MS = 60 * 60 * 1000
const SIGNUP_LIMIT = 3 // new accounts per Wi-Fi address and hour (none for this computer)
// Under WSL2 NAT (scripts/windows/wifi-access.ps1) every phone arrives from the WSL gateway address,
// so that one address stands for the whole band and gets wider limits.
const SHARED_SIGNUP_LIMIT = 15
const SHARED_FAIL_LIMIT = 40
const MB = 1024 * 1024
const MAX_CONTENT = 100 * MB // one file
const MAX_USER_CONTENT = 1024 * MB // all files of one user
const MAX_ALL_CONTENT = 10 * 1024 * MB // all files of all users
const MIN_FREE_DISK = 2 * 1024 * MB // uploads stop before the disk gets this full
const MAX_UPLOADS_USER = 3 // at the same time
const MAX_UPLOADS_ALL = 8
// Everything in a user's index (keys, values, record ids and details, deleted ones too): it is kept in
// memory and rewritten on each change.
const MAX_INDEX = 24 * MB
const MAX_INDEX_ENTRIES = 100000
const MAX_KV_VALUE = 4 * MB
const MAX_KV_TOTAL = 20 * MB
const MAX_META = 16 * 1024
const MAX_KV_BODY = 25 * MB
const MAX_RECORDS_BODY = 2 * MB
const MAX_KV_ITEMS = 2000
const MAX_RECORD_ITEMS = 500
const CLOCK_SKEW_MS = 60000
const TMP_GRACE_MS = 60 * 60 * 1000 // a half-uploaded file nobody wrote to for an hour
// Unreferenced content is kept this long, for a client that uploaded it and hasn't sent the record yet.
const GC_GRACE_MS = process.env.ACCOUNTS_GC_GRACE_MS ? Math.max(0, Number(process.env.ACCOUNTS_GC_GRACE_MS) || 0) : 10 * 60 * 1000

const STORES = ['songs', 'captures', 'recordings'] as const
type StoreName = (typeof STORES)[number]
// Per-browser plumbing and third-party secrets never go to the server.
const FORBIDDEN = new Set(['fretwise-account', 'fretwise-sync', 'lessons-account', 't3k-tokens'])
const HASH_RE = /^[0-9a-f]{64}$/
const ID_RE = /^[0-9a-f-]{36}$/
// eslint-disable-next-line no-control-regex
const KEY_RE = /^[^\u0000-\u001f\u007f]{1,300}$/
// Half of a surrogate pair: it can't be stored as UTF-8, so the database would keep a different string.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

interface User {
  id: string
  name: string
  nameKey: string // lower-cased, for lookups
  salt: string
  hash: string
  created: number
  updated?: number // old files only: last save of `data`
  data?: unknown // old files only: the Lessons blob, moved into the user's index at load
}
interface Store {
  v: 1
  users: Record<string, User>
  tokens: Record<string, { userId: string; created: number }> // sha256(token) → owner
}

interface KvItem {
  v: string | null // null = deleted
  t: number
  rev: number
}
interface RecItem {
  meta: Record<string, unknown> | null
  hash: string | null
  size: number
  t: number
  rev: number
  deleted?: true
}
interface UserIndex {
  v: 1
  rev: number // bumps on every accepted change
  kv: Record<string, KvItem>
  records: Record<StoreName, Record<string, RecItem>>
}
interface Loaded {
  id: string
  dir: string
  idx: UserIndex
  content: number // bytes of content/*
  kvSize: number // characters of all kv values
  idxSize: number // characters the index costs (see MAX_INDEX)
  entries: number // kv items and records, deleted ones too
  inflight: number // bytes of uploads still arriving
  uploads: number // uploads still arriving
  stale?: boolean // a database write failed: idx may differ from the database until it's read back
}

const kvCost = (k: string, v: string | null) => k.length + (v?.length ?? 0) + 40
const recCost = (id: string, meta: Record<string, unknown> | null) => id.length + (meta ? JSON.stringify(meta).length : 0) + 120

// Null-prototype maps, so ids and keys like "__proto__" stay plain entries.
const dict = <T>(o?: Record<string, T> | null): Record<string, T> => Object.assign(Object.create(null) as Record<string, T>, o ?? {})
const emptyIndex = (): UserIndex => ({ v: 1, rev: 0, kv: dict(), records: { songs: dict(), captures: dict(), recordings: dict() } })

function userDir(id: string) {
  if (!ID_RE.test(id)) throw new Error('Bad user id')
  return path.join(DATA_DIR, id)
}

function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, text, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

/** The accounts in the JSON files; empty when there are none yet. */
function load(): Store {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Store
    if (s && s.v === 1 && s.users && s.tokens) return s
  } catch {
    /* first run */
  }
  return { v: 1, users: {}, tokens: {} }
}

// Filled on first use (see accountsReady), from the JSON files or from the database.
const store: Store = { v: 1, users: {}, tokens: {} }
let db: AccountsDb | null = null // set when FRETWISE_DB_URL chose MariaDB
// Written on the first start with MariaDB. Both backends share the content folders, so once it's there the
// JSON files no longer list every file in use, and running on them only recounts content, never removes it.
const DB_USED = path.join(ROOT, 'accounts-db-used')
let keepContent = false
// Sign-outs the database hasn't taken yet: refused here at once, and dropped there on the next chance.
const revoked = new Set<string>()

/** JSON files only. Writes to a temp file first, so a crash mid-write never loses the accounts. */
function save() {
  if (!db) writeAtomic(FILE, JSON.stringify(store))
}

/** The old Lessons-only accounts kept one blob per user: as an index it's two keys. Null when there's none. */
function blobIndex(u: User): UserIndex | null {
  const data = u.data as { progress?: unknown; prefs?: unknown } | null | undefined
  if (!data || typeof data !== 'object') return null
  const idx = emptyIndex()
  const t = u.updated || Date.now()
  if (data.progress !== undefined) idx.kv['lessons-progress'] = { v: JSON.stringify(data.progress), t, rev: ++idx.rev }
  if (data.prefs !== undefined) idx.kv['lessons-prefs'] = { v: JSON.stringify(data.prefs), t, rev: ++idx.rev }
  return idx
}

// JSON files only: move the old blobs into the users' index files.
function migrate() {
  let changed = false
  for (const u of Object.values(store.users)) {
    if (!('data' in u) && !('updated' in u)) continue
    try {
      const file = path.join(userDir(u.id), 'index.json')
      const idx = blobIndex(u)
      if (idx && !fs.existsSync(file)) writeAtomic(file, JSON.stringify(idx))
      delete u.data
      delete u.updated
      changed = true
    } catch (err) {
      console.warn('[accounts] could not move saved lessons of', u.name, err)
    }
  }
  if (changed) save()
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const scrypt = (pw: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => crypto.scrypt(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key))))

const fails = new Map<string, number[]>() // name or address → recent failed login times

function tooMany(key: string, limit = FAIL_LIMIT) {
  const now = Date.now()
  const list = (fails.get(key) ?? []).filter((t) => now - t < FAIL_WINDOW_MS)
  fails.set(key, list)
  return list.length >= limit
}
const noteFail = (key: string) => fails.set(key, [...(fails.get(key) ?? []), Date.now()])
const signups = new Map<string, number[]>() // Wi-Fi address → recent signup times

/** The WSL default gateway (e.g. 172.26.128.1) when running in WSL, else ''. Never X-Forwarded-For: anyone can fake it. */
function wslGateway(): string {
  try {
    if (!/microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'))) return ''
    for (const line of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const f = line.trim().split(/\s+/)
      if (f[1] !== '00000000' || !/^[0-9A-Fa-f]{8}$/.test(f[2] ?? '')) continue
      // Little-endian hex: 01801AAC → 172.26.128.1
      return [6, 4, 2, 0].map((i) => parseInt(f[2].slice(i, i + 2), 16)).join('.')
    }
  } catch {
    /* not Linux */
  }
  return ''
}
const SHARED_ADDR = wslGateway() // WSL gets a new gateway only after a restart, which restarts this server too

async function issueToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex')
  const created = Date.now()
  // Drop expired tokens while we're here.
  const cutoff = created - TOKEN_DAYS * 86400000
  // The database first: when it fails, nothing changes here either.
  if (db) await db.addToken({ hash: sha(token), userId, created }, cutoff)
  if (revoked.size) await dropRevoked().catch(() => {}) // the database is back: catch up on sign-outs
  store.tokens[sha(token)] = { userId, created }
  for (const [k, t] of Object.entries(store.tokens)) if (t.created < cutoff) delete store.tokens[k]
  save()
  return token
}

/** Drops the sign-outs the database missed; throws a DbError while it can't. */
async function dropRevoked() {
  for (const h of [...revoked]) {
    await db?.dropToken(h)
    revoked.delete(h)
  }
}

/** A name the database has but memory doesn't (a signup whose answer got lost): takes it in, so it can log in. */
async function adoptUser(key: string) {
  if (!db || Object.values(store.users).some((x) => x.nameKey === key)) return
  const u = await db.findUser(key)
  if (u && !store.users[u.id]) store.users[u.id] = { id: u.id, name: u.name, nameKey: u.nameKey, salt: u.salt, hash: u.hash, created: u.created }
}

function userFor(req: IncomingMessage): User | null {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '')
  if (!m) return null
  const t = store.tokens[sha(m[1])]
  if (!t || t.created < Date.now() - TOKEN_DAYS * 86400000) return null
  return store.users[t.userId] ?? null
}

// ---- per-user data ----

const loaded = new Map<string, Loaded>()
const locks = new Map<string, Promise<unknown>>()

/** Runs fn after every earlier change of this user has finished, so read-modify-writes never interleave. */
function lock<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
  const next = (locks.get(id) ?? Promise.resolve()).then(fn)
  locks.set(id, next.catch(() => {}))
  return next
}

function liveHashes(idx: UserIndex) {
  const set = new Set<string>()
  for (const s of STORES) for (const r of Object.values(idx.records[s])) if (r.hash && !r.deleted) set.add(r.hash)
  return set
}

/** Recounts the user's content bytes and removes files no live record uses (after the grace time). */
function sweep(l: Loaded) {
  if (l.stale) return // its records may be missing a file's last user
  const dir = path.join(l.dir, 'content')
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    l.content = 0
    return
  }
  const live = liveHashes(l.idx)
  // Records saved while the server ran on the JSON files (before the import, or since) still use their files.
  if (db) for (const h of liveHashes(readIndex(l.id) ?? emptyIndex())) live.add(h)
  const now = Date.now()
  let total = 0
  for (const name of names) {
    const file = path.join(dir, name)
    let st: fs.Stats
    try {
      st = fs.statSync(file)
    } catch {
      continue
    }
    const old = now - st.mtimeMs
    try {
      if (HASH_RE.test(name)) {
        if (!live.has(name) && old > GC_GRACE_MS && !keepContent) fs.unlinkSync(file)
        else total += st.size
      } else if (name.startsWith('.tmp-') && old > TMP_GRACE_MS) fs.unlinkSync(file)
    } catch {
      if (HASH_RE.test(name)) total += st.size
    }
  }
  l.content = total
}

/** A user's index.json; null when nothing was saved yet. */
function readIndex(id: string): UserIndex | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(userDir(id), 'index.json'), 'utf8')) as Partial<UserIndex>
    if (raw && raw.v === 1) {
      return {
        v: 1,
        rev: typeof raw.rev === 'number' ? raw.rev : 0,
        kv: dict(raw.kv),
        records: { songs: dict(raw.records?.songs), captures: dict(raw.records?.captures), recordings: dict(raw.records?.recordings) },
      }
    }
  } catch {
    /* nothing saved yet */
  }
  return null
}

/** Counts what an index costs against the limits. */
function measure(idx: UserIndex) {
  let kvSize = 0
  let idxSize = 0
  let entries = 0
  for (const [k, it] of Object.entries(idx.kv)) {
    kvSize += it.v?.length ?? 0
    idxSize += kvCost(k, it.v)
    entries++
  }
  for (const s of STORES)
    for (const [rid, r] of Object.entries(idx.records[s])) {
      idxSize += recCost(rid, r.meta)
      entries++
    }
  return { kvSize, idxSize, entries }
}

function makeLoaded(id: string, idx: UserIndex): Loaded {
  return { id, dir: userDir(id), idx, content: 0, ...measure(idx), inflight: 0, uploads: 0 }
}

function loadUser(id: string): Loaded {
  const hit = loaded.get(id)
  if (hit) return hit
  if (db) {
    // Every account was read at start; one that wasn't is read from the database on first use (withUser).
    const l = makeLoaded(id, emptyIndex())
    l.stale = true
    loaded.set(id, l)
    return l
  }
  const l = makeLoaded(id, readIndex(id) ?? emptyIndex())
  loaded.set(id, l)
  sweep(l)
  return l
}

// ---- the database's rows ↔ a user's index ----

const kvRow = (k: string, it: KvItem): DbKv => ({ k, v: it.v, t: it.t, rev: it.rev })
const recordRow = (s: StoreName, id: string, r: RecItem): DbRecord => ({
  store: s,
  id,
  meta: r.meta ? JSON.stringify(r.meta) : null,
  hash: r.hash,
  size: r.size,
  t: r.t,
  rev: r.rev,
  deleted: !!r.deleted,
})

function toRows(idx: UserIndex): DbUserData {
  const records: DbRecord[] = []
  for (const s of STORES) for (const [id, r] of Object.entries(idx.records[s])) records.push(recordRow(s, id, r))
  return { rev: idx.rev, kv: Object.entries(idx.kv).map(([k, it]) => kvRow(k, it)), records }
}

function fromRows(d: DbUserData): UserIndex {
  const idx = emptyIndex()
  idx.rev = d.rev
  for (const r of d.kv) idx.kv[r.k] = { v: r.v, t: r.t, rev: r.rev }
  for (const r of d.records) {
    const s = STORES.find((x) => x === r.store)
    if (!s) continue
    let meta: Record<string, unknown> | null = null
    try {
      meta = r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null
    } catch {
      /* unreadable details: keep the record without them */
    }
    const item: RecItem = { meta, hash: r.hash, size: r.size, t: r.t, rev: r.rev }
    if (r.deleted) item.deleted = true
    idx.records[s][r.id] = item
  }
  return idx
}

/** Writes what changed: the whole index.json, or the changed rows (and the user's rev) in one transaction. */
async function saveIndex(l: Loaded, kv: string[], records: [StoreName, string][]) {
  if (db) {
    try {
      await db.saveChanges(
        l.id,
        l.idx.rev,
        kv.map((k) => kvRow(k, l.idx.kv[k])),
        records.map(([s, id]) => recordRow(s, id, l.idx.records[s][id])),
      )
    } catch (err) {
      // Memory already has the change and the database may or may not (a commit can fail after it landed):
      // read the user back from the database before anyone uses this data again.
      l.stale = true
      throw err
    }
    return
  }
  await fs.promises.mkdir(l.dir, { recursive: true, mode: 0o700 })
  const file = path.join(l.dir, 'index.json')
  await fs.promises.writeFile(file + '.tmp', JSON.stringify(l.idx), { mode: 0o600 })
  await fs.promises.rename(file + '.tmp', file)
}

/** Replaces a stale user's data with what the database has; throws a DbError while it can't be read. */
async function refresh(l: Loaded) {
  const d = db ? await db.loadUser(l.id) : null
  l.idx = d ? fromRows(d) : emptyIndex()
  Object.assign(l, measure(l.idx))
  l.stale = false
  sweep(l)
}

/** Runs fn in the user's lock, after reading the user back from the database if a failed write left them stale. */
function withUser<T>(l: Loaded, fn: () => Promise<T> | T): Promise<T> {
  return lock(l.id, async () => {
    if (l.stale) await refresh(l)
    return fn()
  })
}

// ---- start: the JSON files, or MariaDB ----

const errorCode = (err: unknown) => {
  const e = err as { code?: unknown; name?: unknown } | null
  return typeof e?.code === 'string' ? e.code : typeof e?.name === 'string' ? e.name : 'unknown'
}

let started = false
let starting: Promise<boolean> | null = null
let dbDown = false // logged once per outage

/**
 * Reads the accounts on first use, from MariaDB when FRETWISE_DB_URL is set, else from the JSON files. Read
 * late, not at import: vite.config.ts imports this file before it loads .env.local. False while the database
 * can't be reached; the next call tries again.
 */
export function accountsReady(): Promise<boolean> {
  if (started) return Promise.resolve(true)
  starting ??= start().finally(() => (starting = null))
  return starting
}

/** Closes the database connections (dev server shutdown, tests). */
export async function closeAccounts() {
  await db?.close()
}

let dbUrl: string | null = null // read once: retries after an outage use the same database

async function start(): Promise<boolean> {
  const url = (dbUrl ??= process.env.FRETWISE_DB_URL ?? '')
  if (!url) {
    Object.assign(store, load())
    migrate()
    keepContent = fs.existsSync(DB_USED)
    started = true
    return true
  }
  try {
    if (!fs.existsSync(DB_USED)) writeAtomic(DB_USED, 'Fretwise ran on MariaDB with this folder: the JSON backend keeps every content file.\n')
    db ??= openDb(url)
    await db.connect()
    await importFiles(db)
    const all = await db.loadAll()
    store.users = dict()
    store.tokens = dict()
    for (const u of all.users) store.users[u.id] = { id: u.id, name: u.name, nameKey: u.nameKey, salt: u.salt, hash: u.hash, created: u.created }
    for (const t of all.tokens) if (!revoked.has(t.hash)) store.tokens[t.hash] = { userId: t.userId, created: t.created }
    loaded.clear()
    for (const [id, d] of all.data) {
      try {
        const l = makeLoaded(id, fromRows(d))
        loaded.set(id, l)
        sweep(l)
      } catch {
        /* bad id: no data */
      }
    }
    started = true
    dbDown = false
    console.log(`[accounts] using MariaDB: ${all.users.length} accounts`)
    return true
  } catch (err) {
    // Only the error's code: never the URL, which holds the password.
    if (!dbDown) console.warn(`[accounts] can't use the database (${errorCode(err)}); accounts answer 503 until it's back`)
    dbDown = true
    return false
  }
}

/** First start on an empty database: copies the accounts in from the JSON files, and leaves the files in place. */
async function importFiles(db: AccountsDb) {
  if (await db.hasUsers()) return
  const old = load()
  const users: DbUser[] = []
  const tokens: DbToken[] = []
  const data = new Map<string, DbUserData>()
  const names = new Set<string>()
  for (const u of Object.values(old.users)) {
    const nameKey = u.nameKey ?? u.name.toLowerCase()
    if (!ID_RE.test(u.id) || names.has(nameKey)) {
      console.warn('[accounts] not importing a broken or repeated account:', u.name)
      continue
    }
    names.add(nameKey)
    const idx = readIndex(u.id) ?? blobIndex(u) ?? emptyIndex()
    users.push({ id: u.id, name: u.name, nameKey, salt: u.salt, hash: u.hash, created: u.created, rev: idx.rev })
    data.set(u.id, toRows(idx))
  }
  if (!users.length) return
  for (const [hash, t] of Object.entries(old.tokens)) if (HASH_RE.test(hash) && data.has(t.userId)) tokens.push({ hash, userId: t.userId, created: t.created })
  if (!(await db.importAll(users, tokens, data))) return
  let kv = 0
  let records = 0
  for (const d of data.values()) {
    kv += d.kv.length
    records += d.records.length
  }
  console.log(`[accounts] imported ${users.length} accounts, ${tokens.length} sign-ins, ${kv} saved items and ${records} records from ${FILE} into MariaDB (the files stay as they were)`)
}

const contentPath = (l: Loaded, hash: string) => path.join(l.dir, 'content', hash)
const usage = (l: Loaded) => ({ bytes: l.content, limit: MAX_USER_CONTENT })

/** Room left in the index for a change that grows it by `grow` characters and `more` entries. */
const indexFits = (l: Loaded, grow: number, more: number) =>
  (grow <= 0 || l.idxSize + grow <= MAX_INDEX) && (more <= 0 || l.entries + more <= MAX_INDEX_ENTRIES)

let uploadsAll = 0
let inflightAll = 0

/** Bytes of content all users have now (loads every user once). */
function allContent() {
  let n = 0
  for (const id of Object.keys(store.users)) {
    try {
      n += loadUser(id).content
    } catch {
      /* bad id: no data */
    }
  }
  return n
}

/** Free bytes on the disk that holds the accounts; Infinity when it can't be told. */
function freeDisk() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    const st = fs.statfsSync(DATA_DIR)
    return st.bavail * st.bsize
  } catch {
    return Infinity
  }
}

function statFile(file: string): fs.Stats | null {
  try {
    const st = fs.statSync(file)
    return st.isFile() ? st : null
  } catch {
    return null
  }
}

/** Marks content as just used, so the sweep doesn't remove it while its record is on the way. */
function touch(file: string) {
  const now = new Date()
  fs.utimes(file, now, now, () => {})
}

/** A client time in ms, capped a minute into the future; null when it isn't a usable time. */
function clampT(t: unknown): number | null {
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return null
  return Math.min(t, Date.now() + CLOCK_SKEW_MS)
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// ---- HTTP helpers ----

/** The body as bytes; null when it passes the limit (the rest is read and ignored). */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (c: Buffer) => {
      if (over) return
      size += c.length
      if (size > limit) {
        over = true
        chunks.length = 0
        resolve(null)
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    if (req.complete) return resolve()
    req.on('end', resolve)
    req.on('close', resolve)
    req.on('error', () => resolve())
    req.resume()
  })
}

function json(res: ServerResponse, status: number, body: unknown): true {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
  return true
}

/** Answers before the body is fully read, then closes the connection instead of reading the rest. */
function refuse(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): true {
  if (!req.complete) {
    res.setHeader('Connection', 'close')
    res.on('finish', () => req.destroy())
  }
  return json(res, status, body)
}

const badRequest = (res: ServerResponse, detail?: string) => json(res, 400, detail ? { error: 'bad-request', detail } : { error: 'bad-request' })

/** The parsed JSON body; null when an error answer was already sent. */
async function readJson(req: IncomingMessage, res: ServerResponse, limit: number): Promise<{ body: unknown } | null> {
  const buf = await readBody(req, limit)
  if (!buf) {
    refuse(req, res, 413, { error: 'too-large' })
    return null
  }
  try {
    return { body: JSON.parse(buf.toString('utf8')) as unknown }
  } catch {
    badRequest(res, 'json')
    return null
  }
}

const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')

// ---- routes ----

function changes(res: ServerResponse, l: Loaded, query: string) {
  const raw = new URLSearchParams(query).get('since')
  if (raw !== null && !/^\d+$/.test(raw)) return badRequest(res, 'since')
  const since = raw === null ? 0 : Number(raw)
  if (!Number.isSafeInteger(since)) return badRequest(res, 'since')
  const kv = dict<{ v: string | null; t: number; rev: number }>()
  for (const [k, it] of Object.entries(l.idx.kv)) if (it.rev > since) kv[k] = { v: it.v, t: it.t, rev: it.rev }
  const records: ReturnType<typeof publicRecord>[] = []
  for (const s of STORES) for (const [id, r] of Object.entries(l.idx.records[s])) if (r.rev > since) records.push(publicRecord(s, id, r))
  return json(res, 200, { rev: l.idx.rev, kv, records })
}

function publicRecord(store: StoreName, id: string, r: RecItem) {
  const out: { store: StoreName; id: string; meta: Record<string, unknown> | null; hash: string | null; size: number; t: number; deleted?: true } = {
    store,
    id,
    meta: r.meta,
    hash: r.hash,
    size: r.size,
    t: r.t,
  }
  if (r.deleted) out.deleted = true
  return out
}

type Refused = 'too-large' | 'quota' | 'disk'
type Received = { size: number; hash: string } | Refused | 'aborted' | 'error'

/**
 * Streams the body into tmp while hashing it, never holding it all in memory. `take` is told about every
 * chunk as it arrives and stops the upload as soon as there's no room for it.
 */
function receive(req: IncomingMessage, tmp: string, take: (n: number) => Refused | null): Promise<Received> {
  return new Promise((resolve) => {
    const ws = fs.createWriteStream(tmp, { mode: 0o600 })
    const h = crypto.createHash('sha256')
    let size = 0
    let done = false
    const fail = (why: Received) => {
      if (done) return
      done = true
      ws.destroy()
      req.resume()
      fs.rm(tmp, { force: true }, () => resolve(why))
    }
    req.on('data', (c: Buffer) => {
      if (done) return
      size += c.length
      if (size > MAX_CONTENT) return fail('too-large')
      const no = take(c.length)
      if (no) return fail(no)
      h.update(c)
      if (!ws.write(c)) {
        req.pause()
        ws.once('drain', () => req.resume())
      }
    })
    req.on('end', () => {
      if (done) return
      ws.end(() => {
        if (done) return
        done = true
        resolve({ size, hash: h.digest('hex') })
      })
    })
    req.on('close', () => {
      if (!req.complete) fail('aborted')
    })
    req.on('error', () => fail('aborted'))
    ws.on('error', () => fail('error'))
  })
}

async function putContent(req: IncomingMessage, res: ServerResponse, l: Loaded, hash: string) {
  const target = contentPath(l, hash)
  const have = statFile(target)
  if (have) {
    touch(target)
    await drain(req)
    return json(res, 200, { hash, size: have.size })
  }
  const declared = Number(req.headers['content-length']) || 0
  if (declared > MAX_CONTENT) return refuse(req, res, 413, { error: 'too-large' })
  if (l.uploads >= MAX_UPLOADS_USER || uploadsAll >= MAX_UPLOADS_ALL) return refuse(req, res, 429, { error: 'busy' })
  // Uploads still arriving count too, so parallel uploads can't pass the limits together.
  const over = (n: number): Refused | null => {
    if (l.content + l.inflight + n > MAX_USER_CONTENT) return 'quota'
    if (allContent() + inflightAll + n > MAX_ALL_CONTENT) return 'disk'
    return null
  }
  const pre = over(declared) ?? (freeDisk() - inflightAll - declared < MIN_FREE_DISK ? 'disk' : null)
  if (pre) return refuse(req, res, 413, { error: pre, usage: usage(l) })

  const dir = path.join(l.dir, 'content')
  const tmp = path.join(dir, '.tmp-' + crypto.randomBytes(8).toString('hex'))
  let counted = 0
  let got: Received
  // Counted before the first await, so uploads starting together see each other.
  l.uploads++
  uploadsAll++
  try {
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 })
    got = await receive(req, tmp, (n) => {
      const no = over(n)
      if (no) return no
      counted += n
      l.inflight += n
      inflightAll += n
      return null
    })
  } finally {
    l.uploads--
    uploadsAll--
    l.inflight -= counted
    inflightAll -= counted
  }
  if (got === 'aborted') {
    if (!res.writableEnded) res.destroy()
    return true
  }
  if (got === 'error') throw new Error('Could not save the file')
  if (got === 'too-large') return refuse(req, res, 413, { error: 'too-large' })
  if (got === 'quota' || got === 'disk') return refuse(req, res, 413, { error: got, usage: usage(l) })
  if (got.hash !== hash) {
    await fs.promises.rm(tmp, { force: true })
    return json(res, 400, { error: 'hash' })
  }
  return lock(l.id, async () => {
    if (statFile(target)) {
      await fs.promises.rm(tmp, { force: true })
      return json(res, 200, { hash, size: got.size })
    }
    const no = l.content + got.size > MAX_USER_CONTENT ? 'quota' : allContent() + got.size > MAX_ALL_CONTENT ? 'disk' : null
    if (no) {
      await fs.promises.rm(tmp, { force: true })
      return json(res, 413, { error: no, usage: usage(l) })
    }
    await fs.promises.rename(tmp, target)
    l.content += got.size
    return json(res, 200, { hash, size: got.size })
  })
}

function getContent(req: IncomingMessage, res: ServerResponse, l: Loaded, hash: string) {
  const file = contentPath(l, hash)
  const st = statFile(file)
  if (req.method === 'HEAD') {
    res.statusCode = st ? 200 : 404
    res.setHeader('Cache-Control', 'no-store')
    if (st) {
      touch(file)
      res.setHeader('Content-Length', String(st.size))
    }
    res.end()
    return true
  }
  if (!st) return json(res, 404, { error: 'not-found' })
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Length', String(st.size))
  res.setHeader('Cache-Control', 'no-store')
  const rs = fs.createReadStream(file)
  rs.on('error', () => res.destroy())
  rs.pipe(res)
  return true
}

async function putKv(req: IncomingMessage, res: ServerResponse, l: Loaded) {
  const got = await readJson(req, res, MAX_KV_BODY)
  if (!got) return true
  const items = isObject(got.body) ? got.body.items : undefined
  if (!isObject(items)) return badRequest(res, 'items')
  const entries = Object.entries(items)
  if (entries.length > MAX_KV_ITEMS) return badRequest(res, 'too many items')

  return withUser(l, async () => {
    const applied: string[] = []
    const revs = dict<number>()
    const stale = dict<{ v: string | null; t: number; rev: number }>()
    const rejected = dict<string>()
    for (const [k, item] of entries) {
      if (FORBIDDEN.has(k)) {
        rejected[k] = 'forbidden'
        continue
      }
      const v = isObject(item) ? item.v : undefined
      const t = isObject(item) ? clampT(item.t) : null
      if (!KEY_RE.test(k) || LONE_SURROGATE.test(k) || !(typeof v === 'string' || v === null) || (v !== null && LONE_SURROGATE.test(v)) || t === null) {
        rejected[k] = 'invalid'
        continue
      }
      if (v !== null && v.length > MAX_KV_VALUE) {
        rejected[k] = 'too-large'
        continue
      }
      // Lists come with the version they were edited from: a newer one here means the sender hasn't seen it.
      const base = isObject(item) && typeof item.base === 'number' ? item.base : null
      const cur = l.idx.kv[k]
      if (cur && (t < cur.t || (base !== null && cur.rev > base))) {
        stale[k] = { v: cur.v, t: cur.t, rev: cur.rev }
        continue
      }
      if (!cur && v === null) {
        applied.push(k) // removing a key the account never had: nothing to keep
        continue
      }
      const grow = (v?.length ?? 0) - (cur?.v?.length ?? 0)
      const cost = kvCost(k, v) - (cur ? kvCost(k, cur.v) : 0)
      if ((grow > 0 && l.kvSize + grow > MAX_KV_TOTAL) || !indexFits(l, cost, cur ? 0 : 1)) {
        rejected[k] = 'quota'
        continue
      }
      l.idx.kv[k] = { v, t, rev: ++l.idx.rev }
      l.kvSize += grow
      l.idxSize += cost
      if (!cur) l.entries++
      revs[k] = l.idx.rev
      applied.push(k)
    }
    const changed = Object.keys(revs)
    if (changed.length) await saveIndex(l, changed, [])
    return json(res, 200, { rev: l.idx.rev, applied, revs, stale, rejected })
  })
}

async function putRecords(req: IncomingMessage, res: ServerResponse, l: Loaded) {
  const got = await readJson(req, res, MAX_RECORDS_BODY)
  if (!got) return true
  const items = isObject(got.body) ? got.body.items : undefined
  if (!Array.isArray(items)) return badRequest(res, 'items')
  if (items.length > MAX_RECORD_ITEMS) return badRequest(res, 'too many items')

  return withUser(l, async () => {
    const applied: string[] = []
    const stale: ReturnType<typeof publicRecord>[] = []
    const missing = new Set<string>()
    const rejected = dict<string>()
    let dropped = false // a hash may have lost its last record
    const changed: [StoreName, string][] = []
    for (const item of items as unknown[]) {
      const o = isObject(item) ? item : {}
      const key = `${String(o.store)}/${String(o.id)}`
      const store = STORES.find((s) => s === o.store)
      const id = typeof o.id === 'string' && o.id.length >= 1 && o.id.length <= 200 && !LONE_SURROGATE.test(o.id) ? o.id : null
      const t = clampT(o.t)
      if (!store || id === null || t === null) {
        rejected[key] = 'invalid'
        continue
      }
      const recs = l.idx.records[store]
      const cur = recs[id]

      if (o.deleted === true) {
        if (cur && t < cur.t) {
          stale.push(publicRecord(store, id, cur))
          continue
        }
        if (!cur || cur.deleted) {
          applied.push(key) // never here, or already gone: nothing to record
          continue
        }
        if (cur.hash) dropped = true
        l.idxSize += recCost(id, null) - recCost(id, cur.meta)
        recs[id] = { meta: null, hash: null, size: 0, t, rev: ++l.idx.rev, deleted: true }
        applied.push(key)
        changed.push([store, id])
        continue
      }

      const hash = typeof o.hash === 'string' && HASH_RE.test(o.hash) ? o.hash : null
      if (!isObject(o.meta) || hash === null) {
        rejected[key] = 'invalid'
        continue
      }
      if (JSON.stringify(o.meta).length > MAX_META) {
        rejected[key] = 'too-large'
        continue
      }
      if (cur && t < cur.t) {
        stale.push(publicRecord(store, id, cur))
        continue
      }
      const st = statFile(contentPath(l, hash))
      if (!st) {
        missing.add(hash)
        continue
      }
      const cost = recCost(id, o.meta) - (cur ? recCost(id, cur.meta) : 0)
      if (!indexFits(l, cost, cur ? 0 : 1)) {
        rejected[key] = 'quota'
        continue
      }
      if (cur?.hash && cur.hash !== hash) dropped = true
      recs[id] = { meta: o.meta, hash, size: st.size, t, rev: ++l.idx.rev }
      l.idxSize += cost
      if (!cur) l.entries++
      applied.push(key)
      changed.push([store, id])
    }
    if (changed.length) await saveIndex(l, [], changed)
    if (dropped) sweep(l)
    return json(res, 200, { rev: l.idx.rev, applied, stale, missing: [...missing], rejected })
  })
}

/** Handles /api/accounts/*; returns false for any other URL. Open to the Wi-Fi like live sessions, since it needs a password. */
export async function handleAccounts(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? ''
  if (!url.startsWith('/api/accounts/')) return false
  try {
    return await serve(req, res, url)
  } catch (err) {
    if (!(err instanceof DbError)) throw err
    // Nothing was changed (or the user is read back before next use): the client keeps its changes and retries.
    console.warn(`[accounts] database: ${err.code}`)
    if (res.headersSent) {
      res.destroy()
      return true
    }
    return refuse(req, res, 503, { error: 'db' })
  }
}

async function serve(req: IncomingMessage, res: ServerResponse, url: string): Promise<boolean> {
  const rest = url.slice('/api/accounts/'.length)
  const q = rest.indexOf('?')
  const route = q < 0 ? rest : rest.slice(0, q)
  const query = q < 0 ? '' : rest.slice(q + 1)
  const addr = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  const shared = SHARED_ADDR !== '' && addr === SHARED_ADDR

  // The old Lessons-only save; an old tab still open gets this once, then reloads into the new client.
  if (route === 'data') return refuse(req, res, 410, { error: 'gone' })

  // Only Fretwise's own pages: another site open in the browser can't sign up, log in or fill the limits.
  const origin = req.headers.origin
  if (origin !== undefined) {
    let host = ''
    try {
      host = new URL(origin).host
    } catch {
      /* "null" or junk */
    }
    if (host !== req.headers.host) return refuse(req, res, 403, { error: 'origin' })
  }
  // A JSON body needs a CORS preflight from other sites, which the dev server doesn't allow.
  if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return refuse(req, res, 415, { error: 'bad-request', detail: 'type' })
  if (!(await accountsReady())) return refuse(req, res, 503, { error: 'db' })

  if (req.method === 'POST' && (route === 'signup' || route === 'login')) {
    const got = await readJson(req, res, 4096)
    if (!got) return true
    const body = isObject(got.body) ? got.body : {}
    const name = cleanName(body.name)
    const pw = typeof body.password === 'string' ? body.password : ''
    const key = name.toLowerCase()
    if (name.length < 2 || name.length > 24 || LONE_SURROGATE.test(name)) return json(res, 400, { error: 'name' })
    if (pw.length < 6 || pw.length > 200) return json(res, 400, { error: 'password' })
    const existing = Object.values(store.users).find((u) => u.nameKey === key)

    if (route === 'signup') {
      const local = addr === '127.0.0.1' || addr === '::1'
      if (!local) {
        const now = Date.now()
        const recent = (signups.get(addr) ?? []).filter((t) => now - t < SIGNUP_WINDOW_MS)
        signups.set(addr, recent)
        if (recent.length >= (shared ? SHARED_SIGNUP_LIMIT : SIGNUP_LIMIT)) return json(res, 429, { error: 'wait' })
      }
      if (existing) return json(res, 409, { error: 'taken' })
      const users = Object.keys(store.users).length
      if (users >= MAX_USERS + (local ? LOCAL_EXTRA_USERS : 0)) return json(res, 403, { error: 'full' })
      if (!local) signups.get(addr)!.push(Date.now())
      const salt = crypto.randomBytes(16).toString('hex')
      const u: User = { id: crypto.randomUUID(), name, nameKey: key, salt, hash: (await scrypt(pw, salt)).toString('hex'), created: Date.now() }
      // Checked again after the wait: the same name may have signed up meanwhile (the database's unique name decides there).
      let added = false
      try {
        added = db ? await db.addUser({ ...u, rev: 0 }) : !Object.values(store.users).some((x) => x.nameKey === key)
      } catch (err) {
        // The insert may have landed with only its answer lost: take the row in if it's there.
        await adoptUser(key).catch(() => {})
        throw err
      }
      if (!added) {
        await adoptUser(key) // taken by a signup memory never heard of (an answer lost earlier)
        return json(res, 409, { error: 'taken' })
      }
      store.users[u.id] = u
      if (db) loaded.set(u.id, makeLoaded(u.id, emptyIndex()))
      return json(res, 200, { token: await issueToken(u.id), id: u.id, name: u.name, rev: 0 })
    }

    if (tooMany(key) || tooMany(addr, shared ? SHARED_FAIL_LIMIT : FAIL_LIMIT)) return json(res, 429, { error: 'wait' })
    // Same work whether or not the name exists, so timing doesn't reveal accounts.
    const salt = existing?.salt ?? 'no-such-player'
    const got2 = await scrypt(pw, salt)
    const ok = !!existing && crypto.timingSafeEqual(got2, Buffer.from(existing.hash, 'hex'))
    if (!existing || !ok) {
      noteFail(key)
      noteFail(addr)
      return json(res, 401, { error: 'wrong' })
    }
    const token = await issueToken(existing.id)
    const l = loadUser(existing.id)
    return withUser(l, () => json(res, 200, { token, id: existing.id, name: existing.name, rev: l.idx.rev }))
  }

  const u = userFor(req)
  if (!u) return refuse(req, res, 401, { error: 'signed-out' })

  if (req.method === 'POST' && route === 'logout') {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '')
    if (m) {
      // Refused here first, so the token is dead even while the database can't take the sign-out yet.
      delete store.tokens[sha(m[1])]
      save()
      if (db) {
        revoked.add(sha(m[1]))
        await dropRevoked()
      }
    }
    return json(res, 200, { ok: true })
  }

  const l = loadUser(u.id)
  // Reads wait in the user's lock too, so they never see a change the database hasn't taken yet.
  if (req.method === 'GET' && route === 'me') return withUser(l, () => json(res, 200, { id: u.id, name: u.name, rev: l.idx.rev, usage: usage(l) }))
  if (req.method === 'GET' && route === 'changes') return withUser(l, () => changes(res, l, query))
  if (req.method === 'PUT' && route === 'kv') return putKv(req, res, l)
  if (req.method === 'PUT' && route === 'records') return putRecords(req, res, l)

  if (route.startsWith('content/')) {
    const m = /^content\/([0-9a-f]{64})$/.exec(route)
    if (!m) return refuse(req, res, 400, { error: 'bad-request', detail: 'hash' })
    if (req.method === 'GET' || req.method === 'HEAD') return getContent(req, res, l, m[1])
    if (req.method === 'PUT') return putContent(req, res, l, m[1])
  }

  return refuse(req, res, 404, { error: 'not-found' })
}
