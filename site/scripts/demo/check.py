"""Re-transcribes the demo audio with local whisper small and compares it with the script.

Usage: check.py <meeting.mp3> <timings.json>
Fails when the word error rate is 10 percent or more, or when whisper hears the first or last
word of a line more than a second away from the stored timestamps.
"""

import json
import re
import subprocess
import sys
from difflib import SequenceMatcher

from faster_whisper import WhisperModel

MAX_WER = 0.10
MAX_DRIFT_S = 1.0
NUMBERS = {"3rd": "third", "2": "two"}

audio_path, timings_path = sys.argv[1:3]
timings = json.loads(open(timings_path).read())
lines = timings["lines"]
probed = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio_path],
    capture_output=True, text=True, check=True,
)
if abs(float(probed.stdout) - timings["duration"]) > 0.15:
    sys.exit(f"mp3 lasts {float(probed.stdout):.2f}s, timings say {timings['duration']}s")


def words(text: str) -> list[str]:
    return [NUMBERS.get(w, w) for w in re.findall(r"[a-z0-9']+", text.lower())]


segments, _ = WhisperModel("small", compute_type="int8").transcribe(
    audio_path, language="en", word_timestamps=True
)
heard = [(w.start, w.end, word) for s in segments for w in s.words for word in words(w.word)]

expected, owner = [], []
for index, line in enumerate(lines):
    for word in words(line["text"]):
        expected.append(word)
        owner.append(index)

matcher = SequenceMatcher(None, expected, [h[2] for h in heard], autojunk=False)
errors = len(expected) + len(heard)
matched = {}
for block in matcher.get_matching_blocks():
    errors -= 2 * block.size
    for offset in range(block.size):
        matched[block.a + offset] = heard[block.b + offset]
wer = (errors / 2) / len(expected)
print(f"WER {wer:.1%} over {len(expected)} words")

failed = wer >= MAX_WER
for index, line in enumerate(lines):
    spans = [matched[i] for i, o in enumerate(owner) if o == index and i in matched]
    if not spans:
        print(f"line {index + 1}: no words heard")
        failed = True
        continue
    start_drift = abs(spans[0][0] - line["start"])
    end_drift = abs(spans[-1][1] - line["end"])
    if max(start_drift, end_drift) > MAX_DRIFT_S:
        print(f"line {index + 1}: drift {start_drift:.2f}s start, {end_drift:.2f}s end")
        failed = True
sys.exit("demo audio check failed" if failed else 0)
