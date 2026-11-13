// The live coach: one Claude Code conversation kept open for a practice session, so replies come in a few
// seconds and it remembers what was said and played. Runs on the player's Claude subscription like the written
// coach (claudeCode.ts). The browser sends what happened (a run's numbers, or what the player said) and speaks
// the reply aloud.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import { claudeEnv, claudePath } from './claudeCode'

const SYSTEM = `You are a friendly, expert guitar coach sitting next to the player during their practice session in Fretwise, a guitar practice app. Everything you write is spoken aloud by a text-to-speech voice, right after a run or when the player talks to you.

What you get:
- "[run]" messages: the numbers from a run the player just finished (score, timing in ms where positive is late, the hardest bar, note counts, tempo, what improved). This is how you "hear" them play: the app listened and measured it. Do not claim to hear tone or sound beyond these numbers.
- "[player]" messages: what the player just said out loud, turned into text by speech recognition. It may have small recognition mistakes; read it charitably. If it looks like noise rather than words meant for you (guitar picked up by the mic), answer with exactly: (silence)
- "[context]" messages: facts about the player and today's plan.

How you talk:
- Like a real coach in the room: warm, direct, specific. Usually one or two short sentences, at most three. The player has a guitar in their hands.
- After a run: one concrete observation from the numbers and one thing to do on the next run (a bar to watch, ease off or push the tempo, a technique cue). Do not read numbers back unless one matters.
- Answer questions plainly. For a technique question, give the single most useful cue.
- Plain spoken words only: no lists, no headings, no markdown, no emoji, no abbreviations a voice would stumble on (say "beats per minute" or just "tempo", not "BPM").
- Never invent results you were not given.

Doing things for the player:
- Each message ends with the actions available on the player's screen right now, like "[actions you can take now: again = play the same lesson again; slower = ...]".
- When the player asks for one of them ("again", "slower please", "loop bars three and four", "next"), or clearly agrees to your suggestion, do it: say a few words, then put the tag at the very end, like <<do:slower>> or <<do:loop 3-4>>. Only one tag, only an action from the list, with the argument it asks for.
- Never take an action the player didn't ask for or agree to. If what they ask isn't in the list, say what they can click instead.`

interface Pending {
  text: string
  resolve: (reply: string) => void
  reject: (err: Error) => void
}

let child: ChildProcessWithoutNullStreams | null = null
let buf = ''
let current: Pending | null = null
const queue: Pending[] = []
let idle: NodeJS.Timeout | null = null

const SIGN_IN = "Claude Code isn't signed in on this computer. Click AI teacher at the top and sign in with your Claude account."

function start(): ChildProcessWithoutNullStreams {
  const bin = claudePath()
  if (!bin) throw new Error('Claude Code is not installed on this computer.')
  const c = spawn(
    bin,
    [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      // The fastest model: a coach should answer in a few seconds.
      '--model', 'haiku',
      // A conversation only: no tools, no MCP servers, no settings from the user's projects, nothing saved.
      '--tools', '',
      '--strict-mcp-config',
      '--setting-sources', '',
      '--no-session-persistence',
      '--system-prompt', SYSTEM,
    ],
    { env: claudeEnv(), cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let errText = ''
  c.stderr.on('data', (d) => (errText = (errText + d).slice(-2000)))
  c.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      let o: { type?: string; result?: unknown; is_error?: boolean }
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o.type !== 'result' || !current) continue
      const p = current
      current = null
      const text = String(o.result ?? '').trim()
      if (o.is_error) p.reject(new Error(/log ?in|auth|expired/i.test(text) ? SIGN_IN : text || 'The coach could not answer.'))
      else p.resolve(text)
      next()
    }
  })
  const fail = (why: string) => {
    if (child === c) child = null
    buf = ''
    const err = new Error(/log ?in|auth|expired/i.test(why) ? SIGN_IN : why)
    current?.reject(err)
    current = null
    for (const q of queue.splice(0)) q.reject(err)
  }
  c.on('error', (err) => fail(err.message))
  c.on('close', (code) => fail(code ? `The coach stopped (${code}). ${errText.trim().split('\n').at(-1) ?? ''}`.trim() : 'The coach ended.'))
  return c
}

function next() {
  if (current || !queue.length) return
  current = queue.shift() ?? null
  if (!current) return
  try {
    child ??= start()
    child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: current.text } }) + '\n')
  } catch (err) {
    const p = current
    current = null
    p.reject(err instanceof Error ? err : new Error(String(err)))
    next()
  }
}

/** Sends one message to the live coach and waits for its reply. The conversation starts on the first message. */
export function tellCoach(text: string): Promise<string> {
  // Ends by itself after 20 minutes with nothing said.
  if (idle) clearTimeout(idle)
  idle = setTimeout(endCoach, 20 * 60 * 1000)
  idle.unref()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The coach took too long to answer.')), 60000)
    queue.push({
      text,
      resolve: (r) => {
        clearTimeout(timer)
        resolve(r)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })
    next()
  })
}

/** Ends the conversation (the next message starts a new one). */
export function endCoach() {
  if (idle) clearTimeout(idle)
  idle = null
  const c = child
  child = null
  c?.stdin.end()
  c?.kill()
}
