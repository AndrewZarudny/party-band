// Shared Claude call for the app's AI features, built to keep cost down:
// - each feature uses the cheapest model that does the job well (measured, see README)
// - answers come back as schema-validated JSON (structured outputs), no prose to parse
// - the stable prefix (tools + system prompt) carries a cache breakpoint
// - low effort and a cap on web searches per call
// - identical requests are answered from a disk cache for free
// - every call's cost is computed from the API's usage report and logged
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { claudeEnv, claudePath } from './claudeCode'

export type ModelId = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'claude-opus-5-5'

/** $ per million tokens (prompts ≤ 100K tokens), from the Claude pricing table. */
const PRICES: Record<ModelId, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
}
const WEB_SEARCH_USD = 0.01 // $10 per 1,000 searches

export const MODEL_LABEL: Record<ModelId, string> = {
  'claude-haiku-5-5': 'Haiku 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-opus-5-5': 'Opus 5.5',
}

export interface Cost {
  usd: number
  model: string
  searches: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cached: boolean // answered from the local result cache (free)
}

export type Feature = 'song-search' | 'original-tone' | 'song-setup' | 'lyrics-arrange' | 'coach'

// ---- Local result cache and cost ledger (in .cache/, git-ignored) ----------------

const DIR = path.resolve('.cache')
const CACHE_FILE = path.join(DIR, 'ai-results.json')
const LEDGER_FILE = path.join(DIR, 'ai-ledger.json')
const CACHE_DAYS = 60

const readJson = <T,>(f: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as T
  } catch {
    return fallback
  }
}
const writeJson = (f: string, v: unknown) => {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(f, JSON.stringify(v))
}

interface LedgerRow {
  at: number
  feature: Feature
  model: string
  usd: number
  cached: boolean
}

function logCost(feature: Feature, c: Cost) {
  const rows = readJson<LedgerRow[]>(LEDGER_FILE, [])
  rows.push({ at: Date.now(), feature, model: c.model, usd: c.usd, cached: c.cached })
  writeJson(LEDGER_FILE, rows.slice(-500))
}

/** Typical cost per feature (average of recent real calls, or a starting estimate) and spend this month. */
export function costSummary(defaults: Record<Feature, ModelId>) {
  const rows = readJson<LedgerRow[]>(LEDGER_FILE, [])
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  const STARTING: Record<Feature, number> = { 'song-search': 0.022, 'original-tone': 0.024, 'song-setup': 0.02, 'lyrics-arrange': 0.002, coach: 0.012 } // measured on Haiku 5.5; coach: an estimate for Opus 5.5 (about 1.5K tokens in, 300 out)
  const estimate = (f: Feature) => {
    const recent = rows.filter((r) => r.feature === f && !r.cached && r.model === defaults[f]).slice(-10)
    return recent.length ? recent.reduce((s, r) => s + r.usd, 0) / recent.length : STARTING[f]
  }
  return {
    estimates: {
      'song-search': estimate('song-search'),
      'original-tone': estimate('original-tone'),
      'song-setup': estimate('song-setup'),
      'lyrics-arrange': estimate('lyrics-arrange'),
      coach: estimate('coach'),
    },
    models: {
      'song-search': MODEL_LABEL[defaults['song-search']],
      'original-tone': MODEL_LABEL[defaults['original-tone']],
      'song-setup': MODEL_LABEL[defaults['song-setup']],
      'lyrics-arrange': MODEL_LABEL[defaults['lyrics-arrange']],
      coach: MODEL_LABEL[defaults.coach],
    },
    monthUsd: rows.filter((r) => r.at >= start.getTime()).reduce((s, r) => s + r.usd, 0),
  }
}

// ---- The call ---------------------------------------------------------------------

let client: Anthropic | null = null
/** True when `ant auth login` has stored an OAuth profile on this computer (the SDK picks it up by itself). */
function hasLoginProfile(): boolean {
  try {
    const dir = process.env.ANTHROPIC_CONFIG_DIR ?? path.join(process.env.APPDATA && process.platform === 'win32' ? path.join(process.env.APPDATA, 'Anthropic') : path.join(process.env.HOME ?? '', '.config', 'anthropic'))
    return fs.readdirSync(path.join(dir, 'credentials')).some((f) => f.endsWith('.json'))
  } catch {
    return false
  }
}

/**
 * The Claude client, or null when this computer has no credentials. Either works: an API key in .env.local
 * (ANTHROPIC_API_KEY), or signing in once with `ant auth login` (OAuth, no key to keep; a set key still wins).
 */
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !hasLoginProfile()) return null
  client ??= new Anthropic()
  return client
}

function priceOf(model: string, u: Anthropic.Beta.BetaUsage): number {
  const p = PRICES[(Object.keys(PRICES).find((k) => model.startsWith(k)) as ModelId) ?? 'claude-opus-5-5']
  const m = 1_000_000
  return (
    ((u.input_tokens ?? 0) * p.input) / m +
    ((u.output_tokens ?? 0) * p.output) / m +
    ((u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / m +
    ((u.cache_read_input_tokens ?? 0) * p.cacheRead) / m +
    (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD
  )
}

/**
 * How the AI features run on this computer: through Claude Code on the player's Claude subscription (Opus, no
 * API key, no per-call cost), else the API client (a key or an `ant` sign-in), else not at all.
 */
export function aiVia(): 'claude-code' | 'api' | null {
  if (claudePath()) return 'claude-code'
  return getClient() ? 'api' : null
}

const CC_MODEL = 'Opus 5.5 (Claude subscription)'

/** The schema for Claude Code's --json-schema: without the "$schema" draft line, which it can't resolve. */
function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  void _drop
  return rest
}
const SIGN_IN = "Claude Code isn't signed in on this computer. Click AI teacher at the top and sign in with your Claude account."

/**
 * One request through Claude Code in headless mode, on Opus: web search only (no other tools, no project
 * settings, nothing saved), the answer as JSON matching the schema. The URLs its searches returned are collected
 * from the stream, so callers can keep only links that really came back from the web.
 */
function runViaClaudeCode<S extends z.ZodType>(call: JsonCall<S>): Promise<{ data: z.infer<S>; seen: Set<string>; searches: number }> {
  return new Promise((resolve, reject) => {
    const bin = claudePath()
    if (!bin) return reject(new Error('Claude Code is not installed on this computer.'))
    const search = call.maxSearches > 0
    const system = `${call.system}${search ? `\n\nUse the WebSearch tool at most ${call.maxSearches} times, and only for these sites: ${call.searchDomains.join(', ')} (pass them as allowed_domains). Use only URLs that appear in your search results.` : ''}\n\nAnswer with the JSON object only.`
    const args = [
      '-p',
      '--model', 'opus',
      '--effort', 'low',
      '--output-format', 'stream-json',
      '--verbose',
      '--json-schema', JSON.stringify(jsonSchemaOf(call.schema)),
      '--system-prompt', system,
      '--tools', search ? 'WebSearch' : '',
      ...(search ? ['--allowedTools', 'WebSearch'] : []),
      '--strict-mcp-config',
      '--setting-sources', '',
      '--no-session-persistence',
    ]
    const child = spawn(bin, args, { env: claudeEnv(), cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
    const seen = new Set<string>()
    let searches = 0
    let result: { text: string; structured: unknown; isError: boolean } | null = null
    let buf = ''
    let errText = ''
    const timer = setTimeout(() => child.kill(), 240_000)
    const urlsIn = (v: unknown) => {
      for (const m of JSON.stringify(v ?? '').matchAll(/https?:\/\/[^\s"'\\)\]]+/g)) seen.add(m[0].replace(/\/$/, ''))
    }
    child.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let o: { type?: string; message?: { content?: unknown }; result?: unknown; structured_output?: unknown; is_error?: boolean }
        try {
          o = JSON.parse(line)
        } catch {
          continue
        }
        const content = Array.isArray(o.message?.content) ? (o.message.content as { type?: string; name?: string; content?: unknown }[]) : []
        for (const b of content) {
          if (o.type === 'assistant' && b.type === 'tool_use' && b.name === 'WebSearch') searches++
          if (o.type === 'user' && b.type === 'tool_result') urlsIn(b.content)
        }
        if (o.type === 'result') result = { text: String(o.result ?? ''), structured: o.structured_output, isError: !!o.is_error }
      }
    })
    child.stderr.on('data', (d) => (errText = (errText + d).slice(-2000)))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (!result) return reject(new Error(code ? `Claude Code stopped (${code}). ${errText.trim().split('\n').at(-1) ?? ''}`.trim() : 'Claude Code took too long to answer.'))
      if (result.isError) return reject(new Error(/log ?in|auth|expired/i.test(result.text) ? SIGN_IN : result.text || 'Claude could not answer.'))
      let raw = result.structured
      if (raw === undefined) {
        const a = result.text.indexOf('{')
        const b = result.text.lastIndexOf('}')
        try {
          raw = a >= 0 && b > a ? JSON.parse(result.text.slice(a, b + 1)) : undefined
        } catch {
          raw = undefined
        }
      }
      const parsed = call.schema.safeParse(raw)
      if (!parsed.success) return reject(new Error("Couldn't read the AI's answer."))
      resolve({ data: parsed.data, seen, searches })
    })
    child.stdin.end(call.user)
  })
}

export interface JsonCall<S extends z.ZodType> {
  feature: Feature
  model: ModelId
  system: string
  user: string
  schema: S
  searchDomains: string[]
  maxSearches: number
  cacheKey: string
}

export interface JsonResult<T> {
  data: T
  seenUrls: Set<string>
  cost: Cost
}

/** One Claude request with web search, answered as JSON matching `schema`. */
export async function runJson<S extends z.ZodType>(call: JsonCall<S>): Promise<JsonResult<z.infer<S>>> {
  // The prompt's hash is part of the key, so editing a prompt never serves answers from the old one.
  const promptHash = createHash('sha1').update(call.system).digest('hex').slice(0, 8)
  const via = aiVia()
  const key = `${call.feature}|${via === 'claude-code' ? 'claude-code-opus' : call.model}|${promptHash}|${call.cacheKey.toLowerCase().trim()}`
  const cache = readJson<Record<string, { at: number; data: unknown; seen: string[]; usd: number }>>(CACHE_FILE, {})
  const hit = cache[key]
  if (hit && Date.now() - hit.at < CACHE_DAYS * 86_400_000) {
    const cost: Cost = { usd: 0, model: via === 'claude-code' ? CC_MODEL : MODEL_LABEL[call.model], searches: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cached: true }
    logCost(call.feature, cost)
    return { data: hit.data as z.infer<S>, seenUrls: new Set(hit.seen), cost }
  }

  // Claude Code on this computer: Opus on the player's subscription, nothing to pay per call.
  if (via === 'claude-code') {
    const { data, seen, searches } = await runViaClaudeCode(call)
    const cost: Cost = { usd: 0, model: CC_MODEL, searches, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cached: false }
    logCost(call.feature, cost)
    cache[key] = { at: Date.now(), data, seen: [...seen], usd: 0 }
    writeJson(CACHE_FILE, cache)
    return { data, seenUrls: seen, cost }
  }

  const c = getClient()
  if (!c) throw new Error('AI is off: install Claude Code on this computer and sign in (AI teacher at the top).')
  // Haiku uses the basic web search tool; Sonnet/Opus get the newer one with result filtering.
  const search =
    call.model === 'claude-haiku-5-5'
      ? ({ type: 'web_search_20250305', name: 'web_search', max_uses: call.maxSearches, allowed_domains: call.searchDomains } as const)
      : ({ type: 'web_search_20260209', name: 'web_search', max_uses: call.maxSearches, allowed_domains: call.searchDomains } as const)
  const response = await c.beta.messages.parse({
    model: call.model,
    max_tokens: 8000,
    // Refusal fallback where the model supports it (not on Haiku).
    ...(call.model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    output_config: { effort: 'low', format: betaZodOutputFormat(call.schema) },
    // Tools + system are identical on every call of a feature: cache them.
    system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
    // Features that don't need the web send no tools at all (cheaper, faster).
    ...(call.maxSearches > 0 ? { tools: [search] } : {}),
    messages: [{ role: 'user', content: call.user }],
  })
  if (response.stop_reason === 'refusal') throw new Error('The AI declined this request.')

  const seen = new Set<string>()
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === 'web_search_result') seen.add(r.url.replace(/\/$/, ''))
    }
  }
  const data = response.parsed_output
  if (!data) throw new Error("Couldn't read the AI's answer.")
  const u = response.usage
  const cost: Cost = {
    usd: priceOf(response.model, u),
    model: MODEL_LABEL[call.model],
    searches: u.server_tool_use?.web_search_requests ?? 0,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cached: false,
  }
  logCost(call.feature, cost)
  cache[key] = { at: Date.now(), data, seen: [...seen], usd: cost.usd }
  writeJson(CACHE_FILE, cache)
  return { data, seenUrls: seen, cost }
}

export function aiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Try again in a minute.'
  if (err instanceof Anthropic.APIError) return `AI request failed (${err.status}): ${err.message}`
  return err instanceof Error ? err.message : String(err)
}
