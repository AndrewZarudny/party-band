// Links to a song's lyrics page on Genius. The app never copies or stores lyrics from it:
// singers open the page themselves while Fretwise keeps the song's sections and cues.

/** Genius page addresses look like "The-cranberries-zombie-lyrics". */
export function geniusSongUrl(title: string, artist: string): string {
  const slug = `${artist} ${title}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `https://genius.com/${slug.charAt(0).toUpperCase()}${slug.slice(1)}-lyrics`
}

export const geniusSearchUrl = (title: string, artist: string) => `https://genius.com/search?q=${encodeURIComponent(`${title} ${artist}`)}`

/** "Zombie – The Cranberries" → { title, artist }. */
export function splitSongTitle(songTitle: string): { title: string; artist: string } {
  const [title, ...rest] = songTitle.split(' – ')
  return { title: title.trim(), artist: rest.join(' – ').trim() }
}

/** AmDm.ru: Russian site with the words and chords together (also has many English songs). */
export const amdmSearchUrl = (title: string, artist: string) => `https://amdm.ru/search/?q=${encodeURIComponent(`${title} ${artist}`)}`
