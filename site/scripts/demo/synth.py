"""Renders the demo meeting with piper voices into one mp3 and a timing file.

Usage: synth.py <script.json> <voices dir> <out dir>
Run it with a Python that has piper-tts and numpy, and ffmpeg on the PATH.
Writes meeting.mp3 and timings.json with the spoken interval of every line, computed from
the real sample counts, so the transcript highlight in the demo is exactly in sync.
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from piper import PiperVoice

RATE = 24_000
SILENCE_FLOOR = 0.02
LEAD_MS = 250

script_path, voices_dir, out_dir = (Path(arg) for arg in sys.argv[1:4])
script = json.loads(script_path.read_text())
voices: dict[str, PiperVoice] = {}


def render(speaker: str, text: str) -> np.ndarray:
    name = script["voices"][speaker]
    voice = voices.setdefault(name, PiperVoice.load(voices_dir / f"{name}.onnx"))
    audio = np.concatenate([chunk.audio_float_array for chunk in voice.synthesize(text)])
    source = np.arange(len(audio)) * RATE / voice.config.sample_rate
    resampled = np.interp(np.arange(0, source[-1]), source, audio)
    loud = np.flatnonzero(np.abs(resampled) > SILENCE_FLOOR * np.abs(resampled).max())
    return resampled[loud[0] : loud[-1] + 1] * 0.8


def ms_to_samples(ms: int) -> int:
    return round(ms * RATE / 1000)


gap = np.zeros(ms_to_samples(script["gapMs"]))
pieces = [np.zeros(ms_to_samples(LEAD_MS))]
cursor = len(pieces[0])
timings = []
for speaker, text in script["lines"]:
    audio = render(speaker, text)
    timings.append(
        {
            "speaker": speaker,
            "text": text,
            "start": round(cursor / RATE, 2),
            "end": round((cursor + len(audio)) / RATE, 2),
        }
    )
    pieces += [audio, gap]
    cursor += len(audio) + len(gap)

mix = np.concatenate(pieces)
mix /= max(1.0, np.abs(mix).max())
out_dir.mkdir(parents=True, exist_ok=True)
subprocess.run(
    ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "-",
     "-c:a", "libmp3lame", "-b:a", "40k", str(out_dir / "meeting.mp3")],
    input=(mix * 32767).astype(np.int16).tobytes(),
    check=True,
)
duration = round(len(mix) / RATE, 2)
(out_dir / "timings.json").write_text(json.dumps({"duration": duration, "lines": timings}, indent=1) + "\n")
print(f"{len(timings)} lines, {duration}s")
