# Backing band samples

Builds the recorded instruments and groove templates for the backing band:

- `build_band.py` → `public/samples/band/{drums,bass,keys}/*.ogg` and `public/samples/band/manifest.json`
- `build_grooves.py` → `src/audio/sampler/grooves.json`

The outputs are committed, so you only need this to change or rebuild them. Licences and credits: `CREDITS.md`.

## 1. Download the packs (about 1.6 GB, keep them outside the repo)

Put all four in one folder (`<packs>`), with these names:

| Folder / file | Where | Licence |
|---|---|---|
| `karoryfer.unruly-drums/` | https://github.com/sfzinstruments/karoryfer.unruly-drums (clone or "Download ZIP") | CC0 1.0 |
| `karoryfer.growlybass/` | https://github.com/sfzinstruments/karoryfer.growlybass | CC0 1.0 |
| `GregSullivan.E-Pianos/` | https://github.com/sfzinstruments/GregSullivan.E-Pianos | CC BY 3.0 |
| `groove-midi/groove-v1.0.0-midionly.zip` | https://magenta.tensorflow.org/datasets/groove (MIDI-only zip) | CC BY 4.0 |

Read each pack's LICENSE before using a newer version.

## 2. Make a Python environment (outside the repo)

No ffmpeg needed: soundfile's bundled libsndfile reads FLAC/WAV and writes Ogg Vorbis.

```sh
uv venv ~/venv-samples
uv pip install --python ~/venv-samples/bin/python numpy soundfile mido
```

## 3. Run

From the repo root (`-I` keeps Python from importing anything from the current folder):

```sh
~/venv-samples/bin/python -I scripts/samples/build_band.py --src <packs>
~/venv-samples/bin/python -I scripts/samples/build_grooves.py --zip <packs>/groove-midi/groove-v1.0.0-midionly.zip
```

`build_band.py` deletes and rewrites `public/samples/band/{drums,bass,keys}`. It prints the size at the end.
The total must stay under 20 MB; it is about 3.7 MB now.

## What the scripts do

**Drums** (Unruly Drums, stick kit): for each piece, keeps 4 of the recorded velocity layers and 2 round robins. Close and
overhead mics are mixed to mono with the close mics up front (dry and tight). Each hit starts within 0.5 ms of its onset,
and the tail is cut at -58 dB with a short fade. Each piece has one gain, so its loudest layer peaks at -1 dBFS and the
softer layers stay softer. Pieces: kick 20", snare 14" (centre), closed and open hi-hat 14" (tip), ride 20" (bow), crash
16" (edge), `rimshot` = 14" cross-stick (side stick), toms = the 13" and 22" snares with the wires off.

**Bass** (Growlybass, "clean" mapping = sustained notes): roots every 2–3 semitones from E1 to A3 (MIDI 28–57), 3 velocity
layers (p, f, ff) and 2 round robins. Trimmed to 2.5 s with a 0.35 s fade. The pack names notes one octave higher than
MIDI (`e2_*.wav` is E1, MIDI 28; checked by pitch detection), so the script subtracts 12. The E1 recordings are about
25 cents sharp, so the script re-tunes them down (`BASS_TUNE`).

**Keys** (Wurlitzer EP200): roots every 3 semitones from A2 to C6 (MIDI 45–84), 3 layers (mp, f, ff). The pack samples
different notes in each velocity group, so every layer is re-pitched (windowed sinc) onto the zone's root, with the SFZ
mapping's `tune` and `volume` fixes applied. The pack's layers are each normalised, so a gentle velocity gain (64/127,
100/127, 1) is baked in. Trimmed to 3 s with a 0.6 s fade. High notes decay faster in the source, so some files are shorter.
Most source files are only 2–3 s long, so a longer trim would not help: a chord held longer than its file (ballad at slow
speeds) repeats the last stretch before the fade in the app (`VoicePool.play`), which must know the fade lengths
(`FILE_FADE` in `src/audio/backing.ts`).

The drum kit also has open hat, ride, crash and toms; the app loads only kick, snare, closed hat and rimshot (`KIT_PIECES`
in `src/audio/sampler/bank.ts`).

**manifest.json**: file paths are relative to `public/samples/band/` (served at `/samples/band/`). `vel` is each layer's
upper velocity bound (1–127); `lo`/`hi` are the MIDI notes a zone covers around its `root`.

**Grooves** (Groove MIDI Dataset, 4/4 `beat` files only): picks files by the dataset's style and BPM for each feel in
`src/music/parts.ts`. Every kick, snare (incl. rim and cross-stick) and hat or ride hit within 0.15 beats of an 8th slot
is measured against the grid (for `blues`, against the app's swung grid, off-beats at 0.665 of a beat). Per file and slot
it takes the median; the feel gets the median across files. Offsets are relative to slot 0 (beat 1 never moves) and
clamped to ±15 ms. `jitterMs` is the typical spread around those medians, capped at 4 ms. Velocities are per piece and
slot, scaled so each piece's loudest slot across all feels is 1.
