import type { Lesson, StageDef } from './types'
import { STANDARD_TUNING, parseChord, pc } from '../music/theory'
import { seq, seqBeats } from './seq'
import { buildChart } from './charts'
import { validateFingering } from './fingering'

const LICK_A = '5.5 4.8 4.5 3.7 3.5*2 2.7*6 - - - -' // 2 bars of 8ths, lands on A at beat offset 3 (beat 4)
const LICK_B = '2.5 2.7 3.5 3.7 4.5 4.8 5.5*6 - - - -'
const POWER = { G5: [3, 5, 5, -1, -1, -1], A5: [5, 7, 7, -1, -1, -1], C5: [8, 10, 10, -1, -1, -1], D5: [-1, 5, 7, 7, -1, -1] }
const E5 = [0, 2, 2, -1, -1, -1]
const A5o = [-1, 0, 2, 2, -1, -1]
const AM_TOP = [-1, -1, -1, 5, 5, 5] // C E A on the top three strings
const D_TOP = [-1, -1, -1, 7, 7, 5] // D F# A
// Which band parts play. Keys only where the chord helps the ear (pitch, bends, a melody).
const DRUMS = { drums: true }
const GROOVE = { drums: true, bass: true }
const FULL = { drums: true, bass: true, keys: true }
const bars = (chord: string, strum: string, n: number, frets?: number[]) => Array.from({ length: n }, () => ({ chord, strum, frets }))

/** Old lesson id -> new id. Empty: no lesson was removed or renamed. */
export const LEGACY_IDS: Record<string, string> = {}

/** The 12-bar blues in A and in E, one chord per bar. */
export const TWELVE_A7 = ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7']
export const TWELVE_E7 = ['E7', 'E7', 'E7', 'E7', 'A7', 'A7', 'E7', 'E7', 'B7', 'A7', 'E7', 'B7']
// Boogie pairs on the low strings: the open root plus the next string at fret 2 (fifth) or 4 (sixth)
const BOOGIE = {
  A5: [-1, 0, 2, -1, -1, -1], A6: [-1, 0, 4, -1, -1, -1],
  D5: [-1, -1, 0, 2, -1, -1], D6: [-1, -1, 0, 4, -1, -1],
  E5: [0, 2, -1, -1, -1, -1], E6: [0, 4, -1, -1, -1, -1],
}
const boogieBar = (r: string) => `[${r}5] [${r}5] [${r}6] [${r}6] [${r}5] [${r}5] [${r}6] [${r}6]`
const OPEN = { A: [-1, 0, 2, 2, 2, 0], D: [-1, -1, 0, 2, 3, 2], E: [0, 2, 2, 1, 0, 0] }
const SEVENTH: Record<string, number[]> = { A7: [-1, 0, 2, 0, 2, 0], D7: [-1, -1, 0, 2, 1, 2], E7: [0, 2, 0, 1, 0, 0] }
// Three generic blues licks in A minor pentatonic box 1 (original, public-domain style vocabulary, one bar each)
const LICK_1 = '3.7^2*2 4.5 3.7 3.5 2.7*3' // bend D up to E, then E D C, home on A
const LICK_2 = '2.5 h2.7 3.5 2.7 1.7 1.5 0.5*2' // hammer G to A, down to the low A
const LICK_3 = '4.8 4.5 3.7 3.5 2.7~*4' // G E D C, then A with vibrato
const REST_BAR = '- - - - - - - -'
// Jam library weights: chord-tone targets first, then the scale, phrases and space
const SHUFFLE_WEIGHTS = { targets: 30, inScale: 25, phrases: 20, space: 25 }
const ROCK_A = { A5: [5, 7, 7, -1, -1, -1], D5: [-1, 5, 7, 7, -1, -1], E5 }
const ROCK_E = { E5, A5: A5o, B5: [-1, 2, 4, 4, -1, -1] }
const rockBars = (chords: string[], shapes: Record<string, number[]>) =>
  chords.map((chord, i) => ({ chord, frets: shapes[chord], strum: i === chords.length - 1 ? 'D_______' : 'DDDDDDDD' }))

/**
 * The map: one stage per fortnight of the 12-week plan (research section 5), then an Extras area.
 * core = the plan's lessons in teaching order, the checkpoint last; extra = optional, never blocks anything.
 */
export const STAGES: StageDef[] = [
  // Muting is taught inside Power Pair and Downstroke Lock; Stop the Ring stays optional so the boogie lands in week 2.
  { id: 1, weeks: [1, 2], title: 'Time and power chords', skill: 'A light fretting hand, downstrokes with the band, muted power chords and the boogie shuffle',
    core: ['w1-01', 'w1-05', 'w4-01', 'w3-06', 'w3-07'],
    extra: ['w1-02', 'w1-03', 'w2-01', 'w3-02', 'w1-04', 'w2-05', 'w8-01'] },
  { id: 2, weeks: [3, 4], title: 'Open chords and the low E string', skill: 'Open A, D, E, then A7, D7, E7; 8th strumming; notes and roots on the low strings',
    core: ['w3-09', 'w2-06', 'w2-03', 'w3-10'],
    extra: ['w3-01'] },
  { id: 3, weeks: [5, 6], title: 'Box 1, blues licks, call and response', skill: 'A minor pentatonic box 1, short melodies copied by ear, three blues licks',
    core: ['w5-01', 'w5-11', 'w7-02', 'w5-07'],
    extra: ['w5-02', 'w5-03', 'w5-04', 'w7-01', 'w7-03', 'w8-02', 'w5-06'] },
  { id: 4, weeks: [7, 8], title: 'Bends, slides, vibrato; G, C, Em', skill: 'Hammer-ons, slides, bends in tune, vibrato; G, C and Em; notes on the A string; licks echoed by ear',
    core: ['w6-01', 'w6-02', 'w6-03', 'w6-04', 'w3-05', 'w2-07', 'w7-05', 'w6-05'],
    extra: ['w3-04', 'w7-04'], encore: 'w7-04' },
  { id: 5, weeks: [9, 10], title: 'A major box, chord tones, blues in E', skill: 'A major pentatonic, box 2, landing on the chord when it changes, the shuffle in E',
    core: ['w5-08', 'w5-09', 'w8-06', 'w8-07', 'w8-10', 'w8-03'],
    extra: ['w4-02', 'w4-05', 'w4-06', 'w8-04'] },
  { id: 6, weeks: [11, 12], title: 'A rock song and a 12-bar jam', skill: 'Rock in E, slow and minor blues, three choruses without stopping',
    core: ['w8-11', 'w8-08', 'w8-09', 'w8-12'],
    extra: ['w4-03', 'w4-04', 'w8-05'], encore: 'w8-05' },
  { id: 7, weeks: null, title: 'Extras', skill: 'Whenever you like: melodies on one string, and reggae',
    core: [],
    extra: ['w2-02', 'w2-04', 'w3-03'] },
]

export const LESSONS: Lesson[] = [
  // ---- Family 1: first sparks ----
  { id: 'w1-01', world: 1, order: 1, title: 'Tap In', goal: "Let Fretwise learn your setup's delay.", type: 'sync',
    bpm: 80, bars: 2, timing: 'easy', tone: 'Clean', pass: 0, stars: [0, 0, 0], xp: 30,
    tips: ['Pluck the open A string right on each click.', "Play with the click, don't chase it.",
      "Use headphones so the click doesn't leak into your guitar input.", 'Run this again if you change your audio interface or settings.'] },
  { id: 'w1-02', world: 1, order: 2, title: 'String Roll Call', goal: 'Find all six open strings by ear and feel.', type: 'notes',
    bpm: 70, bars: 6, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['Em'], parts: GROOVE, level: 0.55 },
    seq: '0.0 1.0 2.0 3.0 4.0 5.0 4.0 3.0 2.0 1.0 0.0*2', step: 2,
    pass: 60, stars: [60, 80, 95], xp: 40,
    tips: ['No fretting needed. Just find each string.', 'Low to high: E A D G B E.', 'Let each one ring until the next.'] },
  { id: 'w1-03', world: 1, order: 3, title: 'Stop the Ring', goal: 'Play a note, then silence it on purpose.', type: 'notes',
    bpm: 70, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['A5'], parts: DRUMS, level: 0.5 },
    seq: '1.0 r 1.0 r | 1.0 r 1.0 r | 1.0 r 1.0 r | 1.0 r 1.0 r', step: 1,
    pass: 60, stars: [60, 80, 95], xp: 40,
    tips: ['On electric, strings keep ringing. Muting is half of sounding clean.',
      'Stop a note by touching it lightly with your fretting fingers or the side of your picking hand.', 'Silence counts as a note here.'] },
  { id: 'w1-05', world: 1, order: 4, title: 'Light Touch', goal: 'Fret notes with just enough pressure, and let them ring.', type: 'notes', position: 2,
    bpm: 60, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['A5'], parts: GROOVE, level: 0.5 },
    seq: '1.2*2 1.3*2 | 1.4*2 1.5*2 | 1.4*2 1.3*2 | 1.2*4', step: 1,
    pass: 60, stars: [60, 80, 95], xp: 40,
    tips: ['Press until the note buzzes, then add just enough to clear the buzz. No more.',
      'Thumb relaxed behind the neck. If your hand aches, you are squeezing.', 'Let each note ring for its full two beats.'] },
  { id: 'w1-04', world: 1, order: 5, title: 'Spark Show', goal: 'Open strings, muting and your first fretted notes together.', type: 'notes',
    bpm: 80, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['E5', 'E5', 'A5', 'A5'], parts: GROOVE, level: 0.6 },
    seq: '0.0 r 1.0 r | 2.0 r 3.0 r | 4.5 4.5 5.5 5.5 | 4.5 r 5.5*2', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 100,
    tips: ['Fretted notes: press just behind the 5th fret wire, not on top of it.', 'Pick down on every beat. Let the pick swing back up between notes.'] },

  // ---- Family 2: fret finder ----
  { id: 'w2-01', world: 2, order: 1, title: 'Spider Walk', goal: 'One finger per fret, clean notes.', type: 'notes',
    bpm: 60, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['A5'], parts: DRUMS, level: 0.55 },
    seq: '0.5 0.6 0.7 0.8 | 1.5 1.6 1.7 1.8 | 2.5 2.6 2.7 2.8 | 3.5 3.6 3.7 3.8', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 50,
    tips: ['Index on 5, middle 6, ring 7, pinky 8.', 'Keep your fingers hovering close to the strings.', 'Thumb behind the neck for this one.'] },
  { id: 'w2-02', world: 2, order: 2, title: 'One-String Song', goal: 'Play a melody by moving along one string.', type: 'notes',
    bpm: 80, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['C', 'G', 'C', 'G'], parts: FULL, level: 0.65 },
    seq: '4.5 4.5 4.6 4.8 | 4.8 4.6 4.5 4.3 | 4.1 4.1 4.3 4.5 | 4.5*1.5 4.3*0.5 4.3*2', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 50,
    tips: ['All on the B string. Frets 1=C 3=D 5=E 6=F 8=G.', 'If it sounds off, check the fret before speeding up.', 'This is "Ode to Joy" by Beethoven.'] },
  { id: 'w2-03', world: 2, order: 3, title: 'Octave Hunter', goal: 'Learn the octave shape. It finds any root on the neck.', type: 'notes',
    bpm: 80, bars: 5, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['A5', 'C5', 'G5', 'C5', 'D5'], parts: GROOVE, level: 0.65 },
    seq: '0.5@1*2 2.7*2 | 0.8@1*2 2.10*2 | 0.3@1*2 2.5*2 | 1.3@1*2 3.5*2 | 1.5@1*2 3.7*2', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 60,
    tips: ['Octave shape: two strings up, two frets up.', 'Mute the string in between with the underside of your index finger.',
      "You'll use this to find the home note in every jam."] },
  { id: 'w2-05', world: 2, order: 4, title: 'First Jam', goal: 'Your first freestyle: two notes, your rhythm, a real band.', type: 'improv',
    bpm: 80, bars: 8, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['Am', 'F'], level: 0.75 },
    improv: { key: 9, scale: null, allowedPcs: [9, 0], boxFret: 5, minNotes: 6, weights: { inScale: 50, phrases: 25, space: 25 } },
    pass: 50, stars: [50, 70, 88], xp: 60,
    tips: ['Only two notes: A and C. Play them in any rhythm you like.', 'A: the open A string, low E fret 5 or D string fret 7. C: G string fret 5 or low E fret 8.',
      'Play a little, rest a little. There are no wrong rhythms here.'] },
  { id: 'w2-06', world: 2, order: 5, title: 'Low E Names', goal: 'Learn the natural notes on the low E string.', type: 'notes',
    bpm: 60, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['Em'], parts: GROOVE, level: 0.6 },
    seq: '0.0 0.1 0.3 0.5 | 0.7 0.8 0.10 0.12 | 0.12 0.10 0.8 0.7 | 0.5 0.3 0.1 0.0', step: 1,
    pass: 60, stars: [60, 80, 95], xp: 50,
    tips: ['Natural notes on the low E string: E F G A B C D, then E again at fret 12.', 'Say each name out loud as you play it.',
      'Shift the whole hand, and look ahead to the next fret.'] },
  { id: 'w2-07', world: 2, order: 6, title: 'A String Names', goal: 'Learn the natural notes on the A string.', type: 'notes',
    bpm: 60, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['Am'], parts: GROOVE, level: 0.6 },
    seq: '1.0 1.2 1.3 1.5 | 1.7 1.8 1.10 1.12 | 1.12 1.10 1.8 1.7 | 1.5 1.3 1.2 1.0', step: 1,
    pass: 60, stars: [60, 80, 95], xp: 50,
    tips: ['Natural notes on the A string: A B C D E F G, then A at fret 12.', 'B to C and E to F are one fret apart. The others are two frets apart.',
      'Say each name as you play it.'] },
  { id: 'w2-04', world: 2, order: 7, title: 'Full Ode', goal: 'A whole melody, accurate and steady.', type: 'notes',
    bpm: 90, bars: 8, timing: 'normal', tone: 'Clean', backing: { feel: 'pop', chords: ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'C'], parts: FULL, level: 0.75 },
    seq: '4.5 4.5 4.6 4.8 | 4.8 4.6 4.5 4.3 | 4.1 4.1 4.3 4.5 | 4.5*1.5 4.3*0.5 4.3*2 | 4.5 4.5 4.6 4.8 | 4.8 4.6 4.5 4.3 | 4.1 4.1 4.3 4.5 | 4.3*1.5 4.1*0.5 4.1*2', step: 1,
    pass: 70, stars: [70, 85, 95], xp: 120,
    tips: ['Phrase two ends differently. Listen for it.', 'Relax. Tension makes you rush.'] },

  // ---- Family 3: strum stomp ----
  { id: 'w3-01', world: 3, order: 1, title: 'Strum Engine', goal: 'A pendulum strumming hand: downs, then down-ups.', type: 'chords',
    bpm: 80, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['Em'], parts: GROOVE, level: 0.7 },
    chordBars: [...bars('Em', 'D_D_D_D_', 2), ...bars('Em', 'DUDUDUDU', 2)],
    pass: 65, stars: [65, 80, 92], xp: 50,
    tips: ['Your hand swings down-up like a pendulum, even when it only hits going down.', 'Upstrums: just the top 3–4 strings, lighter.', 'Loose wrist.'] },
  { id: 'w3-02', world: 3, order: 2, title: 'Backbeat Scratch', goal: 'Muted "chk" hits on 2 and 4, the guitar\'s snare drum.', type: 'rhythm',
    bpm: 80, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['E5'], parts: GROOVE, level: 0.7 },
    chordBars: [...bars('E5', 'D_x_D_x_', 2, E5), ...bars('E5', 'D_xUD_xU', 2, E5)],
    pass: 65, stars: [65, 80, 92], xp: 50,
    tips: ['E5: the open low E, plus the A and D strings at fret 2. Strum only those three.', 'For x: release the pressure and lay your fretting hand lightly across all six strings, then strum the same way.',
      'The scratch lands on 2 and 4.'] },
  { id: 'w3-06', world: 3, order: 3, title: 'Downstroke Lock', goal: 'Downstrokes in time with the band: A5, D5 and E5.', type: 'chords', pickRule: 'down',
    bpm: 70, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['A5', 'A5', 'D5', 'E5'], parts: GROOVE, level: 0.75 },
    chordBars: [{ chord: 'A5', frets: [-1, 0, 2, 2, -1, -1], strum: 'D_D_D_D_' }, { chord: 'A5', frets: [-1, 0, 2, 2, -1, -1], strum: 'DDDDDDDD' },
      { chord: 'D5', frets: [-1, -1, 0, 2, 3, -1], strum: 'DDDDDDDD' }, { chord: 'E5', frets: [0, 2, 2, -1, -1, -1], strum: 'DDDDDDDD' }],
    pass: 65, stars: [65, 80, 92], xp: 50,
    tips: ['Downstrokes only, small and even, locked to the kick and snare.',
      'A5: open A string plus the D and G strings at fret 2. D5: open D string, G string fret 2, B string fret 3. E5: open low E, A and D strings at fret 2.',
      'Rest the side of your picking hand lightly on the strings you skip.'] },
  { id: 'w3-07', world: 3, order: 4, boss: true, title: 'Boogie Shuffle in A', goal: 'The A5–A6 boogie: a full 12-bar shuffle rhythm in A.', type: 'notes', dyad: true, pickRule: 'down',
    bpm: 60, bars: 12, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'blues', chords: TWELVE_A7, parts: GROOVE, level: 0.7 }, shapes: BOOGIE,
    seq: ['A', 'A', 'A', 'A', 'D', 'D', 'A', 'A', 'E', 'D', 'A', 'E'].map(boogieBar).join(' | '), step: 0.5,
    pass: 65, stars: [65, 80, 92], xp: 90,
    tips: ['Two strings only: the open root string plus the next string at fret 2, then stretch to fret 4 and back.',
      'Long-short, long-short: that is the shuffle. Let the drums lead.',
      'In A: the A string. On D: the D string. On E: the low E string. Same shape each time.',
      'Rest your picking hand lightly on the strings to keep the others quiet.'] },
  { id: 'w3-03', world: 3, order: 5, title: 'Reggae Chop', goal: 'Short chords only on 2 and 4, with silence in between.', type: 'rhythm',
    bpm: 80, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'reggae', chords: ['Am', 'D', 'Am', 'D'] },
    chordBars: [{ chord: 'Am', frets: AM_TOP, strum: 'r_D_r_D_' }, { chord: 'D', frets: D_TOP, strum: 'r_D_r_D_' },
      { chord: 'Am', frets: AM_TOP, strum: 'r_D_r_D_' }, { chord: 'D', frets: D_TOP, strum: 'r_D_r_D_' }],
    pass: 65, stars: [65, 80, 92], xp: 60,
    tips: ['Am: lay your index across the top three strings at fret 5. D: index on high e fret 5, ring and pinky on fret 7.', 'Hit on 2 and 4 only.',
      "Right after the hit, ease off the pressure to choke it. Think 'chk', not 'strummm'."] },
  { id: 'w3-05', world: 3, order: 6, title: 'Open Chord Swap', goal: 'Learn the open G, C and Em chords, and change between them in time.', type: 'chords',
    bpm: 70, bars: 8, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['G', 'G', 'C', 'C', 'Em', 'Em', 'G', 'G'], parts: GROOVE, level: 0.7 },
    chordBars: [...bars('G', 'D_D_D_D_', 2), ...bars('C', 'D_D_D_D_', 2), ...bars('Em', 'D_D_D_D_', 2), ...bars('G', 'D_D_D_D_', 2)],
    pass: 65, stars: [65, 80, 92], xp: 60,
    tips: ['G: middle finger on low E fret 3, index on A string fret 2, ring on high e fret 3. The middle strings ring open.',
      'C: ring on A string fret 3, middle on D string fret 2, index on B string fret 1. Skip the low E.',
      'Em: middle on A string fret 2, ring on D string fret 2. All six strings ring.',
      'Start moving to the next chord on beat 4. Landing on time beats landing perfect.'] },
  { id: 'w3-09', world: 3, order: 7, title: 'Open A, D, E', goal: 'Learn the open A, D and E chords, and strum 8ths.', type: 'chords',
    bpm: 70, bars: 8, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['A', 'A', 'D', 'D', 'E', 'E', 'A', 'A'], parts: GROOVE, level: 0.7 },
    chordBars: [...bars('A', 'D_D_D_D_', 2, OPEN.A), ...bars('D', 'D_D_D_D_', 2, OPEN.D), ...bars('E', 'D_DUD_DU', 2, OPEN.E), ...bars('A', 'D_DUD_DU', 2, OPEN.A)],
    pass: 65, stars: [65, 80, 92], xp: 60,
    tips: ['A: index, middle and ring in a row at fret 2 on the D, G and B strings. Skip the low E.',
      'D: index on the G string fret 2, ring on the B string fret 3, middle on the high e fret 2. Top four strings only.',
      'E: middle on the A string fret 2, ring on the D string fret 2, index on the G string fret 1. All six strings.',
      'Move on beat 4. Landing on time beats landing perfect.'] },
  { id: 'w3-10', world: 3, order: 8, boss: true, title: 'Seventh Shuffle', goal: 'A7, D7 and E7 through a 12-bar shuffle.', type: 'chords',
    bpm: 70, bars: 12, timing: 'easy', tone: 'Clean', backing: { feel: 'blues', chords: TWELVE_A7 },
    chordBars: TWELVE_A7.map((c) => ({ chord: c, frets: SEVENTH[c], strum: 'D_DUD_DU' })),
    pass: 65, stars: [65, 80, 92], xp: 80,
    tips: ['A7: like A, but lift the finger off the G string so it rings open.', 'D7: index on the B string fret 1, middle on the G string fret 2, ring on the high e fret 2.',
      'E7: like E, but lift the finger off the D string.', 'Shuffle strum: the down is long, the up is short. Swing it.'] },
  { id: 'w3-04', world: 3, order: 9, title: 'Groove Gauntlet', goal: 'A full strum pattern through chord changes, with the band.', type: 'chords',
    bpm: 85, bars: 8, timing: 'normal', tone: 'Clean', backing: { feel: 'pop', chords: ['G', 'D', 'Em', 'C'] },
    chordBars: ['G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C'].map((chord) => ({ chord, strum: 'D_DU_UDU' })),
    pass: 70, stars: [70, 85, 95], xp: 120,
    tips: ['Down, down-up, up-down-up. Say it out loud.', 'Same G, C and Em shapes as Open Chord Swap, plus the open D.', 'Change chords during the last up-strum. Open strings there are fine.', 'Never stop the hand.'] },

  // ---- Family 4: power stomp ----
  { id: 'w4-01', world: 4, order: 1, title: 'Power Pair', goal: 'Two-finger power chords, with the other strings muted.', type: 'chords',
    bpm: 80, bars: 4, timing: 'easy', tone: 'Classic rock', backing: { feel: 'pop', chords: ['E5', 'A5', 'E5', 'A5'], parts: GROOVE, level: 0.8 },
    chordBars: [{ chord: 'E5', frets: E5, strum: 'D_D_D_D_' }, { chord: 'A5', frets: A5o, strum: 'D_D_D_D_' }, { chord: 'E5', frets: E5, strum: 'D_D_D_D_' }, { chord: 'A5', frets: A5o, strum: 'D_D_D_D_' }],
    pass: 65, stars: [65, 80, 92], xp: 60,
    tips: ['E5: middle and ring on fret 2, like Em. Let your fingers touch the other strings lightly to mute them.', 'With gain on, keep strums small and controlled.', 'Same shape, one string over.'] },
  { id: 'w4-02', world: 4, order: 2, title: 'Power Moves', goal: 'Slide one frozen shape around the neck.', type: 'chords',
    bpm: 85, bars: 4, timing: 'easy', tone: 'Classic rock', backing: { feel: 'pop', chords: ['G5', 'A5', 'C5', 'D5'], parts: GROOVE, level: 0.8 },
    chordBars: [{ chord: 'G5', frets: POWER.G5, strum: 'D_D_D_D_' }, { chord: 'A5', frets: POWER.A5, strum: 'D_D_D_D_' },
      { chord: 'C5', frets: POWER.C5, strum: 'DDDDDDDD' }, { chord: 'D5', frets: POWER.D5, strum: 'DDDDDDDD' }],
    pass: 65, stars: [65, 80, 92], xp: 60,
    tips: ['Index on the root, ring and pinky on the two notes two frets up. Freeze the shape and move the whole hand.', "Ease off the pressure (don't let go) while moving.", 'Root on low E: 3=G 5=A 8=C. Root on the A string: 5=D.'] },
  { id: 'w4-03', world: 4, order: 3, title: 'Chug & Riff', goal: 'Palm-muted chugs, then a single-note riff.', type: 'notes', pickRule: 'down',
    bpm: 90, bars: 4, timing: 'easy', tone: 'Classic rock', backing: { feel: 'pop', chords: ['E5'], parts: GROOVE, level: 0.8 },
    seq: '0.0 0.0P 0.0P 0.0P 0.0 0.0P 0.0P 0.0P | 0.0 0.0P 0.0P 0.0P 0.0 0.0P 0.0 0.0 | 0.0 0.0 0.3@1 0.0 0.5@3 0.0 0.3@1 0.0 | 0.0 0.0 0.3@1 0.0 1.2@1 - 1.0 -', step: 0.5,
    pass: 65, stars: [65, 80, 92], starExtra: { kind: 'palmMute', share: 0.6 }, xp: 70,
    tips: ['Palm mute: rest the edge of your picking hand where the strings leave the bridge.', 'Too far forward and the note dies. Too far back and it rings.', 'The riff uses only E minor pentatonic notes.'] },
  { id: 'w4-05', world: 4, order: 4, title: 'Three-Chord Rock in A', goal: 'I, IV and V in A: the three chords behind most rock and blues.', type: 'chords', pickRule: 'down',
    bpm: 80, bars: 8, timing: 'easy', tone: 'Classic rock', backing: { feel: 'pop', chords: ['A5', 'A5', 'D5', 'D5', 'E5', 'E5', 'A5', 'A5'], parts: GROOVE, level: 0.8 },
    chordBars: rockBars(['A5', 'A5', 'D5', 'D5', 'E5', 'E5', 'A5', 'A5'], ROCK_A),
    pass: 65, stars: [65, 80, 92], xp: 70,
    tips: ['A5 at fret 5 on the low E string, D5 at fret 5 on the A string, E5 open. Small moves.', 'Steady 8th-note downstrokes.',
      'Ease off the pressure between chords to stop the ring.'] },
  { id: 'w4-06', world: 4, order: 5, title: 'Three-Chord Rock in E', goal: 'I, IV and V in E: E5, A5 and B5.', type: 'chords', pickRule: 'down',
    bpm: 85, bars: 8, timing: 'easy', tone: 'Classic rock', backing: { feel: 'pop', chords: ['E5', 'E5', 'A5', 'A5', 'B5', 'B5', 'E5', 'E5'], parts: GROOVE, level: 0.8 },
    chordBars: rockBars(['E5', 'E5', 'A5', 'A5', 'B5', 'B5', 'E5', 'E5'], ROCK_E),
    pass: 65, stars: [65, 80, 92], xp: 70,
    tips: ['B5: index on the A string fret 2, ring and pinky at fret 4 on the D and G strings.', 'Keep the 8ths even, then let the last chord ring.'] },
  { id: 'w4-04', world: 4, order: 6, title: 'Stomp Session', goal: 'Riff, then power chords, locked to the drums.', type: 'notes', pickRule: 'down',
    bpm: 95, bars: 8, timing: 'normal', tone: 'Classic rock', backing: { feel: 'pop', chords: ['E5', 'E5', 'E5', 'E5', 'G5', 'A5', 'C5', 'D5'] }, shapes: POWER,
    seq: '0.0 0.0 0.3@1 0.0 0.5@3 0.0 0.3@1 0.0 | 0.0 0.0 0.3@1 0.0 1.2@1 - 1.0 - | 0.0 0.0 0.3@1 0.0 0.5@3 0.0 0.3@1 0.0 | 0.0 0.0 0.3@1 0.0 1.2@1 - 1.0 - | ' +
      '[G5] - [G5] [G5] - [G5] [G5] [G5] | [A5] - [A5] [A5] - [A5] [A5] [A5] | [C5] - [C5] [C5] - [C5] [C5] [C5] | [D5] - [D5] [D5] - [D5] [D5]*2', step: 0.5,
    pass: 70, stars: [70, 85, 95], xp: 150,
    tips: ['Get the G5 shape ready during the last eighth of bar 4.', 'Lock in with the kick drum.'] },

  // ---- Family 5: pentatonic playground ----
  { id: 'w5-01', world: 5, order: 1, title: 'Meet the Box', goal: 'Play the 12-note box up and down.', type: 'notes', position: 5,
    bpm: 70, bars: 6, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['Am'], parts: GROOVE, level: 0.75 },
    seq: '0.5 0.8 1.5 1.7 2.5 2.7 3.5 3.7 4.5 4.8 5.5 5.8 | 5.5 4.8 4.5 3.7 3.5 2.7 2.5 1.7 1.5 0.8 0.5*2', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 60,
    tips: ['Two notes per string: index on 5, ring on 7, pinky on 8.', 'The highlighted dots are A, home.', 'The notes: A C D E G.'] },
  { id: 'w5-11', world: 5, order: 2, title: 'Box in Eighths', goal: 'Box 1 up and down in 8th notes.', type: 'notes', position: 5,
    bpm: 70, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['Am'], parts: GROOVE, level: 0.75 },
    seq: '0.5 0.8 1.5 1.7 2.5 2.7 3.5 3.7 | 4.5 4.8 5.5 5.8 5.5 4.8 4.5 3.7 | 3.5 2.7 2.5 1.7 1.5 0.8 0.5*2 | - - - - - - - -', step: 0.5,
    pass: 65, stars: [65, 82, 95], xp: 70,
    tips: ['Two notes per click. Count "1 and 2 and".', 'Alternate picking: down, up, down, up.', 'Accuracy first. The tempo goes up only after clean runs.'] },
  { id: 'w5-02', world: 5, order: 3, title: 'Home Base', goal: 'Find the roots (A) and the safe fifth (E) over the band.', type: 'notes', position: 5,
    bpm: 75, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['Am'] },
    seq: '0.5*2 2.7*2 | 5.5*2 2.7*2 | 1.7*2 4.5*2 | 2.7*4', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 60,
    tips: ['A is home. Every jam can end here.', 'E fits too: a safe neighbour.',
      'The two lower A notes are your octave shape again. The high A is on the high e string, fret 5.'] },
  { id: 'w5-03', world: 5, order: 4, title: 'Threes', goal: 'A scale sequence for finger independence.', type: 'notes', position: 5,
    bpm: 70, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['Am'], parts: GROOVE, level: 0.75 },
    seq: '0.5 0.8 1.5  0.8 1.5 1.7  1.5 1.7 2.5  1.7 2.5 2.7  2.5 2.7 3.5  2.7 3.5 3.7  3.5 3.7 4.5  3.7 4.5 4.8  4.5 4.8 5.5  4.8 5.5 5.8*2 -', step: 0.5,
    pass: 65, stars: [65, 82, 95], xp: 70,
    tips: ['Up two, back one. Accuracy before speed.', 'Keep the 8ths even and count "1 & 2 &". The groups of three run across the beat, and that is fine.',
      'Alternate picking: down-up-down, up-down-up.'] },
  { id: 'w5-04', world: 5, order: 5, title: 'Two Licks', goal: 'Learn two vocabulary licks that both end on A.', type: 'notes', position: 5,
    bpm: 85, bars: 8, timing: 'normal', tone: 'Clean', backing: { feel: 'pop', chords: ['Am', 'F'] },
    seq: `${LICK_A} ${LICK_B} ${LICK_A} ${LICK_B}`, step: 0.5,
    pass: 70, stars: [70, 85, 95], xp: 80,
    tips: ["Licks are words. You'll reuse these in your jams.", 'Both land on A, a strong ending over Am and F.', 'Hold the last note and let it sing.'] },
  { id: 'w5-07', world: 5, order: 6, boss: true, title: 'Blues Licks', goal: 'Three classic-style blues licks over a 12-bar shuffle.', type: 'notes', position: 5,
    bpm: 70, bars: 12, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'blues', chords: TWELVE_A7 },
    seq: [LICK_1, REST_BAR, LICK_2, REST_BAR, LICK_3, REST_BAR, LICK_1, REST_BAR, LICK_2, REST_BAR, LICK_3, REST_BAR].join(' | '), step: 0.5,
    pass: 65, stars: [65, 80, 92], xp: 90,
    tips: ["Three licks, each followed by a bar of rest. That rest is the band's turn.",
      'Bend the first note until it matches the next note up the box, then play on.', 'The shuffle swings: play the 8ths long-short.',
      'These licks are yours to reuse in every blues jam.'] },
  { id: 'w5-08', world: 5, order: 7, title: 'A Major Box', goal: 'A major pentatonic: the same box shape, moved down to fret 2.', type: 'notes', position: 2,
    bpm: 70, bars: 6, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['A'], parts: GROOVE, level: 0.75 },
    seq: '0.2 0.5 1.2 1.4 2.2 2.4 3.2 3.4 4.2 4.5 5.2 5.5 | 5.2 4.5 4.2 3.4 3.2 2.4 2.2 1.4 1.2 0.5*3', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 70,
    tips: ['A major pentatonic is A B C# E F#. It shares its notes with F# minor pentatonic.', 'It is the box 1 shape you know, with your index finger at fret 2.',
      'Home is A: low E string fret 5, G string fret 2, high e fret 5.', 'Over a major blues or a happy rock song, this box sounds bright.'] },
  { id: 'w5-09', world: 5, order: 8, title: 'Box 2 Bridge', goal: 'Connect box 1 to box 2 in A minor.', type: 'notes', position: 5,
    bpm: 65, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['Am'], parts: GROOVE, level: 0.75 },
    seq: '0.5 0.8 1.5 1.7 2.5 2.7 3.5 /3.7 | 3.9 4.8 4.10 5.8 5.10*2 - - | 5.10 5.8 4.10 4.8 3.9 3.7 2.10 2.7 | 1.10 1.7 0.10 0.8 0.5*4', step: 0.5,
    pass: 65, stars: [65, 80, 92], xp: 80,
    tips: ['Box 2 starts where box 1 ends: slide up the G string from fret 5 to 7.', 'Box 2 sits between frets 7 and 10.',
      'Same five notes, A C D E G. Only the place changes.', 'Come home to A at fret 5 on the low E string.'] },
  { id: 'w5-06', world: 5, order: 9, title: 'Box Boss', goal: 'Box runs and licks over a progression.', type: 'notes', position: 5,
    bpm: 90, bars: 8, timing: 'normal', tone: 'Clean', backing: { feel: 'pop', chords: ['Am', 'F', 'Am', 'F'] },
    seq: '0.5 0.8 1.5 1.7 2.5 2.7 3.5 3.7 4.5 4.8 5.5 5.8 - - - - ' + LICK_A + ' 5.8 5.5 4.8 4.5 3.7 3.5 2.7 2.5 1.7 1.5 0.8 0.5*2 - - - ' + LICK_B, step: 0.5,
    pass: 70, stars: [70, 85, 95], xp: 150,
    tips: ['Breathe in the gaps.', 'If you lose the box, find any A and restart from there.'] },

  // ---- Family 6: expression ----
  { id: 'w6-01', world: 6, order: 1, title: 'Hammer & Pull', goal: 'Sound two notes with one pick stroke.', type: 'notes', position: 5,
    bpm: 70, bars: 4, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'ballad', chords: ['Am'], parts: GROOVE, level: 0.75 },
    seq: '3.5 h3.7 - - 2.5 h2.7 - - | 4.5 h4.8 - - 1.5 h1.7 - - | 3.7 p3.5 - - 2.7 p2.5 - - | 4.8 p4.5 - - 1.7 p1.5 - -', step: 0.5,
    pass: 65, stars: [65, 80, 92], starExtra: { kind: 'legato', share: 0.5 }, xp: 70,
    tips: ['Pick the first note, then hammer or pull the second one half a beat later.', 'Hammer: bring your finger down fast, right behind the fret.',
      "Pull: flick slightly down off the string. Don't just lift."] },
  { id: 'w6-02', world: 6, order: 2, title: 'Slide Over', goal: 'Slide to a target, and step outside the box.', type: 'notes', position: 5,
    bpm: 70, bars: 4, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'ballad', chords: ['Am'], parts: GROOVE, level: 0.75 },
    seq: '3.5 /3.7*2 - | 3.7 /3.9*2 - | 4.8 /4.10*2 - | 2.7 /2.5*2 -', step: 1,
    pass: 65, stars: [65, 80, 92], starExtra: { kind: 'glide', share: 0.5 }, xp: 70,
    tips: ['Keep pressing while you slide. That keeps the note alive.', 'G string fret 9 (E) and B string fret 10 (A) are outside the box and still fit.'] },
  { id: 'w6-03', world: 6, order: 3, title: 'Bend to Pitch', goal: 'Bend in tune by matching a reference note.', type: 'notes', position: 5,
    bpm: 70, bars: 4, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'ballad', chords: ['Am'], parts: FULL, level: 0.7 },
    seq: '3.9*2 3.7^2*2 | 3.9*2 3.7^2*2 | 4.10*2 4.8^2*2 | 4.10*2 4.8^2*2', step: 1,
    pass: 60, stars: [60, 78, 90], xp: 80,
    tips: ['Play the target note first, then bend until it matches.', 'Fret the target with your ring finger too, then move down two frets and bend with the same finger.',
      'Push with your ring finger, with middle and index behind it.', 'Under-bending is the usual miss. Go further than feels right.'] },
  { id: 'w6-04', world: 6, order: 4, title: 'Wobble', goal: 'Vibrato on held notes.', type: 'notes', position: 5,
    bpm: 70, bars: 4, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'ballad', chords: ['Am', 'Am', 'Am', 'Dm'], parts: GROOVE, level: 0.7 },
    seq: '2.7~*3 r | 4.5~*3 r | 5.5~*3 r | 3.7~*3 r', step: 1,
    pass: 60, stars: [60, 78, 90], xp: 70,
    tips: ['Small, even bends up and back, from the wrist, like turning a doorknob.', 'Start slow and wide, then smooth it out.', 'Vibrato makes a note sing.'] },
  { id: 'w6-05', world: 6, order: 5, boss: true, title: 'Say It With Feeling', goal: 'A phrase that uses every technique.', type: 'notes', position: 5,
    bpm: 75, bars: 8, timing: 'normal', tone: 'Blues crunch', backing: { feel: 'ballad', chords: ['Am', 'F'] },
    seq: '3.5 h3.7 3.5 2.7~*5 - - - - - - - - | 3.7^2*4 3.5*2 2.7~*6 - - - - | 3.7 /3.9*3 4.8 4.5 3.7 3.5 2.7~*8 | 4.8^2*4 4.8 4.5 3.7 p3.5 2.7~*8', step: 0.5,
    pass: 70, stars: [70, 85, 95], xp: 160,
    tips: ['Every phrase ends on A with vibrato.', 'Play softer than you think. Feel beats speed here.'] },

  // ---- Family 7: call and response ----
  { id: 'w7-01', world: 7, order: 1, title: 'Echo Rhythm', goal: 'Hear a rhythm on A, then copy it in the next bar.', type: 'notes', position: 5,
    bpm: 80, bars: 8, timing: 'easy', tone: 'Clean', octaveOk: true,
    backing: { feel: 'pop', chords: ['Am'], parts: GROOVE, level: 0.7, onListen: 'drums' },
    calls: { mode: 'echo-rhythm', pos: { s: 2, f: 7 }, calls: ['X_X_X___', 'X_XXX___', '__X_X_X_', 'XX__X_X_'] },
    pass: 65, stars: [65, 80, 92], xp: 70,
    tips: ["Listen, then copy. Don't play during the call.", "Count '1 & 2 & 3 & 4 &' under your breath.", 'Any A works: D string fret 7 is shown.'] },
  { id: 'w7-02', world: 7, order: 2, title: 'Echo Notes', goal: 'Copy short melodies by ear.', type: 'notes', position: 5,
    bpm: 80, bars: 8, timing: 'easy', tone: 'Clean', octaveOk: true,
    backing: { feel: 'ballad', chords: ['Am'], parts: GROOVE, level: 0.7, onListen: 'drums' },
    calls: { mode: 'echo-notes', showUntil: 2, calls: ['2.7*2 3.5*2 3.7*4', '3.7*2 3.5*2 2.7*4', '2.7 3.5 3.7 4.5*2 3.7*2 -', '4.5 3.7 3.5 2.7*5'] },
    pass: 65, stars: [65, 80, 92], xp: 80,
    tips: ['Only four notes: A C D E, inside four frets.', 'Sing it in your head first.', 'The last two are ear only. Trust your ears.'] },
  { id: 'w7-03', world: 7, order: 3, title: 'Your Answer', goal: 'Answer a phrase with your own, not a copy.', type: 'improv',
    bpm: 80, bars: 16, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['Am', 'Am', 'F', 'Am'] },
    improv: { key: 9, scale: 'minorPent', boxFret: 5, endPcs: [9, 4, 0], minNotes: 12,
      callResponse: { mode: 'answer', calls: ['', '', '', '', '', '', '', ''], seed: 7 },
      weights: { answers: 40, inScale: 35, phrases: 25 } },
    pass: 60, stars: [60, 78, 90], xp: 100,
    tips: ['Change one thing: the rhythm, the last note or the direction.', 'Your answers always fall on Am: end on A or E and it sounds finished.', 'Short answers are fine.'] },
  { id: 'w7-05', world: 7, order: 4, title: 'Shuffle Echo', goal: 'Copy the blues licks by ear, swung.', type: 'notes', position: 5,
    bpm: 70, bars: 8, timing: 'easy', tone: 'Blues crunch', octaveOk: true,
    backing: { feel: 'blues', chords: ['A7', 'A7', 'D7', 'A7', 'E7', 'D7', 'A7', 'E7'], parts: GROOVE, level: 0.7, onListen: 'drums' },
    calls: { mode: 'echo-notes', showUntil: 2, calls: [LICK_2, LICK_3, LICK_1, LICK_2] },
    pass: 65, stars: [65, 80, 92], xp: 90,
    tips: ['The calls swing, so your answers should too: long-short.', 'These are your three blues licks. Listen, then copy.', 'The last two are ear only. Trust your ears.'] },
  { id: 'w7-04', world: 7, order: 5, title: 'Conversation', goal: 'Echo four calls, then answer four.', type: 'improv',
    bpm: 85, bars: 16, timing: 'normal', tone: 'Blues crunch', backing: { feel: 'blues', chords: ['A7', 'A7', 'D7', 'A7'] },
    improv: { key: 9, scale: 'blues', boxFret: 5, endPcs: [9, 4], minNotes: 16,
      callResponse: { mode: 'mixed', seed: 11, calls: ['5.5 4.8 4.5 3.7 3.5*2 2.7*2', '2.5 2.7 3.5 3.7 4.5*4', '3.5 h3.7 3.5 2.7*5', '4.8 4.5 3.7 3.5 2.7*4', '', '', '', ''] },
      weights: { echo: 35, answers: 20, inScale: 20, phrases: 15, space: 10 } },
    pass: 65, stars: [65, 80, 92], xp: 180,
    tips: ['The first four calls: copy them note for note.', 'The last four: answer in your own words.', 'Blues shuffle: long-short, long-short.'] },

  // ---- Family 8: freestyle jam ----
  { id: 'w8-01', world: 8, order: 1, title: 'Two-Note Jam', goal: 'Back to two notes, now with endings. Rhythm and space do the work.', type: 'improv',
    bpm: 85, bars: 12, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['Am', 'F'] },
    improv: { key: 9, scale: null, allowedPcs: [9, 0], boxFret: 5, endPcs: [9], minNotes: 12, weights: { inScale: 30, phrases: 25, space: 25, endings: 20 } },
    pass: 60, stars: [60, 78, 90], xp: 100,
    tips: ['Only two notes, so make the rhythm interesting.', 'A phrase, a breath, a phrase. End each one on A.', 'A and C: D string fret 7, G string fret 5, high e frets 5 and 8.'] },
  { id: 'w8-02', world: 8, order: 2, title: 'Box Jam', goal: 'A free solo over a progression with the whole box.', type: 'improv',
    bpm: 90, bars: 12, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'pop', chords: ['Am', 'F', 'C', 'G'] },
    improv: { key: 9, scale: 'minorPent', boxFret: 5, endPcs: [9, 0, 4], minNotes: 16, weights: { inScale: 30, phrases: 25, space: 20, endings: 25 } },
    pass: 60, stars: [60, 78, 90], xp: 120,
    tips: ['Start from your two licks, then change them.', 'Play less than you want to.'] },
  { id: 'w8-03', world: 8, order: 3, boss: true, title: 'Chord Catcher', goal: 'Land on chord tones when the chord changes.', type: 'improv',
    bpm: 85, bars: 8, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['Am', 'F', 'C', 'G'] },
    improv: { key: 9, scale: 'minorPent', boxFret: 5, chordTones: true, minNotes: 12, weights: { targets: 50, inScale: 30, space: 20 } },
    pass: 60, stars: [60, 78, 90], xp: 120,
    tips: ['Notes from the chord sound right on beat 1.', 'A and C fit Am and F. G fits C and G. E fits Am and C.'] },
  { id: 'w8-04', world: 8, order: 4, title: 'Blues Night', goal: 'Tell a story over a 12-bar blues with repetition and answer.', type: 'improv',
    bpm: 90, bars: 24, timing: 'easy', tone: 'Blues crunch',
    backing: { feel: 'blues', chords: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'] },
    improv: { key: 9, scale: 'blues', boxFret: 5, endPcs: [9, 4], minNotes: 24, weights: { inScale: 30, phrases: 25, space: 20, motif: 25 } },
    pass: 60, stars: [60, 78, 90], xp: 150,
    tips: ['Play a lick, play it again, then answer it.',
      "The blue note Eb: A string fret 6, G string fret 8. It's a passing note: slide or bend through it, don't sit on it."] },

  // The jam library: free lessons open with their stage and never block the next lesson
  { id: 'w8-06', world: 8, order: 5, free: true, title: 'Shuffle in A', goal: 'Two choruses over a 12-bar shuffle in A. Land on the chord when it changes.', type: 'improv',
    bpm: 80, bars: 24, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'blues', chords: TWELVE_A7 },
    improv: { key: 9, scale: 'minorPent', boxFret: 5, endPcs: [9, 4], chordTones: true, minNotes: 24, weights: SHUFFLE_WEIGHTS },
    pass: 60, stars: [60, 78, 90], xp: 120,
    tips: ['Land on a note of the new chord: A or E over A7, D or A over D7, E or D over E7.', 'Play a short phrase, then rest. Let the band breathe.'] },
  { id: 'w8-07', world: 8, order: 6, free: true, title: 'Shuffle in E', goal: 'The same shuffle in E. Your box moves to fret 12.', type: 'improv',
    bpm: 85, bars: 24, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'blues', chords: TWELVE_E7 },
    improv: { key: 4, scale: 'minorPent', boxFret: 12, endPcs: [4, 11], chordTones: true, minNotes: 24, weights: SHUFFLE_WEIGHTS },
    pass: 60, stars: [60, 78, 90], xp: 120,
    tips: ['Same box shape, moved to fret 12. The root E is on the low E string at fret 12.', 'Land on E or B over E7, A or E over A7, B or A over B7.'] },
  { id: 'w8-08', world: 8, order: 7, free: true, title: 'Slow Blues', goal: 'A slow blues in A: fewer notes, more feeling.', type: 'improv',
    bpm: 60, bars: 12, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'slowblues', chords: TWELVE_A7 },
    improv: { key: 9, scale: 'minorPent', boxFret: 5, endPcs: [9, 4], chordTones: true, technique: true, minNotes: 12,
      weights: { space: 30, targets: 25, phrases: 25, inScale: 20 } },
    pass: 60, stars: [60, 78, 90], xp: 120,
    tips: ['Hold notes and add vibrato. Bend into chord tones.', 'Leave whole beats empty. Silence is part of the solo.'] },
  { id: 'w8-09', world: 8, order: 8, free: true, title: 'Minor Blues', goal: 'A minor blues: darker, and the same box fits all of it.', type: 'improv',
    bpm: 70, bars: 12, timing: 'easy', tone: 'Blues crunch',
    backing: { feel: 'minorblues', chords: ['Am7', 'Am7', 'Am7', 'Am7', 'Dm7', 'Dm7', 'Am7', 'Am7', 'F7', 'E7', 'Am7', 'E7'] },
    improv: { key: 9, scale: 'minorPent', boxFret: 5, endPcs: [9, 0], chordTones: true, minNotes: 16, weights: { targets: 30, inScale: 30, space: 20, endings: 20 } },
    pass: 60, stars: [60, 78, 90], xp: 120,
    tips: ['Over F7, aim for C or A. Over E7, aim for E or D.', 'End your phrases on A or C.'] },
  { id: 'w8-10', world: 8, order: 9, free: true, title: 'Major Shuffle', goal: 'A major pentatonic over the shuffle: bright and sweet.', type: 'improv',
    bpm: 80, bars: 24, timing: 'easy', tone: 'Clean', backing: { feel: 'blues', chords: TWELVE_A7 },
    improv: { key: 9, scale: 'majorPent', boxFret: 2, endPcs: [9, 1], chordTones: true, minNotes: 24, weights: SHUFFLE_WEIGHTS },
    pass: 60, stars: [60, 78, 90], xp: 120,
    tips: ['Land on A or C# over A7, A or F# over D7, E or B over E7.', 'Mix it with the minor box later. For now, stay bright.'] },
  { id: 'w8-11', world: 8, order: 10, free: true, title: 'Rock in E', goal: 'Straight 8th rock in E. No swing, a bit more bite.', type: 'improv',
    bpm: 90, bars: 16, timing: 'easy', tone: 'Classic rock', backing: { feel: 'pop', chords: ['E5', 'E5', 'A5', 'A5', 'B5', 'B5', 'E5', 'E5'] },
    improv: { key: 4, scale: 'minorPent', boxFret: 12, endPcs: [4, 11], chordTones: true, minNotes: 20, weights: { inScale: 30, phrases: 25, space: 20, targets: 25 } },
    pass: 60, stars: [60, 78, 90], xp: 120,
    tips: ['E minor pentatonic at fret 12 fits all three chords.', 'Short, punchy phrases. Repeat one you like.'] },
  // The boogie's sixths sit a little outside the scale, so the pass mark is 50
  { id: 'w8-12', world: 8, order: 11, boss: true, title: 'Three Choruses', goal: 'Rhythm, solo, rhythm: three choruses without stopping.', type: 'improv',
    bpm: 75, bars: 36, timing: 'easy', tone: 'Blues crunch', backing: { feel: 'blues', chords: [...TWELVE_A7, ...TWELVE_A7, ...TWELVE_A7] },
    improv: { key: 9, scale: 'minorPent', boxFret: 5, endPcs: [9, 4], chordTones: true, minNotes: 30, weights: { phrases: 30, targets: 30, inScale: 20, space: 20 } },
    pass: 50, stars: [50, 70, 85], xp: 150,
    tips: ['Chorus 1: play the boogie. Chorus 2: solo. Chorus 3: back to the boogie.', "Don't stop, whatever happens. Keep the form going.",
      'Record a take of it and listen back next session.'] },
  { id: 'w8-05', world: 8, order: 12, title: 'Big Stomp Jam', goal: 'A full freestyle solo using everything.', type: 'improv',
    bpm: 95, bars: 16, timing: 'normal', tone: 'Blues crunch', backing: { feel: 'pop', chords: ['Am', 'F', 'C', 'G'] },
    improv: { key: 9, scale: 'minorPent', boxFret: 5, endPcs: [9, 0, 4], chordTones: true, minNotes: 24, technique: true,
      weights: { inScale: 25, phrases: 20, space: 15, endings: 15, targets: 15, motif: 10 } },
    pass: 65, stars: [65, 80, 92], xp: 300,
    tips: ['Start simple, build up, end on A with vibrato.', 'Use one bend, one slide and one hammer-on somewhere: they earn bonus points.', 'A wrong note in a jam is just one you haven\'t resolved yet. Slide to a box note.'] },
]

// Lessons made at run time from the player's own songs (songLesson.ts). They are found by id like any other,
// but are not on the plan's path: nothing unlocks or schedules them.
const MADE = new Map<string, Lesson>()
export function registerLesson(l: Lesson): void {
  MADE.set(l.id, l)
}

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id) ?? MADE.get(id)
}

/** The 12-week plan's lessons per fortnight (research section 5), in teaching order: each stage's core minus Tap In. */
export const PLAN_LESSONS: string[][] = STAGES.filter((s) => s.weeks).map((s) => s.core.filter((id) => lessonById(id)?.type !== 'sync'))

/** The lessons that unlock in order (free jams open with their stage): each opens once the one before is passed. */
export const PLAN_PATH: string[] = STAGES.flatMap((s) => s.core).filter((id) => !lessonById(id)?.free)

/** Every lesson in map order: each stage's core, then its extras. */
export const ORDER: string[] = STAGES.flatMap((s) => [...s.core, ...s.extra])

/** Where a lesson sits on the map: its stage, core or extra, and its 0-based place in that list. */
export function stageOf(id: string): { stage: StageDef; core: boolean; pos: number } | null {
  for (const stage of STAGES) {
    const c = stage.core.indexOf(id)
    if (c >= 0) return { stage, core: true, pos: c }
    const e = stage.extra.indexOf(id)
    if (e >= 0) return { stage, core: false, pos: e }
  }
  return null
}

/** A stage's checkpoint: the last core lesson (none for the Extras area). */
export function checkpointOf(s: StageDef): string | null {
  return s.weeks && s.core.length ? s.core[s.core.length - 1] : null
}

/** "Weeks 1–2", or "Extras" for the Extras area. */
export const weeksLabel = (s: StageDef) => (s.weeks ? `Weeks ${s.weeks[0]}–${s.weeks[1]}` : 'Extras')

/** Where a lesson sits, for its intro: "Weeks 1–2, lesson 3", "Weeks 1–2 checkpoint", "Weeks 3–4 · optional extra". */
export function whereLabel(id: string): string {
  const at = stageOf(id)
  if (!at) return ''
  const w = weeksLabel(at.stage)
  if (!at.core) return at.stage.weeks ? `${w} · optional extra` : 'Optional extra'
  return id === checkpointOf(at.stage) ? `${w} checkpoint` : `${w}, lesson ${at.pos + 1}`
}

/** Lessons that grow the dino: the 6 checkpoints, then the 2 encores. */
export const GROWTH: string[] = [
  ...STAGES.map(checkpointOf).filter((id): id is string => id !== null),
  ...STAGES.map((s) => s.encore).filter((id): id is string => !!id),
]

// ---- validateLessons() ----------------------------------------------------------

const NOTATION_LEAK = /\b\d\.\d+\b/

// '' and 'mute' are allowed placeholders; anything else must parse.
function badChord(sym: string): boolean {
  return sym !== '' && sym !== 'mute' && !parseChord(sym)
}

// Problems with a 6-string shape for a chord: wrong length, a string outside the chord, or no root.
function shapeProblems(sym: string, frets: number[]): string[] {
  const c = parseChord(sym)
  if (!c) return []
  if (frets.length !== 6) return [`shape for ${sym} has ${frets.length} strings`]
  const out: string[] = []
  let root = false
  frets.forEach((f, s) => {
    if (f < 0) return
    const p = pc(STANDARD_TUNING[s] + f)
    if (!c.tones.includes(p)) out.push(`shape for ${sym}: string ${s} fret ${f} is not a chord tone`)
    if (p === c.root) root = true
  })
  if (!root) out.push(`shape for ${sym} has no root`)
  return out
}

const MAX_FRET = 15

// Fret range, and h/p// need the previous note on the same string, going the right way.
function seqProblems(src: string, step: number, what: string): string[] {
  const out: string[] = []
  let prev: { s: number; f: number } | null = null
  for (const it of seq(src, step)) {
    if (it.k !== 'note') {
      prev = null
      continue
    }
    if (it.f > MAX_FRET) out.push(`${what}: fret ${it.f} is above ${MAX_FRET}`)
    const t = it.tech
    if (t === 'hammer' || t === 'pull' || t === 'slide') {
      if (!prev || prev.s !== it.s) out.push(`${what}: ${t} at beat ${it.beat} has no previous note on the same string`)
      else if (t === 'hammer' && it.f <= prev.f) out.push(`${what}: hammer at beat ${it.beat} does not go up`)
      else if (t === 'pull' && it.f >= prev.f) out.push(`${what}: pull at beat ${it.beat} does not go down`)
      else if (t === 'slide' && it.f === prev.f) out.push(`${what}: slide at beat ${it.beat} does not move`)
    }
    prev = { s: it.s, f: it.f }
  }
  return out
}

/** One message per content problem; empty = OK. */
export function validateLessons(): string[] {
  const errs: string[] = []
  const ids = new Set<string>()
  for (const l of LESSONS) {
    if (ids.has(l.id)) errs.push(`duplicate id ${l.id}`)
    ids.add(l.id)
  }
  for (const id of PLAN_LESSONS.flat()) if (!ids.has(id)) errs.push(`12-week plan: unknown lesson ${id}`)
  if (new Set(PLAN_LESSONS.flat()).size !== PLAN_LESSONS.flat().length) errs.push('12-week plan: a lesson is listed twice')

  for (const s of STAGES) {
    const cp = checkpointOf(s)
    for (const id of [...s.core, ...s.extra]) {
      const l = lessonById(id)
      if (!l) {
        errs.push(`stage ${s.id}: unknown lesson ${id}`)
        continue
      }
      const core = s.core.includes(id)
      if (!!l.boss !== (id === cp)) errs.push(`${id}: only a stage's last core lesson is a checkpoint (boss)`)
      if (l.free && !core) errs.push(`${id}: a free jam must be core, not an extra`)
      if (l.free && l.boss) errs.push(`${id}: a free lesson can't be a checkpoint`)
      if (l.dyad && l.type !== 'notes') errs.push(`${id}: dyad needs a notes lesson`)
    }
    if (s.weeks && !s.core.length) errs.push(`stage ${s.id}: no core lessons`)
    if (s.encore && !s.extra.includes(s.encore)) errs.push(`stage ${s.id}: encore ${s.encore} is not one of its extras`)
    if (NOTATION_LEAK.test(s.title) || NOTATION_LEAK.test(s.skill)) errs.push(`stage ${s.id}: title or skill shows string.fret notation`)
  }
  if (lessonById(STAGES[0].core[0])?.type !== 'sync') errs.push('stage 1 must start with the sync lesson')
  for (const l of LESSONS) {
    const n = ORDER.filter((id) => id === l.id).length
    if (n !== 1) errs.push(`${l.id}: listed ${n} times on the map`)
  }

  for (const l of LESSONS) {
    const p = l.id + ': '
    try {
      const chart = buildChart(l)
      const judged = chart.events.filter((e) => e.kind !== 'rest').length
      if (l.type !== 'sync' && l.type !== 'improv' && judged === 0) errs.push(p + 'chart has nothing to judge')
      if (l.type !== 'sync') errs.push(...validateFingering(l).map((m) => p + m))
    } catch (e) {
      errs.push(p + `buildChart failed: ${e instanceof Error ? e.message : String(e)}`)
    }

    // the content each type needs
    if (l.type === 'notes' && l.seq === undefined && !l.calls) errs.push(p + 'notes lesson needs seq or calls')
    if (l.type === 'improv' && !l.improv) errs.push(p + 'improv lesson needs improv')
    if ((l.type === 'chords' || l.type === 'rhythm') && !l.chordBars?.length) errs.push(p + `${l.type} lesson needs chordBars`)

    if (l.seq !== undefined && !l.calls) {
      try {
        const beats = seqBeats(l.seq, l.step ?? 1)
        if (beats !== l.bars * 4) errs.push(p + `seq is ${beats} beats, expected ${l.bars * 4}`)
        for (const it of seq(l.seq, l.step ?? 1)) if (it.k === 'chord' && badChord(it.symbol)) errs.push(p + `chord "${it.symbol}" does not parse`)
        errs.push(...seqProblems(l.seq, l.step ?? 1, 'seq').map((m) => p + m))
      } catch (e) {
        errs.push(p + (e instanceof Error ? e.message : String(e)))
      }
    }

    if (l.type === 'chords' || l.type === 'rhythm') {
      const cb = l.chordBars ?? []
      if (cb.length !== l.bars) errs.push(p + `${cb.length} chord bars, expected ${l.bars}`)
      cb.forEach((b, i) => {
        if (!/^[DUPxr_]{8}$/.test(b.strum)) errs.push(p + `bar ${i} strum "${b.strum}" is not 8 slots of DUPxr_`)
        if (badChord(b.chord)) errs.push(p + `bar ${i} chord "${b.chord}" does not parse`)
        if (b.frets) errs.push(...shapeProblems(b.chord, b.frets).map((m) => p + m))
      })
    }
    for (const sym of l.backing?.chords ?? []) if (badChord(sym)) errs.push(p + `backing chord "${sym}" does not parse`)
    const b = l.backing
    if (l.type === 'sync') {
      if (b) errs.push(p + 'the sync lesson must stay click-only')
    } else if (!b) errs.push(p + 'needs a backing band')
    if (b) {
      if (!b.chords.length) errs.push(p + 'backing has no chords')
      if (b.level !== undefined && !(b.level > 0 && b.level <= 1)) errs.push(p + `backing level ${b.level} is outside 0–1`)
      if (b.parts && !b.parts.drums && !b.parts.bass && !b.parts.keys) errs.push(p + 'backing plays no parts')
      if (b.onListen && b.onListen !== 'all' && !l.calls && !l.improv?.callResponse) errs.push(p + 'onListen without listen bars')
    }
    for (const [sym, frets] of Object.entries(l.shapes ?? {})) {
      if (badChord(sym)) errs.push(p + `shape key "${sym}" does not parse`)
      errs.push(...shapeProblems(sym, frets).map((m) => p + m))
    }

    if (l.calls) {
      const cs = l.calls
      if (cs.calls.length * 2 !== l.bars) errs.push(p + `${cs.calls.length} calls for ${l.bars} bars`)
      cs.calls.forEach((c, i) => {
        if (cs.mode === 'echo-rhythm') {
          if (!/^[X_]{8}$/.test(c)) errs.push(p + `call ${i} "${c}" is not 8 slots of X_`)
        } else {
          try {
            const beats = seqBeats(c, 0.5)
            if (beats !== 4) errs.push(p + `call ${i} is ${beats} beats, expected 4`)
            errs.push(...seqProblems(c, 0.5, `call ${i}`).map((m) => p + m))
          } catch (e) {
            errs.push(p + (e instanceof Error ? e.message : String(e)))
          }
        }
      })
      if (cs.mode === 'echo-rhythm' && !cs.pos) errs.push(p + 'echo-rhythm needs pos')
      if (cs.pos && (cs.pos.s < 0 || cs.pos.s > 5 || cs.pos.f < 0 || cs.pos.f > MAX_FRET)) errs.push(p + `pos ${cs.pos.s}/${cs.pos.f} is off the neck`)
    }

    const cr = l.improv?.callResponse
    if (cr) {
      if (cr.calls.length !== l.bars / 2) errs.push(p + `${cr.calls.length} improv calls for ${l.bars} bars`)
      cr.calls.forEach((c, i) => {
        if (c === '') return
        try {
          const beats = seqBeats(c, 0.5)
          if (beats !== 4) errs.push(p + `improv call ${i} is ${beats} beats, expected 4`)
          errs.push(...seqProblems(c, 0.5, `improv call ${i}`).map((m) => p + m))
        } catch (e) {
          errs.push(p + (e instanceof Error ? e.message : String(e)))
        }
      })
    }

    if (NOTATION_LEAK.test(l.title)) errs.push(p + 'title shows string.fret notation')
    if (NOTATION_LEAK.test(l.goal)) errs.push(p + 'goal shows string.fret notation')
    l.tips.forEach((t, i) => {
      if (NOTATION_LEAK.test(t)) errs.push(p + `tip ${i} shows string.fret notation`)
    })
  }
  return errs
}
