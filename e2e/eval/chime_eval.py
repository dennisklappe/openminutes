#!/usr/bin/env python3
"""Join-tone check: prepends synthetic Meet/Teams style chimes to piper speech and counts how often
the transcript starts with something that was not said, before and after services/whisper/tones.py.

Usage: chime_eval.py [model ...]   (default: tiny small). Needs the e2e venv (faster-whisper, piper, scipy).
"""
import itertools, os, sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from faster_whisper import WhisperModel
from piper import PiperVoice
from scipy.signal import butter, lfilter

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/whisper"))
import tones

R = 16000
VOICES = Path(os.environ.get("E2E_CACHE", "~/.cache/openminutes-e2e")).expanduser() / "voices"
PROMPT = "So, where were we? Right. Let's continue with the next point."
SENTENCES = {
    "good": "Good morning everyone, let's get started with the agenda.",
    "hi": "Hi all, can you hear me okay?",
    "welcome": "Welcome to the weekly sync, thanks for joining.",
}
rng = np.random.default_rng(1)


def tts(text):
    voice = PiperVoice.load(VOICES / "en_US-ryan-medium.onnx")
    a = np.concatenate([c.audio_float_array for c in voice.synthesize(text)])
    a = np.interp(np.arange(0, len(a) * R / voice.config.sample_rate), np.arange(len(a)) * R / voice.config.sample_rate, a)
    return (a / np.abs(a).max() * 0.5).astype(np.float32)


def tone(f, d, amp=0.3):
    t = np.arange(int(d * R)) / R
    return (amp * np.minimum(1, t / 0.01) * np.exp(-t * 6) * (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t))).astype(np.float32)


def glide(f0, f1, d, amp=0.4):
    t = np.arange(int(d * R)) / R
    phase = 2 * np.pi * np.cumsum(f0 + (f1 - f0) * t / d) / R
    env = np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.05)
    return (amp * env * (np.sin(phase) + 0.5 * np.sin(2 * phase) + 0.25 * np.sin(3 * phase))).astype(np.float32)


def noisy(c):
    b, a = butter(2, [800 / 8000, 3000 / 8000], "band")
    return c + 0.15 * lfilter(b, a, rng.standard_normal(len(c))).astype(np.float32) * np.abs(c).max()


bloop = np.concatenate([glide(400, 700, 0.15), glide(700, 500, 0.25)])
CHIMES = {
    "two-tone": np.concatenate([tone(660, 0.18), tone(880, 0.29)]),
    "low two-tone": np.concatenate([tone(440, 0.18), tone(660, 0.29)]),
    "bell": tone(784, 0.6, 0.5) + tone(1568, 0.6, 0.2),
    "ding-dong": np.concatenate([tone(988, 0.35, 0.5), tone(740, 0.5, 0.5)]),
    "bloop": bloop,
    "noisy bloop": noisy(bloop),
}


def room(n, level):
    b, a = butter(1, 600 / 8000, "low")
    return level * 3 * lfilter(b, a, rng.standard_normal(n)).astype(np.float32)


def starts_with(segments, expected):
    text = " ".join(s["text"] for s in segments).lower().replace(",", "")
    return text.startswith(expected)


def segment_json(s, audio):
    words = s.words or []
    if tones.stray_lead(audio, words):
        words = words[1:]
    return {"text": "".join(w.word for w in words).strip() if words else s.text.strip()}


def main():
    speech = {k: tts(t) for k, t in SENTENCES.items()}
    for name in sys.argv[1:] or ["tiny", "small"]:
        model = WhisperModel(name, device="cpu", compute_type="int8")
        total = raw_bad = fixed_bad = 0
        for (cname, chime), gap, key, level in itertools.product(CHIMES.items(), [0.1, 0.4, 1.2], SENTENCES, [0.0, 0.01, 0.03]):
            audio = np.concatenate([np.zeros(R // 2, np.float32), chime, np.zeros(int(gap * R), np.float32), speech[key], np.zeros(R, np.float32)])
            audio = audio + room(len(audio), level) + 0.002 * rng.standard_normal(len(audio)).astype(np.float32)
            segments, _ = model.transcribe(audio, language="en", initial_prompt=PROMPT, vad_filter=True, word_timestamps=True)
            segments = list(segments)
            total += 1
            raw_bad += not starts_with([{"text": s.text.strip()} for s in segments], key)
            fixed_bad += not starts_with([segment_json(s, audio) for s in segments], key)
        print(f"{name}: {total} chime recordings, transcript starts with an invented word: {raw_bad} before, {fixed_bad} after")


if __name__ == "__main__":
    main()
