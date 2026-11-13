// Claude Code on this computer: finding the `claude` command, and signing in to it from the app.
// The coach runs through Claude Code (`claude -p`), so it uses the player's own Claude subscription. Signing in
// here runs `claude auth login`: it opens the Claude sign-in page in the browser and finishes by itself, or takes
// the code the page shows when it can't. No terminal needed.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()

/** Where `claude` usually lives: the native install, Homebrew, npm's global folder, any nvm Node. */
function candidates(): string[] {
  const list = [path.join(HOME, '.local', 'bin', 'claude'), path.join(HOME, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) if (dir) list.push(path.join(dir, 'claude'))
  try {
    const nvm = path.join(HOME, '.nvm', 'versions', 'node')
    // Newest Node first, so a current install wins over an old one.
    for (const v of fs.readdirSync(nvm).sort().reverse()) list.push(path.join(nvm, v, 'bin', 'claude'))
  } catch {
    // no nvm
  }
  return list
}

const runnable = (p: string) => {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The full path of the `claude` command, or null when Claude Code isn't installed. Looked up on every call, so
 * the app follows Claude Code when it moves (e.g. `claude install` replaces an npm copy with the native one).
 */
export function claudePath(): string | null {
  return candidates().find(runnable) ?? null
}

/** The environment for running `claude`: the subscription sign-in only, never an API key that happens to be set. */
export function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  // An npm-installed `claude` is a Node script: make sure it finds a Node next to it.
  const bin = claudePath()
  if (bin) env.PATH = [path.dirname(bin), env.PATH].filter(Boolean).join(path.delimiter)
  return env
}

export interface ClaudeStatus {
  installed: boolean
  loggedIn: boolean
  /** e.g. "claude.ai" for a subscription, "console" for API billing; as Claude Code reports it. */
  authMethod: string | null
  email: string | null
  subscription: string | null
  /** A sign-in started from the app is waiting for the browser or a pasted code. */
  pending: boolean
  /** The sign-in page, for when the browser didn't open by itself. */
  url: string | null
  /** The last sign-in attempt failed: why, in Claude Code's words. */
  error: string | null
}

let login: { child: ChildProcessWithoutNullStreams; url: string | null; output: string } | null = null
let lastError: string | null = null

function authStatus(): Promise<{ loggedIn: boolean; authMethod: string | null; email: string | null; subscription: string | null }> {
  const bin = claudePath()
  if (!bin) return Promise.resolve({ loggedIn: false, authMethod: null, email: null, subscription: null })
  return new Promise((resolve) => {
    execFile(bin, ['auth', 'status', '--json'], { env: claudeEnv(), cwd: os.tmpdir(), timeout: 20000 }, (_err, stdout) => {
      try {
        const o = JSON.parse(stdout) as Record<string, unknown>
        const str = (k: string) => (typeof o[k] === 'string' && o[k] ? (o[k] as string) : null)
        resolve({
          loggedIn: o.loggedIn === true,
          authMethod: str('authMethod') === 'none' ? null : str('authMethod'),
          email: str('email') ?? str('emailAddress'),
          subscription: str('subscriptionType') ?? str('subscription'),
        })
      } catch {
        resolve({ loggedIn: false, authMethod: null, email: null, subscription: null })
      }
    })
  })
}

export async function claudeStatus(): Promise<ClaudeStatus> {
  const s = await authStatus()
  // Signed in: a sign-in still waiting is done (the browser finished it).
  if (s.loggedIn && login) {
    login.child.kill()
    login = null
  }
  return { installed: !!claudePath(), ...s, pending: !!login, url: login?.url ?? null, error: login ? null : lastError }
}

/** Starts `claude auth login` with the Claude subscription. It opens the sign-in page in the browser. */
export function startClaudeLogin(): { ok: true } | { ok: false; error: string } {
  const bin = claudePath()
  if (!bin) return { ok: false, error: 'Claude Code is not installed on this computer.' }
  login?.child.kill()
  lastError = null
  const child = spawn(bin, ['auth', 'login', '--claudeai'], { env: claudeEnv(), cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
  const me = { child, url: null as string | null, output: '' }
  login = me
  const read = (c: Buffer) => {
    me.output += c.toString()
    me.url ??= me.output.match(/https:\/\/\S+oauth\/authorize\?\S+/)?.[0] ?? null
  }
  child.stdout.on('data', read)
  child.stderr.on('data', read)
  child.on('error', (err) => {
    lastError = String(err.message)
    if (login === me) login = null
  })
  child.on('close', (code) => {
    if (login !== me) return
    login = null
    if (code !== 0) {
      // The last line Claude Code printed, minus the prompt and any link.
      const lines = me.output.split('\n').map((l) => l.replace(/https:\/\/\S+/g, '').trim()).filter((l) => l && !/paste code here/i.test(l))
      lastError = lines.at(-1) ?? `Sign-in stopped (${code}).`
    }
  })
  // Stop waiting after 10 minutes.
  setTimeout(() => {
    if (login === me) {
      child.kill()
      login = null
      lastError = 'The sign-in timed out. Try again.'
    }
  }, 10 * 60 * 1000).unref()
  return { ok: true }
}

/** The code the sign-in page shows, for when the browser couldn't hand it back by itself. */
export function sendClaudeLoginCode(code: string): boolean {
  if (!login || !code.trim()) return false
  login.child.stdin.write(code.trim() + '\n')
  return true
}

export function cancelClaudeLogin() {
  login?.child.kill()
  login = null
}
