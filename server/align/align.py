"""Lines the song's words up with the singing on the user's own recording.

1. Separates the lead vocal from the recording (Demucs htdemucs), cached per recording.
2. Force-aligns all the words, in order, against the whole vocal track (WhisperX's wav2vec2 models,
   torchaudio's CTC aligner), giving a start time for every word.

Usage: align.py job.json   (prints the result as JSON on stdout)
job: {"audio": path, "cache": dir, "language": "en", "segments": [{"start": s, "end": s, "text": "..."}]}
"""

import json
import os
import subprocess
import sys
import time

import numpy as np
import torch

ALIGN_SR = 16000


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def decode(path, sr, channels):
    """Any audio file as float32 samples (channels x n), via ffmpeg."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", str(channels), "-ar", str(sr), "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(out, np.float32).reshape(-1, channels).T.copy()


def separate_vocals(path, cache):
    """The lead vocal as mono 16 kHz samples (cached next to the recording)."""
    cached = os.path.join(cache, os.path.basename(path) + ".vocals16k.npy")
    if os.path.exists(cached):
        return np.load(cached)
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    import julius

    model = get_model("htdemucs")
    model.eval()
    wav = torch.from_numpy(decode(path, model.samplerate, 2))
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std
    sources = None
    for device in (["mps"] if torch.backends.mps.is_available() else []) + ["cpu"]:
        try:
            t = time.time()
            with torch.no_grad():
                sources = apply_model(model, wav[None], device=device, split=True, overlap=0.25, progress=False)[0]
            log(f"vocals separated on {device} in {time.time() - t:.0f}s")
            break
        except Exception as err:  # some ops aren't on Apple's GPU yet: fall back to the CPU
            log(f"separation on {device} failed ({err}); trying the next device")
    if sources is None:
        raise RuntimeError("vocal separation failed")
    vocals = (sources[model.sources.index("vocals")] * std + mean).mean(0)
    vocals16 = julius.resample_frac(vocals.float(), model.samplerate, ALIGN_SR).numpy().astype(np.float32)
    np.save(cached, vocals16)
    return vocals16


FRAME = 320  # wav2vec2: one frame per 320 samples (20 ms at 16 kHz)


def emissions(model, meta, wav):
    """Log-probabilities of every character for the whole track, in 15 s chunks with 1 s of context each side."""
    chunk, ctx = FRAME * 750, FRAME * 50
    total = len(wav) // FRAME
    parts = []
    for s in range(0, len(wav), chunk):
        a, b = max(0, s - ctx), min(len(wav), s + chunk + ctx)
        x = torch.from_numpy(wav[a:b].copy())[None]
        with torch.inference_mode():
            e = model(x)[0] if meta["type"] == "torchaudio" else model(x).logits
            e = torch.log_softmax(e, dim=-1)[0]
        i0 = (s - a) // FRAME
        n = min(chunk // FRAME, total - s // FRAME)
        part = e[i0 : i0 + n]
        if part.shape[0] < n:  # the last chunk can come out a frame short: repeat its last frame
            part = torch.cat([part, part[-1:].repeat(n - part.shape[0], 1)])
        parts.append(part)
    return torch.cat(parts)


def align(vocals, language, segments):
    """Start/end of every word, aligned against the whole vocal track at once (the words in order), so it
    doesn't depend on the song's sections lining up with the record. Returned per segment, as sent."""
    import torchaudio.functional as F
    import whisperx

    model, meta = whisperx.load_align_model(language_code=language, device="cpu")
    vocab = meta["dictionary"]
    blank = next((i for c, i in vocab.items() if c in ("[pad]", "<pad>")), 0)
    sep = vocab.get("|")

    seg_words = [seg["text"].split() for seg in segments]
    words = [w for ws in seg_words for w in ws]
    # The characters the model knows, each tagged with its word; a word separator between words.
    tokens, owner = [], []
    for wi, w in enumerate(words):
        chars = [vocab[c] for c in w.lower() if c in vocab and c != "|"]
        if not chars:
            continue
        if tokens and sep is not None:
            tokens.append(sep)
            owner.append(-1)
        tokens += chars
        owner += [wi] * len(chars)
    placed = [None] * len(words)
    if tokens:
        em = emissions(model, meta, vocals)
        t = time.time()
        path, scores = F.forced_align(em[None], torch.tensor([tokens], dtype=torch.int32), blank=blank)
        spans = F.merge_tokens(path[0], scores[0].exp())
        log(f"aligned {len(words)} words over {em.shape[0] * FRAME / ALIGN_SR:.0f}s in {time.time() - t:.1f}s")
        sec = FRAME / ALIGN_SR
        for span, wi in zip(spans, owner):
            if wi < 0:
                continue
            p = placed[wi]
            start, end = span.start * sec, span.end * sec
            if p is None:
                placed[wi] = {"start": round(start, 3), "end": round(end, 3), "score": [span.score]}
            else:
                p["end"] = round(end, 3)
                p["score"].append(span.score)
        for p in placed:
            if p:
                p["score"] = round(float(np.mean(p["score"])), 3)
    out, k = [], 0
    for ws in seg_words:
        out.append({"words": placed[k : k + len(ws)]})
        k += len(ws)
    return out


def main():
    job = json.load(open(sys.argv[1]))
    # Libraries print downloads and progress to stdout; keep stdout for the result alone.
    result_out = sys.stdout
    sys.stdout = sys.stderr
    t = time.time()
    vocals = separate_vocals(job["audio"], job["cache"])
    result = align(vocals, job.get("language", "en"), job["segments"])
    json.dump({"segments": result, "seconds": round(time.time() - t, 1)}, result_out)


if __name__ == "__main__":
    main()
