// Chord sheets from Ultimate Guitar, read on this Mac when the user asks for a song's chords (🎤 Lyrics →
// Ultimate Guitar). Only the public "Chords" versions: UG's "Official" ones are part of its paid Pro plan.
// The page's own data (the js-store JSON) gives the sheet with [ch]Am[/ch] marks over the words.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

export interface UgVersion {
  id: number
  song: string
  artist: string
  version: number
  rating: number
  votes: number
  url: string
}

export interface UgSheet {
  id: number
  song: string
  artist: string
  url: string
  capo: number
  key: string // as UG writes it ('' when not given)
  text: string // headings, chord lines and words, the [ch]/[tab] marks taken out
}

async function page(url: string): Promise<string> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: ctl.signal, redirect: 'manual' })
    if (r.status !== 200) throw new Error(`Ultimate Guitar answered ${r.status}`)
    return await r.text()
  } finally {
    clearTimeout(t)
  }
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** The page's data: UG keeps it as JSON in the js-store element. */
export function storeData(html: string): Record<string, unknown> | null {
  const m = /class="js-store" data-content="([^"]*)"/.exec(html)
  if (!m) return null
  try {
    return (JSON.parse(decode(m[1])) as { store?: { page?: { data?: Record<string, unknown> } } }).store?.page?.data ?? null
  } catch {
    return null
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^the /, '')
    .trim()

interface RawResult {
  id?: number
  song_name?: string
  artist_name?: string
  type?: string | null
  rating?: number | null
  votes?: number | null
  version?: number | null
  tab_url?: string
  tab_access_type?: string | null
}

/** The song's public Chords versions, best first (most liked, weighed by how many voted). */
export function pickVersions(results: RawResult[], title: string, artist: string): UgVersion[] {
  const t = norm(title)
  const a = norm(artist)
  const chords = results.filter((r) => r.type === 'Chords' && r.tab_access_type === 'public' && r.tab_url && r.id)
  const exact = chords.filter((r) => norm(r.song_name ?? '') === t)
  const same = (exact.length ? exact : chords.filter((r) => norm(r.song_name ?? '').includes(t))).filter((r) => {
    const ra = norm(r.artist_name ?? '')
    return !a || ra === a || ra.includes(a) || a.includes(ra)
  })
  const score = (r: RawResult) => (r.rating ?? 0) * Math.log(1 + (r.votes ?? 0))
  return same
    .sort((x, y) => score(y) - score(x))
    .slice(0, 6)
    .map((r) => ({ id: r.id!, song: r.song_name ?? title, artist: r.artist_name ?? artist, version: r.version ?? 1, rating: Math.round((r.rating ?? 0) * 10) / 10, votes: r.votes ?? 0, url: r.tab_url! }))
}

export async function searchChords(title: string, artist: string): Promise<UgVersion[]> {
  const q = encodeURIComponent(`${artist} ${title}`.trim())
  const data = storeData(await page(`https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}&type=300`))
  const results = ((data?.results as RawResult[] | undefined) ?? []).filter(Boolean)
  let found = pickVersions(results, title, artist)
  if (!found.length) {
    // Some songs are only found by their title.
    const d2 = storeData(await page(`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(title)}&type=300`))
    found = pickVersions(((d2?.results as RawResult[] | undefined) ?? []).filter(Boolean), title, artist)
  }
  return found
}

/** A sheet's text as the page shows it: chord marks out (so the chords keep their columns), tab staves left out. */
export function cleanSheet(content: string): string {
  return content
    .replace(/\r/g, '')
    .replace(/\[\/?tab\]/g, '')
    .replace(/\[ch\]([^[]*?)\[\/ch\]/g, '$1')
    .split('\n')
    .filter((l) => !/^\s*[a-gA-G][#b]?\s*[|-].*-{3,}/.test(l)) // a tab staff line: e|---0---3---| or e--5~10---
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function chordSheet(v: UgVersion): Promise<UgSheet> {
  const { id, url } = v
  if (!/^https:\/\/tabs\.ultimate-guitar\.com\/tab\//.test(url)) throw new Error('Not an Ultimate Guitar chords page')
  const data = storeData(await page(url))
  const tab = (data?.tab ?? {}) as { song_name?: string; artist_name?: string; capo?: number | null; tonality_name?: string }
  const content = ((data?.tab_view as { wiki_tab?: { content?: string } } | undefined)?.wiki_tab?.content ?? '') as string
  if (!content.trim()) throw new Error('That Ultimate Guitar page has no chord sheet')
  return { id, song: tab.song_name ?? '', artist: tab.artist_name ?? '', url, capo: tab.capo ?? 0, key: tab.tonality_name ?? '', text: cleanSheet(content) }
}
