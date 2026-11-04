# Fretwise

A local guitar practice app that runs in the browser. You plug your guitar into a Focusrite Scarlett Solo (4th gen).

## Run

```bash
npm install
npm run dev
```

It opens at http://localhost:5173. Use **Chrome**: it supports picking the output device and gives the lowest latency.

## Setup with the Scarlett Solo

1. Plug the guitar into **Input 2** (the jack on the right) and press **INST**.
2. Turn **Direct Monitor off**. Otherwise you hear the dry guitar on top of the amp sim.
3. In the app, click **Connect guitar**. It finds the Scarlett on its own, reads input 2, and sends sound out of the Scarlett's headphone and monitor outputs.
4. Turn up the Scarlett's gain knob until its halo flashes green when you strum hard, but never red.
5. If notes aren't picked up, open **🎸 → Input** and play. You'll see a meter for each input, the note the app hears, and a message saying what's wrong (no signal, wrong input, too quiet).

## Find a song (AI search)

Click **🔍 Find a song** and describe the song any way you like, e.g. "the solo from Hotel California". Claude works out which song you mean and searches Ultimate Guitar and Songsterr for Guitar Pro versions you can download. Open one and click its download button. Fretwise watches your **Downloads** folder and imports new Guitar Pro files automatically.

AI search needs an Anthropic API key. Put it in `.env.local` in this folder (git ignores that file), then restart `npm run dev`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Without a key you still get direct search links.

## AI features and their cost

| Feature | Model | Typical cost | Repeat |
|---|---|---|---|
| 🔍 Find a song | Claude Haiku 5.5 + up to 3 web searches | ~$0.02 | free (cached) |
| ✨ Get original tone (🎸 panel) | Claude Haiku 5.5 + up to 4 tone3000.com searches | ~$0.02 | free (cached) |

Each AI button shows the estimate before you click and the actual cost afterwards (computed from the API's usage report), plus this month's total. How cost is kept down:
- **Model choice by measurement.** Both features were run on Haiku 5.5, Sonnet 5.5 and Opus 5.5. Haiku gave equally good matches (e.g. 3 Rectifier captures + 3 Mesa 4x12 IRs for Numb) at about ¼ of Opus's cost; Sonnet cost more and found less.
- **Result cache:** the same question is answered from `.cache/ai-results.json` for 60 days at no cost. Changing a prompt invalidates its old answers.
- **Structured JSON output** (schema-validated), so answers are compact and never need re-asking.
- **Prompt caching** on the tools + system prompt; the multi-step search loop reads the cached prefix.
- **Low effort and capped searches.** Web searches ($0.01 each) are now most of the cost.

Spend is logged in `.cache/ai-ledger.json`.

## Learn a song

- On Ultimate Guitar, open a tab and click **Download Guitar Pro**. Drop the file into the app (`.gp`, `.gp5`, `.gpx`, `.gp7` and MusicXML work).
- Songs stay in your library, saved in the browser's IndexedDB.
- The tone is picked from the track's instrument and the artist. Adjust it, then click **Save tone** so the app remembers it for that song and track.
- **Wait for me** pauses on each note until you play it. **Mute my part** plays only the backing tracks. Drag across bars to loop them.

## Jam

1. **Tonight's band → Edit band.** Add each player with their instrument (electric, acoustic, keys/synth, bass, drums). Mark yourself as **me**, the player the app listens to.
2. Pick a key, scale, progression (or type chords like `Am F C G`), tempo and **feel** (pop/rock, ballad, blues shuffle, funk, reggae).
3. **Solos:** fixed, or rotating every 1/2/4 rounds. Set a player to "Never solos" to keep them on rhythm.
4. Read **The plan** line out to the band, then press **Space**.

Each player gets a card for the current chord:
- **Guitars:** chord box (open or barre) with the next chord beside it, plus a strum pattern with a moving playhead. Electric players also get a lighter top-string triad option.
- **Keys:** keyboard showing the right-hand chord (voiced to move smoothly between chords) and the left-hand root, plus the rhythm.
- **Bass / drums:** note pattern and beat grid.
- **The soloist:** scale, the target notes for this chord and the next, and a tip. When the soloist is you, the phrase guide and fretboard below follow what you play.

**Backing track:** turn on **Backing track** and press Space. You get one bar of count-in clicks, then drums, bass and electric-piano chords play your progression in the chosen feel (with swing for the blues shuffle). By default it plays only the parts nobody in tonight's band covers (e.g. drums + bass when you have a keys player). Click a part to switch it on or off; the slider sets the volume. It follows the chord strip, including manual ←/→ changes.

**Real band / Synth:** the backing band (in Jam and in Lessons) plays recorded instruments by default: an acoustic drum kit, a Jazz bass and a Wurlitzer electric piano, with timing and accents taken from real drummers' grooves for each feel. Next to the backing controls (or under **Guitar & tone → Backing band**) you can switch to **Synth**, the older built-in sounds. The choice is remembered on this device.
- The samples (about 4 MB, 180 Ogg files in `public/samples/band/`) load the first time the band plays, which takes well under a second locally. Until they are decoded, and in browsers that can't play Ogg Vorbis (older Safari), each part plays the synth sound instead, so the band is never silent.
- Beat 1 of every bar is exactly on the grid. The other hits are pushed or pulled by at most 15 ms to follow the drummer's feel, for example a laid-back ballad or the swung "a" of the blues shuffle. Tempo, speed (0.7×, 0.85×), chords, part switches and lesson scoring work exactly as with the synth.
- Credits: the e-piano samples (Greg Sullivan, CC BY 3.0) and the groove data (Magenta Groove MIDI Dataset, CC BY 4.0) require attribution. It is shown under **Guitar & tone → Backing band → Credits** and in [CREDITS.md](CREDITS.md). The drums and bass are CC0.
- To rebuild the samples or grooves from the original packs, see [scripts/samples/README.md](scripts/samples/README.md). The code is in `src/audio/backing.ts` and `src/audio/sampler/`.

Keys: `Space` start/stop, `←`/`→` change chord (turn off Auto-advance to follow the band by hand), `N` new phrase.

### Songs tab

Songs live in their own top tab, **Songs**; **Jam** is for free jamming with your own progressions. Both share the band, the live session and the backing.
- **Set up** a new song with AI, or pick one from **Our songs**: every song you've set up, with its form edits, lyrics and recording.
- A **progress bar** shows the whole song by section (solos in green), with elapsed/total time, on your screen and every phone. Click a section to jump there (with the recording, the record jumps too).
- A song **stops at its end**: after the last section, or when the recording finishes. Everyone's screen shows "🏁 End of song". Free jams keep looping.
- **History** logs every play: when, how long, whether you played it to the end, with or without the record, and who was in the band, with **▶ again**.

### Play a song together

In **Jam**, type a song in **Play a song** (e.g. "Wonderwall Oasis") and click **Set up** (~$0.02 with Haiku 5.5; free when asked again). You get a preview: key, tempo, feel, capo on the original (chords are shown as they sound), the form (Intro → Verse → Chorus…) and each section's chords. Click **▶ Play this song** and the jam runs through the song's form: the chord strip shows the current section and what's next, chords last as long as in the song, and the backing follows. Solos happen in the song's solo sections (rotating per solo section), with a countdown on the phones. **back to free jam** returns to your own progressions. Chords only, no lyrics.

### Singer (🎤 Vocals)

Anyone can join a live session as **🎤 Vocals**. While a song plays, the singer's phone shows the current section's words in large text, the section name, a countdown to the next section ("Chorus in 2 bars") with its first lines, and the key and current chord. To add the words, click **🎤 Lyrics** next to the playing song: **🔎 Find lyrics** opens the song on Genius, copy the lyrics there, then **📋 Paste**. Headings like `[Verse 1]`, `[Chorus]`, `[Guitar Solo]` put each part in the right place (a chorus written once fills every chorus). Without headings, or with messy text, **✨ Arrange with AI** (automatic after Paste, ~$0.0002) maps your lines onto the song's sections: the AI returns only line numbers, so it never writes lyrics, and nothing of the text is stored in the AI cache. Check the preview and **Save lyrics**. The app doesn't fetch or generate lyrics itself; they stay on your Mac and your band's phones.

### Play along with the original recording

Next to a playing song, **🎧 Add your copy of the song** (an MP3/M4A you own) once. The app finds the record's tempo and first beat (tested to within a few ms, with almost no drift over a 4-minute song) and, with **Play with the recording** on, plays it through the speakers instead of the synth backing. Chords, sections, solo countdowns and the singer's words follow the record. If the chords sit a beat off or feel slightly early or late, use **◀ beat / −20 ms / +20 ms / beat ▶** while it plays; it's remembered for the song. The file stays in this browser only.

### Set a song up from a tab (best, and free)

In **Songs**, **🎼 From a tab** lists the Guitar Pro tabs in your Downloads (or choose any `.gp/.gp5/.gpx` file). The song is built from the tab itself, on this Mac, with no AI cost:
- the tab's own section names and exact bar counts (repeats played out), and its tempo
- the chord in every half bar: the tab's chord names when it has them, otherwise worked out from all the parts' notes
- the key, from every note in the tab
- each section's strum pattern and technique, from the guitar part that strums most there
- the words, when the tab's vocal track has them, timed word by word for the singer's karaoke. When the vocal track has the melody but no words, words you paste with 🎤 Lyrics land on its sung phrases. Words you pasted for the same song before are kept.

The preview shows all of this before you use it. Tempo changes inside a tab aren't followed (the song plays at the tab's first tempo).

**Another key for everyone:** **Key − / +** next to the song's name moves the song up or down by half steps (up to 6 either way). Every chord, the key, the solo scale and the backing band change, on your screen and on everyone's phone, and the song remembers it. Going up, guitarists can also keep the original shapes with a capo on that fret (the hint says which). **original key** goes back. The record stays in its own key, so lower or mute it when you play in another key.

**The record's volume:** the 🔊 slider in the recording bar sets how loud the record plays, and 🔇 mutes it. Both work live in the middle of a song, and the volume is remembered.

**Favourites:** ☆ next to a song in **Our songs** stars it. Starred songs stay at the top of the list, and **★ Favourites** shows only them.

### Analyse the recording (chords, bar lines, section lengths)

With a recording added, **🔬 Analyse** listens to it in the browser (a fraction of a second to a few seconds) and finds where bar 1 is, the chord in every bar (major/minor), and where the music changes. It then fits the song's form (Intro, Verse, Chorus…) onto the record, so each section gets its real length, including verses of different lengths. The review shows each section's measured length against the current one, a chord chart, and how well the set-up chords agree with the record. It also names the **key** the record's chords point to and compares it with the set-up's. If it's the relative key (G major against E minor: same notes) it says so and leaves the set-up alone. If it's a half step off, the record is probably tuned down or up. Apply the lengths (recommended) and, optionally, the key heard and the record's own chords. Sections that sound identical (same chords, same energy) can't be told apart; fix those in ✎ Form.

### Karaoke for the singer

The singer's phone shows the current line large, with a fill sweeping across it as it's sung, the previous line dimmed and the next lines coming up. The next line shows early, and in the bar before it starts it lights up blue with four countdown dots, one per beat, so the singer comes in on time.

**Words for the players too.** Every instrument card (on your screen and on bandmates' phones) shows the current line small, with the next one and its countdown underneath, so everyone knows where the song is. **hide words** on any card hides them on that device; **🎤 show words** brings them back.

**Auto-sync to the recording (best).** With the song's recording added and the words pasted (in the order they're sung), **🤖 Auto-sync to the recording** in the sync panel finds when every word is sung: a local helper separates the vocal from your recording (Demucs) and lines all your words up with it in order, over the whole song (WhisperX's models with a CTC forced aligner), so it works even when the song's sections don't match the record yet, the same method the Nightingale karaoke app uses. The singer's screen then follows the record word by word. It takes about a minute per song (results are kept), runs only on this Mac, and the language is picked from the words (change it in the menu if needed). Re-tap any line that's off.

One-time setup of the helper (about 2 GB, plus about 0.4–1.2 GB per language's alignment model on first use), already done on this Mac:

```bash
brew install ffmpeg
python3 -m venv .cache/align-venv
.cache/align-venv/bin/pip install -r server/align/requirements.txt
```

**Sync the words once per song.** Until then each section's lines are spread over it by guesswork. In **Songs**, open **🎤 Sync the words to the song**, play the song (with the recording if you have it) and tap the big button or press **Enter** the moment each line starts; **Backspace** undoes. Taps just before a section starts (pickups) are fine. Click a section on the progress bar to redo just that part. **Save timings** stores them with the song, so they stay right at any tempo and reach every phone in the session.

## Live jam session (bandmates' phones)

Everyone on the same Wi-Fi as your Mac can follow the jam on their own phone:
1. In **Jam**, click **📡 Start live session**. A 4-letter code, a QR code and a link appear (e.g. `http://192.168.0.244:5173/join/TQ9F`).
2. Bandmates scan the QR code (or open the link), enter a name and pick their instrument.
3. They appear in your band automatically. You still run everything (key, chords, tempo, feel, solos, backing); set their solo roles in **Edit band**.

Each phone shows: big **Now → Next** chord, beat bar and count-in, who's soloing ("🎤 Your solo!"), and their own card: chord boxes + strum playhead (guitars), keyboard voicings (keys), bass line or drum grid, or the scale and target notes when it's their solo. Screens follow a shared clock, so chord changes land on the beat on every device. Phones stay awake where the browser allows it.

**Privacy:** other devices on the network can only join and watch the session. The AI features (your API key), the Downloads import, the TONE3000 relay, starting/ending sessions, and files like `.env.local` are refused to anything but this Mac.

## Play a song in your tuning

The **Tuning** menu in Song mode shows the song's tuning (e.g. Drop D♭). Choose **Convert to…** to play it in another tuning:
- **Keep the sound (re-finger):** every note keeps its pitch, so it matches the recording and the backing tracks. Notes too low for your tuning move up an octave, doubled notes are removed, and chords are spread across strings near the current hand position.
- **Keep the fingering:** same frets in the new tuning, so the guitar sounds higher or lower than the record and the backing tracks are muted. This is suggested automatically when every string shifts by the same amount (E♭ → E, Drop D♭ → Drop D).

The choice is remembered per song. Choose the original tuning again to undo.

## Tones and presets

Click the **🎸 button** (top right) in any tab to open the tone builder:
- **My tones:** your saved presets (● = uses a real amp capture). **Starting points** are the built-in tones.
- **Bass guitar** (a starting point) makes your guitar sound like a bass: an octave down through a bass amp. Play the bass line on the low strings, one note at a time (chords turn to mud an octave down). The **Octave ↓** knob blends the octave in on any tone; at 10 only the octave sounds.
- **Amp:** a built-in amp model, or a real amp/pedal capture (**NAM**): **Find amp on TONE3000** or **Import .nam**.
- **Cab:** the built-in cabinet, or a cabinet IR: **Find cab IR on TONE3000** or **Import .wav**. Full-rig captures include the cab.
- EQ, gate, delay, chorus and reverb knobs.
- Name it (e.g. "Livin' It Up") and **Save as new**, or **Update** the preset you're editing.

**✨ Get original tone** (🎸 panel, with a song open): finds the recorded rig and real captures of it on TONE3000, checking that each one still exists and has a version the app can play. Click **Use** next to one: a small TONE3000 window opens (sign in once) and closes by itself, then the app picks a version, sets the EQ and effects, saves it as "<song> – original", sets it for that song, and plays it. Amp-head captures can add a matching cab with one more click.

**Downloading on tone3000.com works too:** the `.zip` lands in Downloads and the app loads a playable version (and any IR) into the current tone automatically.

**TONE3000 setup (once):** the first time you click a TONE3000 button, follow the steps to create a publishable key in your TONE3000 settings, add the redirect URI shown (`http://localhost:5173/tone3000/callback`), and paste the key. After that you pick a tone on TONE3000, come back to the panel, choose a version (e.g. a gain setting) and it loads. Tones you pick are kept locally so they work offline. Creator and license are shown. Powered by TONE3000. A `.nam` file that lands in Downloads also goes onto the current tone.

**In Learn a song,** the Tone row picks which preset each part of the song uses (e.g. Clean → your clean preset, Distortion → "Livin' It Up"). With **Switch with the song** on, the app changes tone at the bars where the tab says so. **Save tone** stores the current 🎸 tone with the song part.

Captures run through TONE3000's open-source NAM engine (A2 captures) at 48 kHz.

## Jam phrases

Phrases you've played move to the right under **Earlier**. Pin any phrase (📌) to add it to **My set**. Drag to reorder, click to play, and turn on **Practise my set** to cycle through your set in order.

## Tuner

A needle that highlights the nearest string, for standard, drop, lowered and open tunings (DADGAD, open G/D/E). It defaults to the tuning the open song needs, including after a conversion. The amp is muted while you tune.

## Lessons

A path from "I can strum a bit on acoustic" to jamming freely on electric: 36 short lessons in 8 worlds (electric basics and muting, single notes, rhythm, power chords and riffs, the minor pentatonic, bends/slides/hammer-ons, call and response, freestyle over the band). Every world ends with a boss lesson.

- **Your dino, Pebble**, starts as an egg and grows one stage each time you beat a world's boss (9 stages). It reacts while you play. Name it on the first visit.
- **Levels and XP** come from stars (1–3 per lesson), clean runs, chains of good hits and the daily goal. Replays the same day earn less, a better score always pays in full. A daily streak keeps going with up to two "nest eggs" for missed days.
- **The runway** reads like tab: one lane per string (high e on top), fret numbers on the notes, scrolling to the gold line. "Nailed it / Good / Early / Late / Missed / Wrong note".
- **Sync first** ("Tap In", 20 s): pluck the open A on each click so the app learns your setup's delay. Do it again after changing audio devices. On Windows this matters, since browser audio there has more delay.
- **Speed 70/85/100%** and **Easy timing** make a lesson easier (for less XP).
- **No guitar?** "Try with the keyboard": Space plays the expected note, Esc pauses. For testing, `?lessons-autoplay=perfect` (or `sloppy`, `silent`) plays lessons by itself.
- **Listen to: Guitar cable / Microphone** on each lesson's start screen. The cable listens to the Scarlett's instrument input; the mic is for an acoustic or an amp in the room (amp sound off, use headphones). "Hearing: A2" shows what the app picks up. A wrong note shows "heard X, wanted Y" under the runway.
- **After each lesson Pebble says** one or two lines comparing your run with real research and records (tapping-study timing by age, song tempos, guitar legends, dinosaurs). Every line comes from a checked source; **Where's this from?** shows it. Add your age in Settings if you like; "timing age" lines only show to adults.
- Progress is kept in this browser, and in your account when you're signed in. **Settings → Export / Import** also backs it up.

Chords are checked from the sound's note content, so a slightly wrong shape costs some credit but still passes. Strum direction is shown, not judged.

## Accounts

**Sign in** (top right) to keep everything in an account: songs and tabs, recordings, tones and presets, history, band, lyrics and timings, phrases, and lessons. Sign in from any browser on this computer, or from a device on your Wi-Fi, and it's all there.

- Accounts live on this computer only, in `.cache/accounts.json` and `.cache/accounts/` (git-ignored). Passwords are stored as scrypt hashes. On the Wi-Fi the connection is plain http, so use a password you don't use anywhere else.
- Changes save about a second after you make them; offline changes go up when the app can reach the server again. A green dot by your name means everything is saved.
- Signing in from a browser that already has guest data: the account's data wins, and the guest data is kept in a local backup. Signing up keeps what this browser has.
- Signing out clears your data from this browser (it stays in the account). Audio devices, latency sync and the theme stay with the browser.

## Theme

The top bar's toggle picks **match device**, **light** or **dark**. Both themes are tuned for long practice: softer text contrast than pure white on black, desaturated note colours that stay distinct for colour-blind players, and larger text.
