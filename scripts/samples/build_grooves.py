"""Extracts per-feel groove templates (timing + velocity per 8th slot) from the Groove MIDI Dataset.

Writes src/audio/sampler/grooves.json. Run with the venv python:
python -I build_grooves.py --zip <groove-v1.0.0-midionly.zip>
"""
import argparse
import csv
import io
import json
import statistics as st
import zipfile
from pathlib import Path

import mido

REPO = Path(__file__).resolve().parents[2]
SWING = 0.665  # where the app puts a swung off-beat, in beats (8th + 0.33 of an 8th; see src/lessons/clock.ts)
MAX_DIST = 0.15  # beats; notes further than this from an 8th slot (16ths, triplet middles) are ignored
CLAMP_MS = 15
MAX_JITTER = 4

KICK = {35, 36}
SNARE = {37, 38, 40}  # head, rim, cross-stick
HAT = {42, 22, 46, 26, 51, 59, 53}  # hats and ride: whatever keeps time

STRAIGHT_POP = {'rock', 'pop', 'pop/groove7', 'rock/groove8', 'rock/indie', 'soul', 'soul/motown'}

# feel id (src/music/parts.ts FEELS) -> (description, row filter, swung)
FEELS = {
    'pop': ('straight rock/pop/soul beats',lambda s, bpm: s in STRAIGHT_POP and 70 <= bpm <= 130, False),
    'ballad': (
        'slow rock/pop/soul beats (60-82 BPM) plus pop/soft and rock/halftime',
        lambda s, bpm: (s in STRAIGHT_POP and bpm <= 82) or s in ('pop/soft', 'rock/halftime'),
        False,
    ),
    'blues': ('shuffle beats (blues/shuffle, rock/shuffle, neworleans/shuffle), measured against the swung grid', lambda s, bpm: s in ('blues/shuffle', 'rock/shuffle', 'neworleans/shuffle'), True),
    'funk': ('funk beats (funk, funk/grooveN, funk/rock, neworleans/funk)', lambda s, bpm: s == 'funk' or s.startswith('funk/groove') or s in ('funk/rock', 'neworleans/funk'), False),
    'reggae': ('reggae beats (reggae, reggae/slow)', lambda s, bpm: s in ('reggae', 'reggae/slow'), False),
}


note = {
    'reggae': '; the dataset reggae beats are mostly steppers (kick on every beat), not a strict one-drop, so the beat-3 accent is not boosted',
}


def hits(data: bytes, swung: bool):
    """Yields (slot 0..7, deviation in ms, piece, velocity) for each drum hit near an 8th slot."""
    mid = mido.MidiFile(file=io.BytesIO(data))
    tpb = mid.ticks_per_beat
    tempo = 500000
    events, t = [], 0
    for msg in mido.merge_tracks(mid.tracks):
        t += msg.time
        if msg.type == 'set_tempo' and t == 0:
            tempo = msg.tempo
        elif msg.type == 'note_on' and msg.velocity > 0:
            events.append((t, msg.note, msg.velocity))
    ms_per_beat = tempo / 1000
    for tick, note, vel in events:
        piece = 'kick' if note in KICK else 'snare' if note in SNARE else 'hat' if note in HAT else None
        if piece is None:
            continue
        beat = tick / tpb
        b = int(beat)
        grid = [(b, 0), (b + SWING if swung else b + 0.5, 1), (b + 1, 0)]
        pos, odd = min(grid, key=lambda g: abs(beat - g[0]))
        if abs(beat - pos) > MAX_DIST:
            continue
        whole = b + 1 if pos == b + 1 else b
        slot = (whole * 2 + odd) % 8
        yield slot, (beat - pos) * ms_per_beat, piece, vel / 127


def mad_std(xs):
    m = st.median(xs)
    return 1.4826 * st.median(abs(x - m) for x in xs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', required=True, help='groove-v1.0.0-midionly.zip')
    ap.add_argument('--out', default=str(REPO / 'src' / 'audio' / 'sampler' / 'grooves.json'))
    a = ap.parse_args()
    z = zipfile.ZipFile(a.zip)
    info = next(n for n in z.namelist() if n.endswith('info.csv'))
    rows = [r for r in csv.DictReader(io.TextIOWrapper(z.open(info), 'utf-8')) if r['beat_type'] == 'beat' and r['time_signature'] == '4-4']
    root = info.rsplit('/', 1)[0] + '/' if '/' in info else ''
    feels = {}
    for fid, (desc, keep, swung) in FEELS.items():
        chosen = [r for r in rows if keep(r['style'], int(r['bpm']))]
        per_file_off = [[] for _ in range(8)]  # per slot: one median per file
        per_file_vel = {p: [[] for _ in range(8)] for p in ('kick', 'snare', 'hat')}
        jitters = []
        counts = {p: [0] * 8 for p in ('kick', 'snare', 'hat')}
        for r in chosen:
            hs = list(hits(z.read(root + r['midi_filename']), swung))
            if len(hs) < 16:
                continue
            for s in range(8):
                devs = [d for slot, d, _p, _v in hs if slot == s]
                if len(devs) >= 4:
                    m = st.median(devs)
                    per_file_off[s].append(m)
                    jitters.append(mad_std(devs))
                for p in per_file_vel:
                    vs = [v for slot, _d, pp, v in hs if slot == s and pp == p]
                    counts[p][s] += len(vs)
                    if len(vs) >= 2:
                        per_file_vel[p][s].append(st.median(vs))
        n_files = len(chosen)
        raw = [st.median(o) if o else 0.0 for o in per_file_off]
        offsets = [0.0] + [round(max(-CLAMP_MS, min(CLAMP_MS, o - raw[0])), 1) for o in raw[1:]]
        vels = {}
        for p, slots in per_file_vel.items():
            meds = [st.median(v) if len(v) >= 2 else None for v in slots]
            known = [m for m in meds if m is not None]
            fallback = round(0.9 * st.median(known), 2) if known else 0.7
            vels[p] = [round(m, 2) if m is not None else fallback for m in meds]
        jitter = round(min(MAX_JITTER, st.median(jitters)), 1) if jitters else 2.0
        drummers = len({r['drummer'] for r in chosen})
        bpms = sorted(int(r['bpm']) for r in chosen)
        thin = '; few files, approximate' if n_files < 8 else ''
        feels[fid] = {
            'offsetsMs': offsets,
            'velocities': vels,
            'jitterMs': jitter,
            'source': f'Groove MIDI Dataset (Google/Magenta, CC BY 4.0): {n_files} {desc}, {drummers} drummers, {bpms[0]}-{bpms[-1]} BPM; median per 8th slot relative to beat 1, clamped to +-{CLAMP_MS} ms{note.get(fid, "")}{thin}',
        }
        print(f'{fid}: {n_files} files, raw offsets {[round(x, 1) for x in raw]}, jitter {jitter}')
        for p in counts:
            print(f'  {p:5s} hits/slot {counts[p]}  vel {vels[p]}')
    # e-kit MIDI velocities run low (kicks ~0.5), so scale each piece by its loudest slot across
    # all feels: accents and feel-to-feel differences stay, the loudest hit becomes 1
    for p in ('kick', 'snare', 'hat'):
        top = max(max(f['velocities'][p]) for f in feels.values())
        for f in feels.values():
            f['velocities'][p] = [round(min(1.0, v / top), 2) for v in f['velocities'][p]]
    out = {'version': 1, 'feels': feels}
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    print('wrote', a.out)


if __name__ == '__main__':
    main()
