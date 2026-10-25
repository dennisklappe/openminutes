import numpy as np

SAMPLE_RATE = 16_000
MIN_GAP_S = 0.15
MAX_LETTERS = 5
LOW_PROBABILITY = 0.5
MIN_STRETCH_S = 0.5
PURE_TONE_FLATNESS = 1e-4
FRAME = 400
HOP = 160


def spectral_flatness(samples: np.ndarray) -> float | None:
    """Median over the audible frames of geometric over arithmetic mean of the power spectrum:
    near 0 for a pure tone, higher for speech and noise. None when there is nothing to measure."""
    frames = [samples[i : i + FRAME] for i in range(0, len(samples) - FRAME, HOP)]
    if not frames:
        return None
    window = np.hanning(FRAME)
    energy = np.array([np.sum(frame**2) for frame in frames])
    values = []
    for frame, level in zip(frames, energy, strict=True):
        if level < energy.max() * 1e-3:
            continue
        power = np.abs(np.fft.rfft(frame * window)) ** 2 + 1e-12
        values.append(np.exp(np.mean(np.log(power))) / np.mean(power))
    return float(np.median(values)) if values else None


def stray_lead(audio: np.ndarray, words) -> bool:
    """True when the first word of a segment is a join or leave tone the model heard as a short
    interjection ("you", "woo"): a single short token that stands alone before a pause and is
    either a pure tone or stretched far beyond the length of a spoken word that the model is unsure
    about. A confident word that is not a pure tone is kept, so a spoken "You" followed by a pause
    survives."""
    if len(words) < 2:
        return False
    first, second = words[0], words[1]
    token = first.word.strip().strip(".,!?").lower()
    if not token.isalpha() or len(token) > MAX_LETTERS or second.start - first.end < MIN_GAP_S:
        return False
    if first.end - first.start >= MIN_STRETCH_S and first.probability < LOW_PROBABILITY:
        return True
    flatness = spectral_flatness(
        audio[int(first.start * SAMPLE_RATE) : int(first.end * SAMPLE_RATE)]
    )
    return flatness is not None and flatness < PURE_TONE_FLATNESS
