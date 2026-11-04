"""Builds the sampled backing band: public/samples/band/*.ogg + manifest.json.

Reads three free sample packs (see README.md), picks a small set of one-shots, mixes the drum
mics to mono, re-pitches the e-piano onto an even grid, trims, fades, normalises and writes
Ogg Vorbis. Run with the venv python: python -I build_band.py --src <packs dir>
"""
import argparse
import json
import re
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

REPO = Path(__file__).resolve().parents[2]
SR = 44100
PEAK = 10 ** (-1 / 20)  # -1 dBFS
QUALITY = 0.45  # libsndfile compression level for Vorbis (lower = better); ~0.45 gives ~96-112 kbps mono

# ---- small helpers -------------------------------------------------------------------------


def load(path: Path) -> np.ndarray:
    x, sr = sf.read(str(path), dtype='float64', always_2d=True)
    if sr != SR:
        raise SystemExit(f'{path}: expected {SR} Hz, got {sr}')
    return x.mean(axis=1)


def db(x: float) -> float:
    return 10 ** (x / 20)


def envelope(x: np.ndarray, win: int = 512) -> np.ndarray:
    """Peak envelope over short blocks, one value per sample."""
    n = int(np.ceil(len(x) / win))
    pad = np.zeros(n * win)
    pad[: len(x)] = np.abs(x)
    blocks = pad.reshape(n, win).max(axis=1)
    return np.repeat(blocks, win)[: len(x)]


def trim(x: np.ndarray, start_db: float, end_db: float, max_sec: float, fade_sec: float, pre_ms: float = 0.5) -> np.ndarray:
    """Cuts leading silence (keeps `pre_ms` before the onset), the tail below `end_db` (relative
    to the peak) and anything past `max_sec`, then fades in 0.5 ms and fades out `fade_sec`."""
    peak = np.max(np.abs(x)) or 1.0
    above = np.nonzero(np.abs(x) >= peak * db(start_db))[0]
    s = max(0, int(above[0]) - int(SR * pre_ms / 1000)) if len(above) else 0
    x = x[s:]
    env = envelope(x)
    loud = np.nonzero(env >= peak * db(end_db))[0]
    e = int(loud[-1]) + 1 if len(loud) else len(x)
    e = min(e, int(max_sec * SR))
    x = x[:e].copy()
    fi = min(len(x), max(1, int(SR * 0.0005)))
    x[:fi] *= np.linspace(0, 1, fi)
    fo = min(len(x), int(SR * fade_sec))
    if fo > 1:
        x[-fo:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo))
    return x


def resample(x: np.ndarray, rate: float, taps: int = 24) -> np.ndarray:
    """Plays `x` back `rate` times faster (pitch up by log2(rate) octaves), windowed-sinc."""
    if abs(rate - 1) < 1e-9:
        return x.copy()
    m = int(len(x) / rate)
    pos = np.arange(m) * rate
    i0 = np.floor(pos).astype(np.int64)
    frac = pos - i0
    fc = min(1.0, 1.0 / rate) * 0.97
    out = np.zeros(m)
    for k in range(-taps + 1, taps + 1):
        idx = i0 + k
        d = k - frac
        w = fc * np.sinc(fc * d) * (0.5 + 0.5 * np.cos(np.pi * d / taps))
        ok = (idx >= 0) & (idx < len(x))
        out[ok] += x[idx[ok]] * w[ok]
    return out


def parse_sfz(path: Path) -> list[dict]:
    """Minimal SFZ reader: #define, <group>/<region> inheritance, key=value opcodes.
    Good enough for the two flat mappings used here (no includes, no spaces in names)."""
    text = path.read_text(encoding='utf-8', errors='replace')
    defines = dict(re.findall(r'#define\s+(\$\w+)\s+(\S+)', text))
    for k in sorted(defines, key=len, reverse=True):
        text = text.replace(k, defines[k])
    text = re.sub(r'//[^\n]*', '', text)
    regions, group, cur = [], {}, None
    for tok in re.finditer(r'<(\w+)>|(\w+)=(\S+)', text):
        if tok.group(1):
            h = tok.group(1)
            if cur is not None:
                regions.append(cur)
                cur = None
            if h == 'group':
                group = {}
            elif h == 'region':
                cur = dict(group)
            elif h in ('control', 'global', 'master'):
                group = {}
            continue
        k, v = tok.group(2), tok.group(3)
        (cur if cur is not None else group)[k] = v
    if cur is not None:
        regions.append(cur)
    return regions


def write_ogg(path: Path, x: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.clip(x, -1, 1).astype(np.float32), SR, format='OGG', subtype='VORBIS', compression_level=QUALITY)


# ---- drums ---------------------------------------------------------------------------------
# Unruly Drums, 'kit-sticks' pieces. Mono mix per hit: close mics up front, a little room from the
# overheads (dry-ish and tight). Mic files of one hit are sample-aligned, so they are summed as is.

DRUMS = {
    # piece: (folder, file prefix, {mic: weight}, max seconds)
    'kick': ('k20', 'kick_clean', {'out': 1.0, 'in': 0.6, 'oh': 0.3}, 1.2),
    'snare': ('s14', 's14_center', {'top': 1.0, 'btm': 0.35, 'ohl': 0.25, 'ohr': 0.25}, 1.2),
    'hatClosed': ('h14', 'hh_closed_tip', {'cl': 1.0, 'ohl': 0.2, 'ohr': 0.2}, 0.6),
    'hatOpen': ('h14', 'hh_open_tip', {'cl': 1.0, 'ohl': 0.2, 'ohr': 0.2}, 1.6),
    'ride': ('r20', 'ride_bow', {'cl': 1.0, 'oh': 0.5}, 2.5),
    'crash': ('c16', 'cr_edge', {'cl': 0.7, 'oh': 1.0}, 3.0),
    'rimshot': ('s14', 's14_sstick', {'top': 1.0, 'btm': 0.2, 'ohl': 0.2, 'ohr': 0.2}, 0.6),  # cross-stick
    'tomHigh': ('s13', 's13_tom_clean', {'top': 1.0, 'ohl': 0.25, 'ohr': 0.25}, 1.5),
    'tomLow': ('s22', 's22_tom_clean', {'top': 1.0, 'ohl': 0.25, 'ohr': 0.25}, 1.5),
}
DRUM_PICK = [0.4, 0.62, 0.82, 1.0]  # which of the N recorded layers to keep (share of N)
DRUM_RR = [1, 2]


def build_drums(src: Path, out: Path) -> dict:
    root = src / 'karoryfer.unruly-drums' / 'Samples'
    pieces = {}
    for piece, (folder, prefix, mics, max_sec) in DRUMS.items():
        mic0 = next(iter(mics))
        n = len(list((root / folder / mic0 / 'rr1').glob(f'{prefix}_vl*_rr1.flac')))
        if n == 0:
            raise SystemExit(f'no samples for {piece}')
        picks = sorted({max(1, round(n * f)) for f in DRUM_PICK})
        hits = []  # (layer index, rr, audio)
        for li, vl in enumerate(picks):
            for rr in DRUM_RR:
                mix = None
                for mic, w in mics.items():
                    x = load(root / folder / mic / f'rr{rr}' / f'{prefix}_vl{vl}_rr{rr}.flac') * w
                    if mix is None:
                        mix = x
                    else:
                        m = max(len(mix), len(x))
                        mix = np.pad(mix, (0, m - len(mix))) + np.pad(x, (0, m - len(x)))
                hits.append((li, rr, trim(mix, -40, -58, max_sec, min(0.25, max_sec / 4), pre_ms=0.3)))
        # one gain per piece: the loudest layer peaks at -1 dBFS, softer layers stay softer
        gain = PEAK / max(np.max(np.abs(h[2])) for h in hits)
        layers = []
        for li, vl in enumerate(picks):
            files = []
            for li2, rr, x in hits:
                if li2 != li:
                    continue
                name = f'drums/{piece}_v{li + 1}_r{rr}.ogg'
                write_ogg(out / name, x * gain)
                files.append(name)
            layers.append({'vel': 127 if vl == n else round(vl * 127 / n), 'files': files})
        pieces[piece] = {'layers': layers}
        print(f'drums {piece}: {n} layers in pack, kept vl{picks}')
    return {'pieces': pieces}


# ---- bass ----------------------------------------------------------------------------------
# Growlybass 'clean' mapping (sustain folder). The pack names notes an octave up (e2 = E1, MIDI
# 28; checked by pitch), so the real MIDI note is the SFZ key centre minus 12.

BASS_LAYERS = [('p', 64), ('f', 100), ('ff', 127)]
BASS_RR = [1, 2]
BASS_RANGE = (28, 57)  # E1..A3 roots, so notes up to G3 and a bit beyond are close to a root
# Pitch fixes in cents per root: the open E1 recordings are about 25 cents sharp all the way
# through (YIN in the browser, both round robins, 0.15-1 s), the pack has no tune for them.
BASS_TUNE = {28: -25}


def zones_for(roots: list[int], lo: int, hi: int) -> list[tuple[int, int, int]]:
    out = []
    for i, r in enumerate(roots):
        a = lo if i == 0 else (roots[i - 1] + r) // 2 + 1
        b = hi if i == len(roots) - 1 else (r + roots[i + 1]) // 2
        out.append((r, a, b))
    return out


def build_bass(src: Path, out: Path) -> dict:
    pack = src / 'karoryfer.growlybass'
    regions = [r for r in parse_sfz(pack / 'growlybass_clean.sfz') if r.get('sample', '').startswith('sustain')]
    by_root: dict[int, dict[tuple[str, int], str]] = {}
    for r in regions:
        m = re.match(r'sustain\\([a-g]b?\d)_(pp|p|f|ff)_rr(\d)\.wav', r['sample'])
        if not m:
            continue
        key = int(r.get('pitch_keycenter', (int(r['lokey']) + int(r['hikey'])) // 2))
        by_root.setdefault(key - 12, {})[(m.group(2), int(m.group(3)))] = r['sample'].replace('\\', '/')
    roots = [k for k in sorted(by_root) if BASS_RANGE[0] <= k <= BASS_RANGE[1]]
    rendered = []
    for root in roots:
        for li, (dyn, _vel) in enumerate(BASS_LAYERS):
            for rr in BASS_RR:
                x = load(pack / by_root[root][(dyn, rr)])
                x = resample(x, 2 ** (BASS_TUNE.get(root, 0) / 1200))
                rendered.append((root, li, rr, trim(x, -36, -60, 2.5, 0.35, pre_ms=1.0)))
    gain = PEAK / max(np.max(np.abs(r[3])) for r in rendered)
    zones = []
    for root, lo, hi in zones_for(roots, 23, 62):
        layers = []
        for li, (_dyn, vel) in enumerate(BASS_LAYERS):
            files = []
            for root2, li2, rr, x in rendered:
                if root2 == root and li2 == li:
                    name = f'bass/b{root}_v{li + 1}_r{rr}.ogg'
                    write_ogg(out / name, x * gain)
                    files.append(name)
            layers.append({'vel': vel, 'files': files})
        zones.append({'root': root, 'lo': lo, 'hi': hi, 'layers': layers})
    print(f'bass: roots {roots}')
    return {'zones': zones}


# ---- keys ----------------------------------------------------------------------------------
# Wurlitzer EP200. The pack's velocity groups use different sample notes, so every layer is
# re-pitched at build time onto one shared root per zone (also applying the mapping's tune and
# volume fixes). Zones every 3 semitones; the app plays MIDI 48..76.

KEYS_LAYERS = [('mp', 64), ('f', 100), ('ff', 127)]
KEYS_ROOTS = list(range(45, 85, 3))  # A2..C6


def build_keys(src: Path, out: Path) -> dict:
    pack = src / 'GregSullivan.E-Pianos' / 'Wurlitzer EP200'
    regions = parse_sfz(pack / 'Wurlitzer EP200.sfz')
    rendered = []
    for root in KEYS_ROOTS:
        for li, (label, _vel) in enumerate(KEYS_LAYERS):
            reg = next(r for r in regions if r.get('group_label') == label and int(r['lokey']) <= root <= int(r['hikey']))
            kc = int(reg['pitch_keycenter'])
            cents = (root - kc) * 100 + float(reg.get('tune', 0))
            x = load(pack / 'Samples' / reg['sample'])
            # the pack's layers are each normalised (the SFZ adds dynamics with amp_veltrack), so
            # bake a gentle linear velocity gain in to keep soft layers softer
            x = resample(x, 2 ** (cents / 1200)) * db(float(reg.get('volume', 0))) * KEYS_LAYERS[li][1] / 127
            # -26 dB start: some ff notes have a quiet key noise before the tone. The fade lengths
            # (here and for bass) are mirrored in FILE_FADE in src/audio/backing.ts.
            rendered.append((root, li, trim(x, -26, -60, 3.0, 0.6, pre_ms=1.0), reg['sample']))
    gain = PEAK / max(np.max(np.abs(r[2])) for r in rendered)
    zones = []
    for root, lo, hi in zones_for(KEYS_ROOTS, 36, 96):
        layers = []
        for li, (_label, vel) in enumerate(KEYS_LAYERS):
            x = next(r[2] for r in rendered if r[0] == root and r[1] == li)
            name = f'keys/k{root}_v{li + 1}.ogg'
            write_ogg(out / name, x * gain)
            layers.append({'vel': vel, 'files': [name]})
        zones.append({'root': root, 'lo': lo, 'hi': hi, 'layers': layers})
    print(f'keys: roots {KEYS_ROOTS}')
    return {'name': 'Wurlitzer EP200', 'zones': zones}


CREDITS = [
    {
        'name': 'Unruly Drums',
        'author': 'Karoryfer Samples (Karoryfer Lecolds)',
        'licence': 'CC0 1.0 Universal',
        'url': 'https://github.com/sfzinstruments/karoryfer.unruly-drums',
        'licenceUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
        'changes': 'Selected hits (4 velocity layers, 2 round robins per piece), close and overhead mics mixed to mono, trimmed, faded, normalised, converted to Ogg Vorbis.',
    },
    {
        'name': 'Growlybass',
        'author': 'Karoryfer Samples (Karoryfer Lecolds)',
        'licence': 'CC0 1.0 Universal',
        'url': 'https://github.com/sfzinstruments/karoryfer.growlybass',
        'licenceUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
        'changes': 'Selected sustained notes (3 velocity layers, 2 round robins), E1 notes re-tuned 25 cents down, trimmed to 2.5 s with a fade, normalised, converted to Ogg Vorbis.',
    },
    {
        'name': 'Wurlitzer EP200 Electric Piano (Greg Sullivan E-Pianos)',
        'author': 'Greg Sullivan (http://www.sullivang.net/); SFZ mapping by kinwie',
        'licence': 'CC BY 3.0 Unported',
        'url': 'https://github.com/sfzinstruments/GregSullivan.E-Pianos',
        'licenceUrl': 'https://creativecommons.org/licenses/by/3.0/',
        'changes': 'Samples were trimmed to 3 s with a fade, re-pitched onto a 3-semitone grid, level-matched, normalised and converted from FLAC to Ogg Vorbis.',
    },
    {
        'name': 'Groove MIDI Dataset',
        'author': 'Google LLC (Magenta)',
        'licence': 'CC BY 4.0',
        'url': 'https://magenta.tensorflow.org/datasets/groove',
        'licenceUrl': 'https://creativecommons.org/licenses/by/4.0/',
        'changes': 'Groove timing and velocity templates extracted (median per 8th-note slot per style); no MIDI files are included.',
    },
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='folder holding the downloaded packs')
    ap.add_argument('--out', default=str(REPO / 'public' / 'samples' / 'band'))
    a = ap.parse_args()
    src, out = Path(a.src), Path(a.out)
    for sub in ('drums', 'bass', 'keys'):
        if (out / sub).exists():
            shutil.rmtree(out / sub)
    manifest = {
        'version': 1,
        'instruments': {'drums': build_drums(src, out), 'bass': build_bass(src, out), 'keys': build_keys(src, out)},
        'credits': CREDITS,
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    files = list(out.rglob('*.ogg'))
    total = sum(f.stat().st_size for f in files)
    print(f'{len(files)} files, {total / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
