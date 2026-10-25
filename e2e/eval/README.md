# AMI evaluation

Measures the audio pipeline on public meeting recordings (AMI Meeting Corpus, CC BY 4.0, Mix-Headset audio, manual word transcripts, BUT `only_words` RTTMs). Nothing is stored in git: data lands in `$EVAL_DIR` (default `~/.cache/openminutes-eval`). Delete that directory when done.

Needs the e2e venv (faster-whisper, sherpa-onnx, numpy, scipy), ffmpeg, node, the diarization models in `~/.cache/openminutes-e2e/diarize-models` and a built `packages/core` (`pnpm --filter @openminutes/core build`).

```sh
export EVAL_DIR=$HOME/.cache/openminutes-eval
PY=~/.cache/openminutes-e2e/venv/bin/python
$PY e2e/eval/ami_eval.py all   # fetch, prepare, asr, diar, score (hours on a busy CPU)
```

Steps can run alone: `fetch`, `prepare`, `asr`, `diar`, `score`. `EVAL_MEETINGS` picks meetings (default 5), `EVAL_WINDOW` the seconds per meeting (600), `EVAL_LARGE` the meeting that also runs large-v3.

Each meeting is cropped to 10 minutes and padded with 30 s of digital silence in front and 30 s of -55 dB noise behind, to probe invented text in silence. It reports:

- WER (normalised: lower case, no punctuation or fillers, numbers spelled out) raw and after the worker's silence gate (`gate.mjs` calls `dropSilentSpeech`), words and segments invented in the pads, real-time factor, peak RSS, end-of-sentence and comma rate against the reference.
- Diarization (`services/whisper/diarize.py`) for several clustering thresholds and with the true speaker count: speaker count, frame-level DER with overlap scored (collar 0.25 s and 0 s), word level speaker accuracy.

Caveats: the transcription call copies `services/whisper/app.py` (no FastAPI in the venv); jobs run in parallel on a shared host, so RTF is indicative; DER is a small own implementation, not md-eval.

`ami_eval.py diar-quick` runs only the diarization, without ASR, for the default threshold and the true count: DER and the share of reference words that get the right speaker, with the reference word times standing in for a perfect transcript. About 3 minutes per meeting and configuration on a busy host. Numbers before and after the sliding-window pass (5 meetings, default threshold): DER 16.4% to 19.9% (miss 9.0% to 8.3%, false alarm 3.1% to 7.4%, confusion 4.3% to 4.2%), word speaker accuracy 89.7% to 91.0%, words without a speaker 1.4% to 0.9%. With the true count: DER 24.0% to 20.4%. The DER rise is false alarm from loud stretches outside every turn that now become turns; without them DER is 15.8% and word accuracy 90.7%. See `services/whisper/README.md`.

`chime_eval.py [model ...]` is a separate check for join tones: it prepends synthetic Meet style chimes to piper speech and counts transcripts that start with an invented word ("Woo", "you"), before and after `services/whisper/tones.py`.
