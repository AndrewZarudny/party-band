import { describe, expect, it } from 'vitest'
import { matchLyrics } from '../lyrics'
import { cleanSheet, pickVersions } from '../../../server/ultimateGuitar'

describe('a chord sheet from Ultimate Guitar', () => {
  it('takes the chord marks out so the chords keep their columns, and leaves tab staves out', () => {
    const raw = '[Verse]\r\n[tab]     [ch]Am[/ch]   [ch]F[/ch]\n Over the hill[/tab]\n\n\n\ne|---0---3---|\nB|--5^7^5-----|\ng-----7~--------\n[Chorus]'
    expect(cleanSheet(raw)).toBe('[Verse]\n     Am   F\n Over the hill\n\n[Chorus]')
  })

  it('picks the song’s public Chords versions, most liked first', () => {
    const r = (id: number, song: string, type: string, rating: number, votes: number) => ({ id, song_name: song, artist_name: 'Band', type, rating, votes, tab_url: `https://tabs.ultimate-guitar.com/tab/${id}`, tab_access_type: 'public' })
    const got = pickVersions([r(1, 'Song', 'Chords', 4.9, 3), r(2, 'Song', 'Chords', 4.7, 900), r(3, 'Song', 'Tabs', 5, 999), r(4, 'Other', 'Chords', 5, 999), r(5, 'Song', 'Official', 5, 9)], 'song', 'band')
    expect(got.map((v) => v.id)).toEqual([2, 1])
  })

  it('places its parts on the song form: instrumental on the solo, a part with no place goes with the next', () => {
    const text = ['[Verse]', 'one', '[Chorus]', 'two', '[Verse]', 'three', '[Chorus]', 'four', '[Instrumental]', 'Am F', '[Verse]', 'five', '[Chorus]', 'six'].join('\n')
    const form = ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Solo', 'Chorus', 'Outro']
    expect(matchLyrics(text, form, new Set(['Solo']))).toEqual(['', 'one', 'two', 'three', 'four', 'Am F', 'five\n\nsix', ''])
  })
})
