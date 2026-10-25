# OpenMinutes whisper service

A small FastAPI wrapper around [faster-whisper](https://github.com/SYSTRAN/faster-whisper). The `local` transcription provider in `@openminutes/providers` talks to it. Audio never leaves your machine.

## Run

```sh
docker build -t openminutes-whisper services/whisper
docker run -d -p 8000:8000 -v openminutes-models:/models -e WHISPER_MODEL=small openminutes-whisper
```

Models download on first use into `/models`, so mount a volume to keep them.

| Variable                   | Default | Meaning                                                         |
| -------------------------- | ------- | --------------------------------------------------------------- |
| `WHISPER_MODEL`            | `small` | Model used when a request names none (`tiny` to `large-v3`)     |
| `WHISPER_DEVICE`           | `auto`  | `cpu`, `cuda` or `auto`                                         |
| `WHISPER_COMPUTE_TYPE`     | `int8`  | `float32` for full precision, `float16` for GPUs                |
| `WHISPER_TOKEN`            | unset   | If set, requests need `Authorization: Bearer <token>`           |
| `WHISPER_MAX_UPLOAD_BYTES` | 4 GiB   | Largest upload a request may carry, larger ones get a 413       |
| `DIARIZATION`              | `on`    | `off` disables `/diarize`                                       |
| `DIARIZATION_THRESHOLD`    | `0.9`   | Default clustering threshold when the request names none        |
| `DIARIZATION_MAX_SPEAKERS` | `99`    | When the count is unknown, fold the smallest voices beyond this |

## API

`GET /health` returns `{"status": "ok", "model": "small", "diarization": true}`. `diarization` says the feature is enabled and installed, it does not load any model.

`POST /transcribe` takes `multipart/form-data`:

- `file`: the audio or video file (anything ffmpeg reads)
- `model`: optional model size, defaults to `WHISPER_MODEL`
- `language`: optional ISO code, auto-detected when omitted

and returns:

```json
{
  "language": "en",
  "segments": [{ "startMs": 0, "endMs": 4200, "text": "Hello everyone.", "confidence": 0.93 }]
}
```

Errors use FastAPI's `{"detail": "..."}` body with status 400 (bad input) or 401 (bad token).

`POST /diarize` takes `multipart/form-data` with `file`, an optional `num_speakers` (1 to 20) and an optional `threshold`, and tells voices apart without any speaking indicator:

```json
{
  "available": true,
  "speakers": [{ "id": 0, "embedding": [0.01, "... 192 floats"], "durationMs": 12345 }],
  "turns": [
    {
      "startMs": 0,
      "endMs": 4200,
      "speaker": 0,
      "similarity": 0.83,
      "runnerUp": { "speaker": 1, "similarity": 0.31 }
    }
  ]
}
```

Speakers are ordered by speaking time, `embedding` is an L2-normalised 192-dimension voice print. `similarity` is the cosine between the turn's voice print (the mean of its 1 s window prints) and its speaker's centroid in this recording, `runnerUp` the best other speaker. Both are absent on a turn under 0.5 s, `runnerUp` also with a single speaker. The scale is that of 1 s clips, so a clean turn scores 0.6 to 0.9 and a noisy one 0.1 to 0.4: read the gap to `runnerUp`, not the absolute value. A short turn that was kept on its label with a small or negative gap is the one to treat as uncertain.

`POST /embed` takes `file` and `ranges`, a JSON string `[[startMs, endMs], ...]`, and returns the voice print of those stretches, for matching a person against a stored print: `{"available": true, "embedding": [...], "durationMs": 6000}`. The prints of the ranges are averaged by length, longest first up to 30 s, and L2-normalised. Ranges under 0.5 s are skipped, `embedding` is `null` when nothing is left. Bad ranges answer 400.

When the models cannot be downloaded or loaded the answer is `{"available": false, "reason": "..."}` with status 200. `/transcribe` never has a speaker. A single short interjection at the start of a segment that is a join or leave tone heard as a word ("you", "woo") is removed from the text and words (`tones.py`). The models, sizes and licences are in [docs/speakers.md](../../docs/speakers.md). They download on first use into `/models/diarization` (checked against a pinned sha256), so keep the `/models` volume to run without network afterwards.

## Short turns and quiet voices

The segmentation joins short replies to the turn next to them and drops quiet speech, and one print per long turn averages a second voice away. `refine.py` runs after the clustering and the cleanup and works on prints of 1 s windows every 0.5 s:

- A run of windows that fits another speaker better than its own turn by a margin of 0.12 (alone: 0.24) becomes its own turn, so a 1 to 2 s reply inside a long turn is no longer folded into it. Windows under a turn of another speaker (overlap) keep the segmentation's label.
- Loud stretches the segmentation left out of every turn (at least 0.4 s and 0.3 times the median level of the turns) become turns of the nearest voice. This costs false alarm in DER, see the numbers below.
- With `num_speakers` set and fewer speakers with a real share (6 windows, about 3 s) than that, the biggest speaker is split in two when its windows separate (a second voice with a centroid cosine under 0.8 to the first, from at least 6 windows that fit it clearly better). More speakers than the count: the smallest are folded into the nearest. Without `num_speakers` there is no split: it is only trusted when the caller says how many people there are.
- The count is no longer handed to the clusterer. The threshold clustering always runs and the count is reached by splitting and folding, because forcing it put a second cluster on a handful of stray turns.
- A cluster under 3 s or 2% of the speech is still folded into its nearest voice, except when it has 5 or more turns of at least 0.5 s next to another speaker's turns (a quiet voice with short answers).

Cost: one embedding per window, about 35 ms each on two threads, so roughly 0.03 to 0.05 s of CPU per second of audio on top of the clustering (16 s for a 10 minute AMI meeting on a busy 20 core host). Memory is the window prints, 2 per second of speech.

Measured on piper voices with 10 conversations (`e2e/transcripts/diarization.e2e.test.ts`, the 8 phone ones and two new `rapid-2a`/`rapid-2b`, where a loud and a quiet voice (gain 0.35 and 0.5) trade 1 to 2 s replies with 100 to 350 ms gaps) and counted over the same frames before and after:

|                                                                                                | before        | after         |
| ---------------------------------------------------------------------------------------------- | ------------- | ------------- |
| frame DER, all 10 (false alarm 7.9% in both, an artefact of scoring turns against speech only) | 15.7%         | 8.9%          |
| confusion                                                                                      | 7.4%          | 0.6%          |
| utterances under 2 s given to the right voice                                                  | 100 of 119    | 118 of 119    |
| `rapid-2a` / `rapid-2b` speech attributed                                                      | 95.9% / 85.6% | 99.5% / 97.6% |
| speaker count right                                                                            | 9 of 9        | 9 of 9        |

On five AMI meetings (10 minutes, 4 true speakers, default threshold; `e2e/eval/README.md`): DER 16.4% before, 15.8% with the window pass, 19.9% with the loud-stretch turns on top (false alarm 3.1% to 7.4%). The share of reference words that get the right speaker, with the reference word times as a perfect transcript, went from 89.7% to 90.7% to 91.0%, and words without any speaker from 1.4% to 0.9%. So the window pass helps a little on meetings, the loud stretches mostly trade DER for words that have a speaker. With the true count (4) DER went from 24.0% to 20.4% (confusion 11.9% to 4.7%), since the count is no longer forced on the clusterer; TS3003a, where the clusterer finds one voice, went from 10.8% to 17.7% there, because the split manufactured speakers.

A real 44 minute Dutch recording of two people at a table (one quiet, 76% of the speech from the other), first three minutes replayed: without a count the clusterer finds one speaker and the replies stay with it (the loud stretches at 0:00 and 0:03 are now turns, but of that speaker). With `num_speakers=2` a second speaker of 13.5 s in 12 turns of 1 to 2 s is split off, among them the stretches at 0:00 to 0:04 where the quiet person speaks before the long monologue starts, with low `similarity` and a small gap to `runnerUp`. No ground truth exists for that recording, so whether each of the 12 is right is not measured.

Not solved: replies under 0.5 s have no print at all and keep the label of the segmentation, or the nearest voice for a loud stretch. Two voices that the embedding model rates alike (centroid cosine 0.75 on that table recording, against 0.1 on the synthetic voices) stay noisy: the windows scatter and several of the splits are wrong. A recording with one voice and a `num_speakers` of 2 gets a second speaker made of that voice's odd windows. And without a count, a quiet speaker that the clusterer merges into the dominant one is not found, because on AMI a split without a count made a one-cluster meeting worse (TS3003a: DER 9.7% to 16.6%).

## Development

```bash
pip install -r requirements.txt ruff mypy pytest
ruff check . && ruff format --check . && mypy . && pytest -q
```
