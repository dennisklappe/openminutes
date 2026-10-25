# Storage and retention

Open Settings, Storage and retention (also in the setup wizard).

## Local volume

The default: the `data` volume, mounted at `/data`. The path is shown but not editable. To move it, change the volume in `compose.yaml`.

## S3-compatible bucket

Choose S3-compatible bucket and fill in:

- **Endpoint:** your service URL, for example `https://minio.example.com`. Empty for AWS S3.
- **Bucket:** must already exist.
- **Region:** `us-east-1` if your service does not care.
- **Access key ID** and **Secret access key:** stored encrypted with `OPENMINUTES_SECRET`, the secret is never shown again. Leave it empty when editing to keep the saved one.

Press Test before saving: it writes, reads back and deletes a small object, and says what failed. Works with MinIO, Cloudflare R2, Backblaze B2, Wasabi and other S3-API services.

- The bot records to the local volume and the worker merges and transcribes there. When the transcript is ready, the worker moves the audio to the bucket (the meeting page streams it from there) and removes the local copies.
- Re-running a transcription downloads the audio again, then moves it back.
- If the move fails, the audio stays on the volume and the meeting page shows the error.

> [!WARNING]
> Switching storage does not move audio already stored. Keep the old bucket settings, or copy the files over yourself, to keep old meetings playable.

## Silence trimming and re-processing

After transcribing, the worker cuts the recording to the first to last spoken word plus two seconds each side. You play and download the cut file; the transcript and exports use times relative to it. The cut does not re-encode: the untrimmed segment files (`000.opus`, ...) stay until retention deletes them.

Re-process merges the segments again and replaces the transcript, so it never trims twice. It is impossible after retention, since it needs the segment files.

## Retention

Set Delete audio after (days) to a number to turn it on (off by default).

Daily at 03:17 server time the worker deletes the audio (volume and bucket) of meetings that ended more than that many days ago. Transcripts and summaries stay, the meeting page says the audio was deleted, and it cannot be transcribed again. Retention also covers archived meetings.

To delete a whole meeting, press Delete meeting on its page: it waits in the bin for 30 days, then goes for good. See [Archive and bin](archive-and-bin.md).
