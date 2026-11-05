import type { Lesson, WorldDef } from './types'
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

export const WORLDS: WorldDef[] = [
  { id: 1, title: 'First Sparks', skill: 'Electric basics and muting', lessons: ['w1-01', 'w1-02', 'w1-03', 'w1-04'] },
  { id: 2, title: 'Fret Finder', skill: 'Clean single notes, and a first jam', lessons: ['w2-01', 'w2-02', 'w2-03', 'w2-05', 'w2-04'] },
  { id: 3, title: 'Strum Stomp', skill: 'Rhythm and feel', lessons: ['w3-01', 'w3-02', 'w3-03', 'w3-05', 'w3-04'] },
  { id: 4, title: 'Power Stomp', skill: 'Power chords and riffs', lessons: ['w4-01', 'w4-02', 'w4-03', 'w4-04'] },
  { id: 5, title: 'Pentatonic Playground', skill: 'A minor pentatonic, box 1', lessons: ['w5-01', 'w5-02', 'w5-03', 'w5-04', 'w5-06'] },
  { id: 6, title: 'Expression', skill: 'Hammer-ons, slides, bends, vibrato', lessons: ['w6-01', 'w6-02', 'w6-03', 'w6-04', 'w6-05'] },
  { id: 7, title: 'Call & Response', skill: 'Listening and answering', lessons: ['w7-01', 'w7-02', 'w7-03', 'w7-04'] },
  { id: 8, title: 'Freestyle Jam', skill: 'Improvising over a band', lessons: ['w8-01', 'w8-02', 'w8-03', 'w8-04', 'w8-05'] },
]

export const LESSONS: Lesson[] = [
  // ---- World 1: First Sparks ----
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
  { id: 'w1-04', world: 1, order: 4, boss: true, title: 'Spark Show', goal: 'Open strings, muting and your first fretted notes together.', type: 'notes',
    bpm: 80, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['E5', 'E5', 'A5', 'A5'], parts: GROOVE, level: 0.6 },
    seq: '0.0 r 1.0 r | 2.0 r 3.0 r | 4.5 4.5 5.5 5.5 | 4.5 r 5.5*2', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 100,
    tips: ['Fretted notes: press just behind the 5th fret wire, not on top of it.', 'Pick down on every beat. Let the pick swing back up between notes.'] },

  // ---- World 2: Fret Finder ----
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
  { id: 'w2-04', world: 2, order: 5, boss: true, title: 'Full Ode', goal: 'A whole melody, accurate and steady.', type: 'notes',
    bpm: 90, bars: 8, timing: 'normal', tone: 'Clean', backing: { feel: 'pop', chords: ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'C'], parts: FULL, level: 0.75 },
    seq: '4.5 4.5 4.6 4.8 | 4.8 4.6 4.5 4.3 | 4.1 4.1 4.3 4.5 | 4.5*1.5 4.3*0.5 4.3*2 | 4.5 4.5 4.6 4.8 | 4.8 4.6 4.5 4.3 | 4.1 4.1 4.3 4.5 | 4.3*1.5 4.1*0.5 4.1*2', step: 1,
    pass: 70, stars: [70, 85, 95], xp: 120,
    tips: ['Phrase two ends differently. Listen for it.', 'Relax. Tension makes you rush.'] },

  // ---- World 3: Strum Stomp ----
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
  { id: 'w3-03', world: 3, order: 3, title: 'Reggae Chop', goal: 'Short chords only on 2 and 4, with silence in between.', type: 'rhythm',
    bpm: 80, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'reggae', chords: ['Am', 'D', 'Am', 'D'] },
    chordBars: [{ chord: 'Am', frets: AM_TOP, strum: 'r_D_r_D_' }, { chord: 'D', frets: D_TOP, strum: 'r_D_r_D_' },
      { chord: 'Am', frets: AM_TOP, strum: 'r_D_r_D_' }, { chord: 'D', frets: D_TOP, strum: 'r_D_r_D_' }],
    pass: 65, stars: [65, 80, 92], xp: 60,
    tips: ['Am: lay your index across the top three strings at fret 5. D: index on high e fret 5, ring and pinky on fret 7.', 'Hit on 2 and 4 only.',
      "Right after the hit, ease off the pressure to choke it. Think 'chk', not 'strummm'."] },
  { id: 'w3-05', world: 3, order: 4, title: 'Open Chord Swap', goal: 'Learn the open G, D and C chords, and change between them in time.', type: 'chords',
    bpm: 70, bars: 8, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['G', 'G', 'D', 'D', 'C', 'C', 'G', 'G'], parts: GROOVE, level: 0.7 },
    chordBars: [...bars('G', 'D_D_D_D_', 2), ...bars('D', 'D_D_D_D_', 2), ...bars('C', 'D_D_D_D_', 2), ...bars('G', 'D_D_D_D_', 2)],
    pass: 65, stars: [65, 80, 92], xp: 60,
    tips: ['G: middle finger on low E fret 3, index on A string fret 2, ring on high e fret 3. The middle strings ring open.',
      'D: index on G string fret 2, ring on B string fret 3, middle on high e fret 2. Strum only the top four strings.',
      'C: ring on A string fret 3, middle on D string fret 2, index on B string fret 1. Skip the low E.',
      'Start moving to the next chord on beat 4. Landing on time beats landing perfect.'] },
  { id: 'w3-04', world: 3, order: 5, boss: true, title: 'Groove Gauntlet', goal: 'A full strum pattern through chord changes, with the band.', type: 'chords',
    bpm: 85, bars: 8, timing: 'normal', tone: 'Clean', backing: { feel: 'pop', chords: ['G', 'D', 'Em', 'C'] },
    chordBars: ['G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C'].map((chord) => ({ chord, strum: 'D_DU_UDU' })),
    pass: 70, stars: [70, 85, 95], xp: 120,
    tips: ['Down, down-up, up-down-up. Say it out loud.', 'Same G, D and C shapes as the last lesson, plus Em.', 'Change chords during the last up-strum. Open strings there are fine.', 'Never stop the hand.'] },

  // ---- World 4: Power Stomp ----
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
  { id: 'w4-04', world: 4, order: 4, boss: true, title: 'Stomp Session', goal: 'Riff, then power chords, locked to the drums.', type: 'notes', pickRule: 'down',
    bpm: 95, bars: 8, timing: 'normal', tone: 'Classic rock', backing: { feel: 'pop', chords: ['E5', 'E5', 'E5', 'E5', 'G5', 'A5', 'C5', 'D5'] }, shapes: POWER,
    seq: '0.0 0.0 0.3@1 0.0 0.5@3 0.0 0.3@1 0.0 | 0.0 0.0 0.3@1 0.0 1.2@1 - 1.0 - | 0.0 0.0 0.3@1 0.0 0.5@3 0.0 0.3@1 0.0 | 0.0 0.0 0.3@1 0.0 1.2@1 - 1.0 - | ' +
      '[G5] - [G5] [G5] - [G5] [G5] [G5] | [A5] - [A5] [A5] - [A5] [A5] [A5] | [C5] - [C5] [C5] - [C5] [C5] [C5] | [D5] - [D5] [D5] - [D5] [D5]*2', step: 0.5,
    pass: 70, stars: [70, 85, 95], xp: 150,
    tips: ['Get the G5 shape ready during the last eighth of bar 4.', 'Lock in with the kick drum.'] },

  // ---- World 5: Pentatonic Playground ----
  { id: 'w5-01', world: 5, order: 1, title: 'Meet the Box', goal: 'Play the 12-note box up and down.', type: 'notes', position: 5,
    bpm: 70, bars: 6, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['Am'], parts: GROOVE, level: 0.75 },
    seq: '0.5 0.8 1.5 1.7 2.5 2.7 3.5 3.7 4.5 4.8 5.5 5.8 | 5.5 4.8 4.5 3.7 3.5 2.7 2.5 1.7 1.5 0.8 0.5*2', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 60,
    tips: ['Two notes per string: index on 5, ring on 7, pinky on 8.', 'The highlighted dots are A, home.', 'The notes: A C D E G.'] },
  { id: 'w5-02', world: 5, order: 2, title: 'Home Base', goal: 'Find the roots (A) and the safe fifth (E) over the band.', type: 'notes', position: 5,
    bpm: 75, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'ballad', chords: ['Am'] },
    seq: '0.5*2 2.7*2 | 5.5*2 2.7*2 | 1.7*2 4.5*2 | 2.7*4', step: 1,
    pass: 65, stars: [65, 82, 95], xp: 60,
    tips: ['A is home. Every jam can end here.', 'E fits too: a safe neighbour.',
      'The two lower A notes are your octave shape again. The high A is on the high e string, fret 5.'] },
  { id: 'w5-03', world: 5, order: 3, title: 'Threes', goal: 'A scale sequence for finger independence.', type: 'notes', position: 5,
    bpm: 70, bars: 4, timing: 'easy', tone: 'Clean', backing: { feel: 'pop', chords: ['Am'], parts: GROOVE, level: 0.75 },
    seq: '0.5 0.8 1.5  0.8 1.5 1.7  1.5 1.7 2.5  1.7 2.5 2.7  2.5 2.7 3.5  2.7 3.5 3.7  3.5 3.7 4.5  3.7 4.5 4.8  4.5 4.8 5.5  4.8 5.5 5.8*2 -', step: 0.5,
    pass: 65, stars: [65, 82, 95], xp: 70,
    tips: ['Up two, back one. Accuracy before speed.', 'Keep the 8ths even and count "1 & 2 &". The groups of three run across the beat, and that is fine.',
      'Alternate picking: down-up-down, up-down-up.'] },
  { id: 'w5-04', world: 5, order: 4, title: 'Two Licks', goal: 'Learn two vocabulary licks that both end on A.', type: 'notes', position: 5,
    bpm: 85, bars: 8, timing: 'normal', tone: 'Clean', backing: { feel: 'pop', chords: ['Am', 'F'] },
    seq: `${LICK_A} ${LICK_B} ${LICK_A} ${LICK_B}`, step: 0.5,
    pass: 70, stars: [70, 85, 95], xp: 80,
    tips: ["Licks are words. You'll reuse these in your jams.", 'Both land on A, a strong ending over Am and F.', 'Hold the last note and let it sing.'] },
  { id: 'w5-06', world: 5, order: 5, boss: true, title: 'Box Boss', goal: 'Box runs and licks over a progression.', type: 'notes', position: 5,
    bpm: 90, bars: 8, timing: 'normal', tone: 'Clean', backing: { feel: 'pop', chords: ['Am', 'F', 'Am', 'F'] },
    seq: '0.5 0.8 1.5 1.7 2.5 2.7 3.5 3.7 4.5 4.8 5.5 5.8 - - - - ' + LICK_A + ' 5.8 5.5 4.8 4.5 3.7 3.5 2.7 2.5 1.7 1.5 0.8 0.5*2 - - - ' + LICK_B, step: 0.5,
    pass: 70, stars: [70, 85, 95], xp: 150,
    tips: ['Breathe in the gaps.', 'If you lose the box, find any A and restart from there.'] },

  // ---- World 6: Expression ----
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

  // ---- World 7: Call & Response ----
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
  { id: 'w7-04', world: 7, order: 4, boss: true, title: 'Conversation', goal: 'Echo four calls, then answer four.', type: 'improv',
    bpm: 85, bars: 16, timing: 'normal', tone: 'Blues crunch', backing: { feel: 'blues', chords: ['A7', 'A7', 'D7', 'A7'] },
    improv: { key: 9, scale: 'blues', boxFret: 5, endPcs: [9, 4], minNotes: 16,
      callResponse: { mode: 'mixed', seed: 11, calls: ['5.5 4.8 4.5 3.7 3.5*2 2.7*2', '2.5 2.7 3.5 3.7 4.5*4', '3.5 h3.7 3.5 2.7*5', '4.8 4.5 3.7 3.5 2.7*4', '', '', '', ''] },
      weights: { echo: 35, answers: 20, inScale: 20, phrases: 15, space: 10 } },
    pass: 65, stars: [65, 80, 92], xp: 180,
    tips: ['The first four calls: copy them note for note.', 'The last four: answer in your own words.', 'Blues shuffle: long-short, long-short.'] },

  // ---- World 8: Freestyle Jam ----
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
  { id: 'w8-03', world: 8, order: 3, title: 'Chord Catcher', goal: 'Land on chord tones when the chord changes.', type: 'improv',
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
  { id: 'w8-05', world: 8, order: 5, boss: true, title: 'Big Stomp Jam', goal: 'A full freestyle solo using everything.', type: 'improv',
    bpm: 95, bars: 16, timing: 'normal', tone: 'Blues crunch', backing: { feel: 'pop', chords: ['Am', 'F', 'C', 'G'] },
    improv: { key: 9, scale: 'minorPent', boxFret: 5, endPcs: [9, 0, 4], chordTones: true, minNotes: 24, technique: true,
      weights: { inScale: 25, phrases: 20, space: 15, endings: 15, targets: 15, motif: 10 } },
    pass: 65, stars: [65, 80, 92], xp: 300,
    tips: ['Start simple, build up, end on A with vibrato.', 'Use one bend, one slide and one hammer-on somewhere: they earn bonus points.', 'A wrong note in a jam is just one you haven\'t resolved yet. Slide to a box note.'] },
]

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id)
}

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

  for (const w of WORLDS) {
    w.lessons.forEach((id, i) => {
      const l = lessonById(id)
      if (!l) {
        errs.push(`world ${w.id}: unknown lesson ${id}`)
        return
      }
      if (l.world !== w.id) errs.push(`${id}: world ${l.world} but listed in world ${w.id}`)
      if (l.order !== i + 1) errs.push(`${id}: order ${l.order}, position ${i + 1}`)
      if (!!l.boss !== (i === w.lessons.length - 1)) errs.push(`${id}: the boss must be last in its world`)
    })
    if (NOTATION_LEAK.test(w.title) || NOTATION_LEAK.test(w.skill)) errs.push(`world ${w.id}: title or skill shows string.fret notation`)
  }
  for (const l of LESSONS) {
    const w = WORLDS.find((x) => x.id === l.world)
    const n = w ? w.lessons.filter((id) => id === l.id).length : 0
    if (n !== 1) errs.push(`${l.id}: listed ${n} times in world ${l.world}`)
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
