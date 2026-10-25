"""Renders a scripted meeting with piper voices into one mono wav and a truth file.

Usage: synth.py <script.json> <voices dir> <out dir>
The script is {"voices": {speaker: voice}, "gains": {speaker: volume}?, "utterances": [{speaker, text, gapMs, interjection?}]}.
gapMs is the pause after the previous utterance ended, negative when the speakers overlap.
Writes meeting.wav (16 kHz) and truth.json with the spoken interval of every utterance.
"""

import json
import sys
import wave
from pathlib import Path

import numpy as np
from piper import PiperVoice

RATE = 16_000
SILENCE_FLOOR = 0.02

script_path, voices_dir, out_dir = (Path(arg) for arg in sys.argv[1:4])
script = json.loads(script_path.read_text())
voices: dict[str, PiperVoice] = {}


def render(speaker: str, text: str) -> np.ndarray:
    name = script["voices"][speaker]
    voice = voices.setdefault(name, PiperVoice.load(voices_dir / f"{name}.onnx"))
    chunks = [chunk.audio_float_array for chunk in voice.synthesize(text)]
    audio = np.concatenate(chunks)
    resampled = np.interp(
        np.arange(0, len(audio) * RATE / voice.config.sample_rate), 
        np.arange(len(audio)) * RATE / voice.config.sample_rate,
        audio,
    )
    loud = np.flatnonzero(np.abs(resampled) > SILENCE_FLOOR * np.abs(resampled).max())
    gain = script.get("gains", {}).get(speaker, 1.0)
    return resampled[loud[0] : loud[-1] + 1] * 0.8 * gain


placed = []
cursor = 0
for utterance in script["utterances"]:
    audio = render(utterance["speaker"], utterance["text"])
    start = max(0, cursor + round(utterance["gapMs"] * RATE / 1000))
    placed.append((utterance, audio, start))
    cursor = start + len(audio)

mix = np.zeros(cursor + RATE)
for _, audio, start in placed:
    mix[start : start + len(audio)] += audio
mix /= max(1.0, np.abs(mix).max())

out_dir.mkdir(parents=True, exist_ok=True)
with wave.open(str(out_dir / "meeting.wav"), "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes((mix * 32767).astype(np.int16).tobytes())

truth = [
    {
        "speaker": utterance["speaker"],
        "text": utterance["text"],
        "startMs": round(start * 1000 / RATE),
        "endMs": round((start + len(audio)) * 1000 / RATE),
        "interjection": bool(utterance.get("interjection")),
    }
    for utterance, audio, start in placed
]
(out_dir / "truth.json").write_text(json.dumps(truth))
