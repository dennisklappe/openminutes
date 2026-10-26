import json
import math
import os
import secrets
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

import diarize
import guards
import language as languages
import tones

DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "small")
DEVICE = os.environ.get("WHISPER_DEVICE", "auto")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
TOKEN = os.environ.get("WHISPER_TOKEN")
MAX_UPLOAD_BYTES = int(os.environ.get("WHISPER_MAX_UPLOAD_BYTES", str(4 * 1024**3)))

# Whisper drops punctuation on run-on speech and then keeps dropping it, because every window is
# conditioned on the unpunctuated text before it. A short punctuated prompt in the speaker's
# language brings commas, full stops and capitals back. Keep it neutral: a greeting leaks into the
# transcript.
PUNCTUATION_PROMPTS = {
    "en": "So, where were we? Right. Let's continue with the next point.",
    "nl": "Even kijken, waar waren we gebleven? Juist. Laten we verdergaan met het volgende punt.",
    "de": "Also, wo waren wir stehen geblieben? Genau. Machen wir mit dem nächsten Punkt weiter.",
    "fr": "Alors, où en étions-nous ? Voilà. Passons au point suivant.",
    "es": "Bien, ¿en qué estábamos? Claro. Sigamos con el siguiente punto.",
}

app = FastAPI(title="OpenMinutes whisper service")


@lru_cache(maxsize=2)
def load_model(name: str) -> WhisperModel:
    if not guards.valid_model(name):
        raise ValueError(f"unknown model name: {name[:80]!r}")
    return WhisperModel(name, device=DEVICE, compute_type=COMPUTE_TYPE)


def check_token(authorization: str | None = Header(default=None)) -> None:
    if TOKEN and not secrets.compare_digest(authorization or "", f"Bearer {TOKEN}"):
        raise HTTPException(status_code=401, detail="invalid token")


@contextmanager
def uploaded(file: UploadFile) -> Iterator[str]:
    suffix = Path(file.filename or "audio").suffix
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        try:
            guards.copy_limited(file.file, tmp, MAX_UPLOAD_BYTES)
        except guards.UploadTooLarge as error:
            raise HTTPException(status_code=413, detail=str(error)) from error
        tmp.flush()
        yield tmp.name


@app.get("/health", dependencies=[Depends(check_token)])
def health() -> dict[str, Any]:
    return {"status": "ok", "model": DEFAULT_MODEL, "diarization": diarize.available()}


def as_json(segment, audio) -> dict[str, Any]:
    words = segment.words or []
    text = segment.text.strip()
    if tones.stray_lead(audio, words):
        words = words[1:]
        text = "".join(w.word for w in words).strip()
    return {
        "startMs": round((words[0].start if words else segment.start) * 1000),
        "endMs": round(segment.end * 1000),
        "text": text,
        "confidence": min(1.0, math.exp(segment.avg_logprob)),
        "words": [
            {"startMs": round(w.start * 1000), "endMs": round(w.end * 1000), "text": w.word.strip()}
            for w in words
        ],
    }


@app.post("/transcribe", dependencies=[Depends(check_token)])
def transcribe(
    file: UploadFile = File(...),
    model: str = Form(default=DEFAULT_MODEL),
    language: str | None = Form(default=None),
) -> dict[str, Any]:
    with uploaded(file) as path:
        try:
            whisper = load_model(model)
            audio = decode_audio(path)
            spoken = language or whisper.detect_language(audio)[0]
            segments, info = whisper.transcribe(
                audio,
                language=spoken,
                initial_prompt=PUNCTUATION_PROMPTS.get(spoken),
                vad_filter=True,
                word_timestamps=True,
            )
            result = [as_json(s, audio) for s in segments]
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
    return {"language": info.language, "segments": result}


@app.post("/detect-language", dependencies=[Depends(check_token)])
def detect_language(
    file: UploadFile = File(...), model: str = Form(default=DEFAULT_MODEL)
) -> dict[str, Any]:
    with uploaded(file) as path:
        try:
            return languages.detect(load_model(model), decode_audio(path))
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/diarize", dependencies=[Depends(check_token)])
def diarize_audio(
    file: UploadFile = File(...),
    num_speakers: int | None = Form(default=None, ge=1, le=20),
    threshold: float | None = Form(default=None, gt=0, lt=1.5),
) -> dict[str, Any]:
    with uploaded(file) as path:
        try:
            return diarize.diarize_file(path, num_speakers, threshold)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


def parse_ranges(raw: str) -> list[tuple[int, int]]:
    try:
        ranges = [(int(start), int(end)) for start, end in json.loads(raw)]
    except (ValueError, TypeError) as error:
        raise HTTPException(
            status_code=400, detail="ranges must be [[startMs, endMs], ...]"
        ) from error
    if any(start < 0 or end <= start for start, end in ranges):
        raise HTTPException(status_code=400, detail="every range needs 0 <= startMs < endMs")
    return ranges


@app.post("/embed", dependencies=[Depends(check_token)])
def embed_audio(file: UploadFile = File(...), ranges: str = Form(...)) -> dict:
    wanted = parse_ranges(ranges)
    with uploaded(file) as path:
        try:
            return diarize.embed_ranges(path, wanted)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/embed-lines", dependencies=[Depends(check_token)])
def embed_lines(file: UploadFile = File(...), ranges: str = Form(...)) -> dict:
    wanted = parse_ranges(ranges)
    with uploaded(file) as path:
        try:
            return diarize.embed_each(path, wanted)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
