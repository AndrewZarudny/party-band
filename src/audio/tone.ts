// Amp tone presets and the logic that suggests one for a song.

export type AmpModel = 'clean' | 'chime' | 'crunch' | 'highgain' | 'fuzz' | 'acoustic' | 'bass'

/** Amp voicings: a fixed EQ character, clipping shape and cabinet roll-off per model. */
export const AMP_MODELS: Record<AmpModel, { label: string; voiceHz: number; voiceDb: number; voiceQ: number; asym: number; cabLp: number; tight: number }> = {
  clean: { label: 'US clean (Fender-style)', voiceHz: 450, voiceDb: -3, voiceQ: 0.8, asym: 0.05, cabLp: 6500, tight: 0 },
  chime: { label: 'British chime (Vox-style)', voiceHz: 1500, voiceDb: 3, voiceQ: 1, asym: 0.25, cabLp: 7000, tight: 0 },
  crunch: { label: 'British crunch (Marshall-style)', voiceHz: 800, voiceDb: 3, voiceQ: 0.9, asym: 0.15, cabLp: 5200, tight: 20 },
  highgain: { label: 'Modern high gain (Mesa-style)', voiceHz: 650, voiceDb: -4, voiceQ: 0.7, asym: 0.1, cabLp: 5000, tight: 60 },
  fuzz: { label: 'Fuzz', voiceHz: 1000, voiceDb: -5, voiceQ: 0.6, asym: 0.6, cabLp: 4500, tight: -20 },
  acoustic: { label: 'Acoustic / DI', voiceHz: 2500, voiceDb: 2, voiceQ: 0.7, asym: 0, cabLp: 9000, tight: 30 },
  bass: { label: 'Bass amp (SVT-style)', voiceHz: 500, voiceDb: -4, voiceQ: 0.7, asym: 0.1, cabLp: 3000, tight: -90 },
}

/** The model a tone uses; older saved tones without one get a sensible default from their gain. */
export const modelOf = (t: Tone): AmpModel => t.model ?? (!t.cab ? 'acoustic' : t.gain < 2.5 ? 'clean' : t.gain < 7.5 ? 'crunch' : 'highgain')

export interface Tone {
  name: string
  gain: number // 0–10 preamp drive
  bass: number // -12..12 dB
  mid: number
  treble: number
  presence: number
  level: number // 0–10 output
  reverb: number // 0–10
  delay: number // 0–10 mix
  delayMs: number
  gate: number // 0–10, 0 = off
  cab: boolean
  model?: AmpModel
  chorus?: number // 0–10 mix
  octave?: number // 0–10: octave-down mix; at 10 only the octave sounds (guitar as a bass)
}

export const PRESETS: Tone[] = [
  { name: 'Clean', gain: 1.2, bass: 2, mid: 0, treble: 3, presence: 2, level: 6, reverb: 3, delay: 0, delayMs: 380, gate: 0, cab: true, model: 'clean' },
  { name: 'Jazz clean', gain: 0.8, bass: 4, mid: 1, treble: -3, presence: -2, level: 6, reverb: 2, delay: 0, delayMs: 380, gate: 0, cab: true, model: 'clean' },
  { name: 'Acoustic-ish', gain: 0.5, bass: -2, mid: -3, treble: 5, presence: 5, level: 9, reverb: 3, delay: 0, delayMs: 380, gate: 0, cab: false, model: 'acoustic' },
  { name: 'Blues crunch', gain: 4.5, bass: 1, mid: 3, treble: 1, presence: 1, level: 5.5, reverb: 2.5, delay: 0, delayMs: 380, gate: 1, cab: true, model: 'crunch' },
  { name: 'Classic rock', gain: 6, bass: 2, mid: 4, treble: 2, presence: 2, level: 5, reverb: 2, delay: 1, delayMs: 340, gate: 2, cab: true, model: 'crunch' },
  { name: 'Lead', gain: 7.5, bass: 2, mid: 5, treble: 2, presence: 3, level: 4.3, reverb: 3, delay: 3, delayMs: 420, gate: 3, cab: true, model: 'crunch' },
  { name: 'Modern metal', gain: 9, bass: 4, mid: -3, treble: 3, presence: 4, level: 4.5, reverb: 1, delay: 0, delayMs: 380, gate: 5, cab: true, model: 'highgain' },
  { name: 'Ambient', gain: 1.5, bass: 0, mid: 0, treble: 2, presence: 3, level: 5.5, reverb: 7, delay: 5, delayMs: 480, gate: 0, cab: true, model: 'clean', chorus: 4 },
  // The guitar an octave down through a bass amp: play the bass line on the low strings.
  { name: 'Bass guitar', gain: 1.5, bass: 6, mid: 0, treble: -4, presence: -6, level: 6.5, reverb: 0, delay: 0, delayMs: 380, gate: 1.5, cab: false, model: 'bass', octave: 10 },
]

export const presetByName = (name: string) => PRESETS.find((p) => p.name === name) ?? PRESETS[0]

// General MIDI guitar programs written into Guitar Pro tracks.
const PROGRAM_PRESET: Record<number, string> = {
  24: 'Acoustic-ish', // nylon
  25: 'Acoustic-ish', // steel
  26: 'Jazz clean',
  27: 'Clean',
  28: 'Blues crunch', // muted
  29: 'Classic rock', // overdriven
  30: 'Modern metal', // distortion
  31: 'Lead', // harmonics
}

const ARTIST_PRESET: [RegExp, string][] = [
  [/metallica|megadeth|slayer|pantera|slipknot|system of a down|korn|lamb of god|gojira|meshuggah|trivium|avenged|disturbed|rammstein|sepultura|machine head|bullet for my|tool\b|periphery|architects|bring me the horizon/i, 'Modern metal'],
  [/ac\/?dc|led zeppelin|guns n|deep purple|black sabbath|kiss\b|van halen|aerosmith|nirvana|foo fighters|queen|the who|rolling stones|white stripes|arctic monkeys|red hot chili|rhcp|green day|offspring|iron maiden|judas priest|motörhead|motorhead|ozzy|scorpions|def leppard|bon jovi/i, 'Classic rock'],
  [/hendrix|srv|stevie ray|b\.?b\.? king|clapton|gary moore|joe bonamassa|john mayer|cream|albert king|freddie king|buddy guy/i, 'Blues crunch'],
  [/pink floyd|gilmour|satriani|vai\b|slash|santana|dire straits|knopfler|eagles/i, 'Lead'],
  [/wes montgomery|joe pass|pat metheny|george benson|jazz/i, 'Jazz clean'],
  [/ed sheeran|oasis|eagle eye|simon|garfunkel|beatles|bob dylan|johnny cash|tracy chapman|jack johnson|james taylor|neil young|radiohead|coldplay|acoustic/i, 'Acoustic-ish'],
  [/u2|the edge|explosions in the sky|sigur|mogwai|post-rock/i, 'Ambient'],
]

/** Suggests a tone from the GP track's instrument and the song's metadata. */
export function suggestTone(meta: { artist?: string; title?: string; trackName?: string; program?: number }): Tone {
  const text = `${meta.artist ?? ''} ${meta.title ?? ''}`
  const track = meta.trackName ?? ''
  if (/acoustic|nylon|classical/i.test(track)) return presetByName('Acoustic-ish')
  if (/lead|solo/i.test(track) && meta.program !== 25 && meta.program !== 24) return presetByName('Lead')
  if (/clean/i.test(track)) return presetByName('Clean')
  if (/dist|heavy|rhythm/i.test(track) && meta.program === 30) return presetByName('Modern metal')
  for (const [re, name] of ARTIST_PRESET) {
    if (re.test(text)) {
      // Artist says "metal" but the track is a clean intro: trust the instrument.
      if (meta.program !== undefined && meta.program <= 27 && name !== 'Acoustic-ish') return presetByName(PROGRAM_PRESET[meta.program] ?? 'Clean')
      return presetByName(name)
    }
  }
  if (meta.program !== undefined && PROGRAM_PRESET[meta.program]) return presetByName(PROGRAM_PRESET[meta.program])
  return presetByName('Clean')
}

const songKey = (artist: string, title: string) => `tone:${artist.toLowerCase()}|${title.toLowerCase()}`

export function loadSongTone(artist: string, title: string): Tone | null {
  try {
    const raw = localStorage.getItem(songKey(artist, title))
    return raw ? (JSON.parse(raw) as Tone) : null
  } catch {
    return null
  }
}

export function saveSongTone(artist: string, title: string, tone: Tone) {
  try {
    localStorage.setItem(songKey(artist, title), JSON.stringify(tone))
  } catch {
    /* storage unavailable */
  }
}
