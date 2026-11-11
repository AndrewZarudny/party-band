// Shared Claude call for the app's AI features, built to keep cost down:
// - each feature uses the cheapest model that does the job well (measured, see README)
// - answers come back as schema-validated JSON (structured outputs), no prose to parse
// - the stable prefix (tools + system prompt) carries a cache breakpoint
// - low effort and a cap on web searches per call
// - identical requests are answered from a disk cache for free
// - every call's cost is computed from the API's usage report and logged
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { z } from 'zod'

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
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null
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
  const key = `${call.feature}|${call.model}|${promptHash}|${call.cacheKey.toLowerCase().trim()}`
  const cache = readJson<Record<string, { at: number; data: unknown; seen: string[]; usd: number }>>(CACHE_FILE, {})
  const hit = cache[key]
  if (hit && Date.now() - hit.at < CACHE_DAYS * 86_400_000) {
    const cost: Cost = { usd: 0, model: MODEL_LABEL[call.model], searches: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cached: true }
    logCost(call.feature, cost)
    return { data: hit.data as z.infer<S>, seenUrls: new Set(hit.seen), cost }
  }

  const c = getClient()
  if (!c) throw new Error('AI is off: add ANTHROPIC_API_KEY to .env.local and restart.')
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
