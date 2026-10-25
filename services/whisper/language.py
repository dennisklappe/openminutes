import numpy as np
from faster_whisper.vad import get_speech_timestamps

SAMPLE_RATE = 16_000
WINDOWS = 7
WINDOW_SECONDS = 30
MIN_CONFIDENCE = 0.5


def speech_windows(audio: np.ndarray) -> list[np.ndarray]:
    """Up to WINDOWS slices of WINDOW_SECONDS, evenly spread over the speech only, so a silent
    start, music or a long pause cannot decide the language."""
    voiced = [audio[t["start"] : t["end"]] for t in get_speech_timestamps(audio)]
    if not voiced:
        return []
    speech = np.concatenate(voiced)
    size = WINDOW_SECONDS * SAMPLE_RATE
    count = max(1, min(WINDOWS, len(speech) // size))
    starts = np.linspace(0, max(0, len(speech) - size), count).astype(int)
    return [speech[start : start + size] for start in starts]


def detect(whisper, audio: np.ndarray) -> dict:
    """Majority vote over the windows, each weighted by its own certainty. The confidence is the
    winner's share of all votes; below MIN_CONFIDENCE no language is named."""
    scores: dict[str, float] = {}
    for window in speech_windows(audio):
        language, probability, _ = whisper.detect_language(window)
        scores[language] = scores.get(language, 0.0) + probability
    total = sum(scores.values())
    if not total:
        return {"language": None, "confidence": 0.0}
    language, score = max(scores.items(), key=lambda item: item[1])
    confidence = score / total
    return {
        "language": language if confidence >= MIN_CONFIDENCE else None,
        "confidence": confidence,
    }
