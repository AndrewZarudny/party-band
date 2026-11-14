import { describe, expect, it } from 'vitest'
import type { SongSetup } from '../songForm'
import type { PlayLog } from '../songLibrary'
import { learnedState, loadSongNote, normTitle, rehearseList, saveSongNote, songStatus } from '../songStatus'

const DAY = 86_400_000
const now = 100 * DAY
const song = (title: string) => ({ title, artist: 'Band' }) as SongSetup
const log = (title: string, daysAgo: number, finished: boolean): PlayLog => ({
  id: `${title}${daysAgo}`,
  key: `${title}|band`.toLowerCase(),
  title,
  artist: 'Band',
  startedAt: now - daysAgo * DAY,
  playedSec: 100,
  totalSec: 200,
  finished,
  players: [],
  withRecording: false,
})

describe('where a band song stands', () => {
  it('plays, played to the end, and why it needs a rehearsal', () => {
    const h = [log('Numb', 3, true), log('Numb', 5, false), log('Creep', 20, true), log('Zombie', 2, false)]
    expect(songStatus(song('Numb'), h, now)).toMatchObject({ plays: 2, finished: 1, rehearse: null })
    expect(songStatus(song('Creep'), h, now).rehearse).toBe('not played for 20 days')
    expect(songStatus(song('Zombie'), h, now).rehearse).toBe('never played to the end')
    expect(songStatus(song('Wonderwall'), h, now).rehearse).toBe('never played')
  })
  it('to rehearse: never played first, then never finished, then the longest unplayed', () => {
    const h = [log('Numb', 3, true), log('Creep', 20, true), log('Yellow', 40, true), log('Zombie', 2, false)]
    const list = rehearseList([song('Numb'), song('Creep'), song('Zombie'), song('Yellow'), song('Wonderwall')], h, now)
    expect(list.map((x) => x.song.title)).toEqual(['Wonderwall', 'Zombie', 'Yellow', 'Creep'])
  })
})

describe('your part in Learn a song, by title', () => {
  it('band-ready, learning, or not started', () => {
    localStorage.clear()
    localStorage.setItem('song-runs:a1', JSON.stringify([{ at: 1, pct: 80, title: 'Numb (Live)' }]))
    localStorage.setItem('song-levels:a1', JSON.stringify({ track: 'g', total: 4, passed: { 0: { pct: 80, speed: 70 }, 1: { pct: 75, speed: 80 } } }))
    expect(learnedState('Numb')).toEqual({ state: 'learning', done: 2, total: 4 })
    localStorage.setItem('song-levels:a1', JSON.stringify({ track: 'g', total: 4, passed: {}, ready: { pct: 90, speed: 100 } }))
    expect(learnedState('numb')?.state).toBe('ready')
    expect(learnedState('Creep')).toBeNull()
    expect(normTitle('Numb - Remastered')).toBe('numb')
  })
})

describe("the band's notes on a song", () => {
  it('kept per song; an empty note is removed', () => {
    localStorage.clear()
    saveSongNote('numb|band', 'Capo 2 for Alina')
    expect(loadSongNote('numb|band')).toBe('Capo 2 for Alina')
    saveSongNote('numb|band', '  ')
    expect(loadSongNote('numb|band')).toBe('')
  })
})
