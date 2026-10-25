# Sizing

> [!NOTE]
> Planning figures from the design, not measurements.

- **Per meeting:** about 1 vCPU and 1.5 GB RAM, one browser context in the `bot` container.
- **Base load:** about 1 GB RAM extra for `web`, `worker` and `db`. Adjust after watching real use.
- **Local transcription:** the `local` profile runs faster-whisper after the meeting ends, so it uses CPU only then. Larger models are more accurate and slower. A small model is a fair start. No GPU needed.
- **Disk:** Opus audio, roughly 15 to 30 MB per hour (estimate). Transcripts and metadata are small. To save space use the [retention setting](storage.md) or an S3-compatible bucket.
- **Network:** outbound access to Google Meet or Microsoft Teams (the bot joins as a normal guest).

## Meetings at the same time

Set Parallel meetings in Settings, General, Meeting limits to what your machine can carry (default 1). A meeting over the limit stays queued, shows "Waiting for a free slot" and joins when a slot frees up (checked every 30 seconds). If it has already started by then, the bot joins late.
