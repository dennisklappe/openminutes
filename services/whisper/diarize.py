import hashlib
import importlib.util
import logging
import os
import tempfile
import threading
import urllib.request
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from faster_whisper.audio import decode_audio

import refine
from refine import MIN_EMBED_MS, SAMPLE_RATE, unit

log = logging.getLogger("diarize")

MIN_SPEAKER_MS = 3_000
MIN_SPEAKER_SHARE = 0.02
CENTROID_MS = 30_000
CLEAN_TURN_MS = 800
ALTERNATING_TURNS = 5
DEFAULT_THRESHOLD = float(os.environ.get("DIARIZATION_THRESHOLD", "0.9"))
MERGE_SIMILARITY = 0.65
MAX_SPEAKERS = int(os.environ.get("DIARIZATION_MAX_SPEAKERS", "99"))
ENABLED = os.environ.get("DIARIZATION", "on").lower() not in {"off", "0", "false"}


@dataclass(frozen=True)
class ModelFile:
    name: str
    url: str
    sha256: str


SEGMENTATION = ModelFile(
    "pyannote-segmentation-3.0.int8.onnx",
    "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.int8.onnx",
    "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d",
)
DEFAULT_EMBEDDING = ModelFile(
    "eres2net-en-voxceleb-16k.onnx",
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx",
    "c59158379255ad66e161679cca6af8d52d51e389e3224ab7d7a7baae295c2db5",
)


def embedding_model() -> ModelFile:
    """The speaker embedding model. A multilingual model (for Dutch, say) can be set with
    DIARIZATION_EMBEDDING_NAME, _URL and _SHA256 without a code change. Voice prints of two
    models cannot be compared, so the name travels with every print."""
    name = os.environ.get("DIARIZATION_EMBEDDING_NAME")
    url = os.environ.get("DIARIZATION_EMBEDDING_URL")
    sha256 = os.environ.get("DIARIZATION_EMBEDDING_SHA256")
    if name and url and sha256:
        return ModelFile(name, url, sha256)
    return DEFAULT_EMBEDDING


EMBEDDING = DEFAULT_EMBEDDING

_lock = threading.Lock()


class Unavailable(Exception):
    pass


def available() -> bool:
    return ENABLED and importlib.util.find_spec("sherpa_onnx") is not None


def model_dir() -> Path:
    default = Path(os.environ.get("HF_HOME", "~/.cache/huggingface")).expanduser() / "diarization"
    return Path(os.environ.get("DIARIZATION_MODEL_DIR", default))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(model: ModelFile) -> Path:
    path = model_dir() / model.name
    if path.is_file() and _sha256(path) == model.sha256:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".part", delete=False) as tmp:
        partial = Path(tmp.name)
    try:
        with urllib.request.urlopen(model.url, timeout=60) as response, partial.open("wb") as out:
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
        if _sha256(partial) != model.sha256:
            raise Unavailable(f"{model.name} failed its checksum")
        partial.replace(path)
    except OSError as error:
        raise Unavailable(f"{model.name} could not be downloaded: {error}") from error
    finally:
        partial.unlink(missing_ok=True)
    return path


@lru_cache(maxsize=1)
def _load():
    if not available():
        raise Unavailable("diarization is disabled or sherpa-onnx is not installed")
    import sherpa_onnx

    segmentation = fetch(SEGMENTATION)
    embedding = fetch(embedding_model())
    try:
        extractor = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(embedding), num_threads=2)
        )
        return sherpa_onnx, str(segmentation), str(embedding), extractor
    except Exception as error:
        raise Unavailable(f"models could not be loaded: {error}") from error


def _embed(extractor, samples: np.ndarray) -> np.ndarray:
    stream = extractor.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    stream.input_finished()
    return np.asarray(extractor.compute(stream), dtype=np.float64)


def _clean_turns(turns: list[dict], speaker: int) -> list[dict]:
    others = [t for t in turns if t["speaker"] != speaker]
    clean = [
        t
        for t in turns
        if t["speaker"] == speaker
        and t["endMs"] - t["startMs"] >= CLEAN_TURN_MS
        and not any(o["startMs"] < t["endMs"] and o["endMs"] > t["startMs"] for o in others)
    ]
    return sorted(clean, key=lambda t: t["startMs"] - t["endMs"])


def _centroid(extractor, audio: np.ndarray, turns: list[dict], speaker: int) -> np.ndarray:
    total = np.zeros(extractor.dim)
    budget = CENTROID_MS
    for turn in _clean_turns(turns, speaker) or [t for t in turns if t["speaker"] == speaker]:
        if budget <= 0:
            break
        start = turn["startMs"] * SAMPLE_RATE // 1000
        end = turn["endMs"] * SAMPLE_RATE // 1000
        length = turn["endMs"] - turn["startMs"]
        total += unit(_embed(extractor, audio[start:end])) * length
        budget -= length
    return unit(total)


def _durations(turns: list[dict]) -> dict[int, int]:
    totals: dict[int, int] = {}
    for turn in turns:
        totals[turn["speaker"]] = totals.get(turn["speaker"], 0) + turn["endMs"] - turn["startMs"]
    return totals


def _fold(turns: list[dict], speaker: int, into: int) -> None:
    for turn in turns:
        if turn["speaker"] == speaker:
            turn["speaker"] = into


def _alternations(turns: list[dict], speaker: int) -> int:
    """Turns of `speaker` long enough to embed that sit next to another speaker's turn."""
    ordered = sorted(turns, key=lambda t: t["startMs"])
    return sum(
        1
        for i, turn in enumerate(ordered)
        if turn["speaker"] == speaker
        and turn["endMs"] - turn["startMs"] >= MIN_EMBED_MS
        and any(0 <= j < len(ordered) and ordered[j]["speaker"] != speaker for j in (i - 1, i + 1))
    )


def _merge_clusters(extractor, audio: np.ndarray, turns: list[dict], keep: int, limit: int) -> None:
    """Fold clusters into their nearest neighbour: voices that sound alike (centroid similarity of
    MERGE_SIMILARITY or more), clusters with under MIN_SPEAKER_MS of speech or under
    MIN_SPEAKER_SHARE of all speech (a passer-by or a clattering cup in a table recording) unless
    they answer the others in ALTERNATING_TURNS or more turns (a quiet speaker with short replies),
    and the smallest ones while there are more than `limit`. Never goes below `keep` speakers."""
    while True:
        totals = _durations(turns)
        if len(totals) <= max(keep, 1):
            return
        centroids = {s: _centroid(extractor, audio, turns, s) for s in totals}
        pairs = [
            (float(centroids[a] @ centroids[b]), a, b) for a in totals for b in totals if a < b
        ]
        similarity, first, second = max(pairs)
        minimum = max(MIN_SPEAKER_MS, MIN_SPEAKER_SHARE * sum(totals.values()))
        small = [
            s
            for s, ms in totals.items()
            if ms < minimum and _alternations(turns, s) < ALTERNATING_TURNS
        ]
        if similarity >= MERGE_SIMILARITY:
            smaller = min((first, second), key=totals.__getitem__)
        elif small or len(totals) > limit:
            smaller = min(small or totals, key=totals.__getitem__)
        else:
            return
        nearest = max(
            (s for s in totals if s != smaller),
            key=lambda s: float(centroids[s] @ centroids[smaller]),
        )
        _fold(turns, smaller, nearest)


def _cluster(audio: np.ndarray, threshold: float | None) -> list[dict]:
    sherpa_onnx, segmentation, embedding, _ = _load()
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=segmentation),
            num_threads=2,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=embedding, num_threads=2),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=-1,
            threshold=threshold if threshold is not None else DEFAULT_THRESHOLD,
        ),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    found = sherpa_onnx.OfflineSpeakerDiarization(config).process(audio).sort_by_start_time()
    return [
        {"startMs": round(s.start * 1000), "endMs": round(s.end * 1000), "speaker": s.speaker}
        for s in found
    ]


def _renumber(turns: list[dict]) -> dict[int, int]:
    """Numbers speakers by speaking time, in turns and runners-up. Returns old to new."""
    totals = _durations(turns)
    ids = {old: new for new, old in enumerate(sorted(totals, key=lambda s: -totals[s]))}
    for turn in turns:
        turn["speaker"] = ids[turn["speaker"]]
        if "runnerUp" in turn:
            turn["runnerUp"]["speaker"] = ids[turn["runnerUp"]["speaker"]]
    return ids


def diarize_file(path: str, num_speakers: int | None, threshold: float | None) -> dict:
    try:
        extractor = _load()[3]
    except Unavailable as error:
        log.warning("diarization unavailable: %s", error)
        return {"available": False, "reason": str(error)}
    audio = decode_audio(path, sampling_rate=SAMPLE_RATE)
    with _lock:
        turns = _cluster(audio, threshold)
        if not turns:
            return {"available": True, "speakers": [], "turns": []}
        _merge_clusters(extractor, audio, turns, num_speakers or 1, num_speakers or MAX_SPEAKERS)
        turns = refine.refine(lambda x: _embed(extractor, x), audio, turns, num_speakers)
        totals = _durations(turns)
        ids = _renumber(turns)
        speakers = [
            {
                "id": ids[old],
                "embedding": _centroid(extractor, audio, turns, ids[old]).tolist(),
                "durationMs": ms,
            }
            for old, ms in sorted(totals.items(), key=lambda item: -item[1])
        ]
    return {"available": True, "speakers": speakers, "turns": turns}


def embed_ranges(path: str, ranges: list[tuple[int, int]]) -> dict:
    """Voice print of the given stretches of a file: their embeddings averaged by length, longest
    first up to CENTROID_MS. Stretches under MIN_EMBED_MS are skipped."""
    try:
        extractor = _load()[3]
    except Unavailable as error:
        log.warning("diarization unavailable: %s", error)
        return {"available": False, "reason": str(error)}
    audio = decode_audio(path, sampling_rate=SAMPLE_RATE)
    usable = sorted((r for r in ranges if r[1] - r[0] >= MIN_EMBED_MS), key=lambda r: r[0] - r[1])
    total = np.zeros(extractor.dim)
    used = 0
    with _lock:
        for start, end in usable:
            if used >= CENTROID_MS:
                break
            clip = audio[start * SAMPLE_RATE // 1000 : end * SAMPLE_RATE // 1000]
            total += unit(_embed(extractor, clip)) * (end - start)
            used += end - start
    return {
        "available": True,
        "embedding": unit(total).tolist() if used else None,
        "durationMs": used,
        "model": embedding_model().name,
    }


LINE_WINDOW_MS = 1_000


def _line_window(start: int, end: int, length_ms: int) -> tuple[int, int]:
    """A line of at least MIN_EMBED_MS as it is, a shorter one as a LINE_WINDOW_MS window around
    its middle, moved to stay inside the file."""
    if end - start >= MIN_EMBED_MS:
        return start, min(end, length_ms)
    middle = (start + end) // 2
    first = max(0, min(middle - LINE_WINDOW_MS // 2, length_ms - LINE_WINDOW_MS))
    return first, min(first + LINE_WINDOW_MS, length_ms)


def embed_each(path: str, ranges: list[tuple[int, int]]) -> dict:
    """One voice print per range, in the order given, so every line of a transcript can be
    compared to a saved voice. A range under MIN_EMBED_MS is read from a window around it.
    An entry is None when the file has no audio there."""
    try:
        extractor = _load()[3]
    except Unavailable as error:
        log.warning("diarization unavailable: %s", error)
        return {"available": False, "reason": str(error)}
    audio = decode_audio(path, sampling_rate=SAMPLE_RATE)
    length_ms = len(audio) * 1000 // SAMPLE_RATE
    prints: list[list[float] | None] = []
    with _lock:
        for start, end in ranges:
            first, last = _line_window(start, end, length_ms)
            if last - first < MIN_EMBED_MS:
                prints.append(None)
                continue
            clip = audio[first * SAMPLE_RATE // 1000 : last * SAMPLE_RATE // 1000]
            prints.append(unit(_embed(extractor, clip)).tolist())
    return {"available": True, "embeddings": prints, "model": embedding_model().name}
