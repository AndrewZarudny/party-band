// Packs the Fretwise accounts of this computer into one file, to move them to another computer.
//
//   node scripts/export-account.mjs [output.tgz]
//
// Works with either backend: MariaDB (FRETWISE_DB_URL in the environment or .env.local) or the JSON files in .cache.
// The result holds .cache/accounts.json, each user's index and their files (tabs, recordings, captures), in the JSON
// backend's layout, so the other computer needs no database: put the file next to Fretwise.command and start it.
// Sign-in tokens are left out; sign in again there with the same name and password.
// The file holds your password's hash and your data: move it yourself, and never commit it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const out = path.resolve(process.argv[2] ?? 'fretwise-account.tgz')
const ROOT = path.resolve('.cache')
const STORES = ['songs', 'captures', 'recordings']

function dbUrl() {
  if (process.env.FRETWISE_DB_URL) return process.env.FRETWISE_DB_URL
  try {
    const m = /^FRETWISE_DB_URL=(.*)$/m.exec(fs.readFileSync('.env.local', 'utf8'))
    return m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2') : ''
  } catch {
    return ''
  }
}

/** Users and each user's index, from MariaDB. */
async function fromDb(url) {
  const mysql = await import('mysql2/promise')
  const c = await mysql.createConnection({ uri: url, supportBigNumbers: true })
  try {
    const [users] = await c.query('SELECT id, name, name_key, salt, hash, created, rev FROM users')
    const [kv] = await c.query('SELECT user_id, k, v, t, rev FROM kv')
    const [records] = await c.query('SELECT user_id, store, id, meta, hash, size, t, rev, deleted FROM records')
    const store = { v: 1, users: {}, tokens: {} }
    const indexes = {}
    for (const u of users) {
      store.users[u.id] = { id: u.id, name: u.name, nameKey: u.name_key, salt: u.salt, hash: u.hash, created: Number(u.created) }
      indexes[u.id] = { v: 1, rev: Number(u.rev), kv: {}, records: { songs: {}, captures: {}, recordings: {} } }
    }
    for (const r of kv) if (indexes[r.user_id]) indexes[r.user_id].kv[r.k] = { v: r.v, t: Number(r.t), rev: Number(r.rev) }
    for (const r of records) {
      const idx = indexes[r.user_id]
      if (!idx || !STORES.includes(r.store)) continue
      let meta = null
      try {
        meta = r.meta ? JSON.parse(r.meta) : null
      } catch {
        /* unreadable details: the record goes without them */
      }
      const item = { meta, hash: r.hash, size: r.size === null ? null : Number(r.size), t: Number(r.t), rev: Number(r.rev) }
      if (Number(r.deleted)) item.deleted = true
      idx.records[r.store][r.id] = item
    }
    return { store, indexes }
  } finally {
    await c.end()
  }
}

/** The same, from the JSON files. */
function fromFiles() {
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'accounts.json'), 'utf8'))
  const indexes = {}
  for (const id of Object.keys(store.users)) {
    try {
      indexes[id] = JSON.parse(fs.readFileSync(path.join(ROOT, 'accounts', id, 'index.json'), 'utf8'))
    } catch {
      /* nothing saved for this user yet */
    }
  }
  return { store: { v: 1, users: store.users, tokens: {} }, indexes }
}

const url = dbUrl()
const { store, indexes } = url ? await fromDb(url) : fromFiles()
const names = Object.values(store.users).map((u) => u.name)
if (!names.length) {
  console.error('No accounts on this computer: nothing to export.')
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fretwise-export-'))
try {
  const cache = path.join(tmp, '.cache')
  fs.mkdirSync(path.join(cache, 'accounts'), { recursive: true })
  fs.writeFileSync(path.join(cache, 'accounts.json'), JSON.stringify(store))
  let files = 0
  let missing = 0
  for (const [id, idx] of Object.entries(indexes)) {
    const dir = path.join(cache, 'accounts', id)
    fs.mkdirSync(path.join(dir, 'content'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx))
    // Only the files a record still points to.
    const hashes = new Set()
    for (const s of STORES) for (const r of Object.values(idx.records?.[s] ?? {})) if (r.hash && !r.deleted) hashes.add(r.hash)
    for (const h of hashes) {
      const src = path.join(ROOT, 'accounts', id, 'content', h)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dir, 'content', h))
        files++
      } else missing++
    }
  }
  execFileSync('tar', ['-czf', out, '-C', tmp, '.cache'])
  const kb = Math.round(fs.statSync(out).size / 1024)
  console.log(`Exported ${names.length} account(s) (${names.join(', ')}) from ${url ? 'MariaDB' : 'the JSON files'}: ${files} file(s), ${kb} KB.`)
  if (missing) console.warn(`${missing} file(s) listed in the account were not on disk and are not in the export.`)
  console.log(`Written to ${out}`)
  console.log('On the other computer: put it in the Fretwise folder, next to Fretwise.command, and start Fretwise.')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
