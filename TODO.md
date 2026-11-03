# To do

## Song data without paid APIs

The external providers didn't work out (GetSongBPM wouldn't issue a key, Musixmatch is too expensive,
Hooktheory no longer has an API). Everything they would have added is covered locally instead:

- Tempo and chords: 🔬 Analyse on the song's recording (done)
- Lyric timing: 🎤 Sync the words, tapped once per song (done)

Ideas for later:
- [x] Guess the song's key from the chords Analyse hears
- [ ] Import an `.lrc` file you already have (line times from your music player) instead of tapping
- [ ] Snap tapped line starts to where the voice comes in on the recording
