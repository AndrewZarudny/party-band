# Credits

Fretwise's backing band uses recorded instrument samples and drum groove data from these free sources. The files are in
`public/samples/band/` and `src/audio/sampler/grooves.json`; `scripts/samples/` rebuilds them from the original packs.

## Electric piano: Wurlitzer EP200 (Greg Sullivan's E-Pianos)

- Samples by **Greg Sullivan** (http://www.sullivang.net/). SFZ mapping by kinwie:
  https://github.com/sfzinstruments/GregSullivan.E-Pianos
- Licence: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**, https://creativecommons.org/licenses/by/3.0/
- Changes: we selected some of the samples, re-pitched them onto a 3-semitone grid, applied the mapping's tuning and level
  fixes and a velocity gain, trimmed them to at most 3 seconds with a fade-out, normalised them and converted them from
  FLAC to Ogg Vorbis.

## Drum feel: Groove MIDI Dataset

- **Groove MIDI Dataset** by **Google LLC (Magenta)**, https://magenta.tensorflow.org/datasets/groove
- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**, https://creativecommons.org/licenses/by/4.0/
- Changes: groove timing and velocity templates were extracted (median timing offset and velocity per 8th-note slot,
  per style). No MIDI files from the dataset are included.
- Paper: Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck and David Bamman, "Learning to Groove with Inverse Sequence
  Transformations", ICML 2019.

## Drums: Unruly Drums

- By **Karoryfer Samples**, https://github.com/sfzinstruments/karoryfer.unruly-drums
- Licence: **CC0 1.0 Universal** (public domain dedication), https://creativecommons.org/publicdomain/zero/1.0/.
  No attribution is required; we credit it anyway, with thanks.
- Changes: we selected some hits, mixed the close and overhead mics to mono, trimmed, faded, normalised and converted them
  to Ogg Vorbis.

## Bass: Growlybass

- By **Karoryfer Samples** (Squier Jazz Bass), https://github.com/sfzinstruments/karoryfer.growlybass
- Licence: **CC0 1.0 Universal**, https://creativecommons.org/publicdomain/zero/1.0/. No attribution is required; we
  credit it anyway, with thanks.
- Changes: we selected some sustained notes, re-tuned the E1 notes 25 cents down (they were recorded sharp), trimmed them
  to at most 2.5 seconds with a fade-out, normalised them and converted them to Ogg Vorbis.
