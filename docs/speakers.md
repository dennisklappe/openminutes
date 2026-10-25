# How speakers are detected

Who said what comes from the call itself. The transcription provider changes the text and word times, not the speakers.

```mermaid
flowchart TD
    A(["Recording"]) --> B{"Where from?"}
    B -->|"Meet or Teams call"| C["Bot reads the speaking indicator<br/>about 4 times a second"]
    B -->|"Phone recording"| D["Voices are told apart<br/>from the audio"]
    D --> E["Speaker 1 to Speaker N"]
    C --> F["Words are lined up<br/>with the speaking intervals"]
    E --> F
    F --> G{"Check uncertain lines<br/>with the summary model?"}
    G -->|"on"| H["Model picks between known speakers,<br/>every answer is checked"]
    G -->|"off"| I(["Transcript with names"])
    H --> I
```

## In a Meet or Teams call

The bot reads the page about four times a second: who is in the call and who has the speaking indicator lit. After transcription the words are lined up with those intervals:

- The indicator lights late, so its measured delay is taken off every interval.
- At a handover, both intervals move to the pause just before it.
- Each word gets the speaker on the cheapest path: staying inside an interval costs less, switching mid-phrase costs more than switching at a pause.
- A sentence goes to the speaker who covers most of it.

Provider labels (Deepgram, AssemblyAI) only break ties. They never override the indicator.

## Second pass: the context AI

With a summary provider set, uncertain lines are checked once more. Turn it off under Settings, Summaries, Speaker names (`speakers.refine`, on by default).

| Question           | Answer                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ |
| What is sent       | About 10 uncertain lines plus 4 lines of context each side: names and text only            |
| What is never sent | Audio, emails, voice prints                                                                |
| What comes back    | Only `{"changes":[{"index","speaker"}]}`, so words and timing cannot change                |
| Bad answer         | The batch is skipped (unknown name, line twice, over 60% changed); the meeting never fails |
| Cost               | About 4 small requests for a 45 minute recording with 40 uncertain lines                   |
| Undo               | Changed lines keep their old speaker in `previous_participant_id`                          |

Without a summary provider, a plain heuristic runs instead and sends nothing. It only fixes the obvious case: a line that opens like an answer ("Yes", "Ja", "Nee") right after a question. The check can be rerun with job `meeting.review-speakers`.

## How speakers are decided

| Source         | Where it comes from                          |
| -------------- | -------------------------------------------- |
| `indicator`    | Meet and Teams speaking indicator            |
| `diarization`  | Voices found in a phone recording            |
| `ai` / `guess` | Second pass, or the heuristic                |
| `user`         | A person changed the line. Never overwritten |

Every line gets a confidence from 0 to 1. It is a heuristic, not a probability. Lines under 70% show as uncertain. Very short lines and turn-taking oddities (a question and an answer from the same speaker, "Thanks, Anna" said by Anna) are capped so they stay uncertain.

Corrections survive re-processing: they are remembered by name and time range and applied to the new lines (best effort). With "Remember voices" on, a correction also teaches that voice.

## Phone recordings

There is no indicator, so the voices come from the audio. The first source that gives labels wins.

```mermaid
flowchart TD
    A(["Transcript ready"]) --> B{"Provider returned<br/>speaker labels?"}
    B -->|"yes (AssemblyAI, Deepgram)"| F["Use those labels"]
    B -->|"no"| C{"Local transcription?"}
    C -->|"yes"| D["Whisper service diarizes<br/>the merged audio"]
    C -->|"no"| G["No labels,<br/>transcript has no speakers"]
    D -->|"fails"| G
    D --> F
    F --> H["Speaker 1 to N, longest talker first"]
    H --> I["Suggest names:<br/>voice memory and conversation"]
```

- Audio never goes to a third party for speaker detection. The diarizer runs only with the local provider.
- "How many people are talking?" on the Record screen takes Auto, 2, 3, 4 or 5+. Use a count only when certain: a count of 2 on a one voice recording invents a second speaker. On a finished recording use More, Re-process with 2 speakers (or other count).
- Names are only ever suggested, never applied. A suggestion comes from voice memory (with "Remember voices" on, up to 3 matches) or from names spoken in the call ("Thanks, Anna", text only). See [Voices](voices.md).
- A phone recording gets a short title (6 words at most) from its summary. Calendar and link meetings are never retitled.
- Re-processing rebuilds speakers, keeps corrected lines and matches new voices to names you gave before.

<details>
<summary>Models and accuracy</summary>

- Local diarizer: sherpa-onnx with pyannote segmentation 3.0 and 3D-Speaker ERes2Net voice prints, on CPU, no account. About 0.5 s CPU per second of audio. Details in `services/whisper/README.md`.
- Models download on first use and are not bundled. Check their licences against your use: some training data has research-only terms.
- Clustering threshold 0.9. Short turns under about 2 s are the weak spot.

| Test set                      | Speaker error rate |
| ----------------------------- | ------------------ |
| Synthetic phone conversations | 8.0%               |
| Five real AMI meetings        | 17.2%              |

Synthetic voices are cleaner than phone audio, so expect worse on real calls. The indicator alignment scores 98.8% of sentences on a synthetic late-indicator meeting and 19 of 19 on a recorded Teams meeting (`e2e/transcripts/run.sh`).

</details>

## Limits

> [!WARNING]
> The reading depends on Meet's page structure, which Google changes without notice. If the page cannot be read, the bot keeps recording and the transcript has no names.

- People are identified by display name: two people with the same name count as one.
- Only people shown in the call grid are seen, so very large meetings can miss some.
- A one-word reply over before its tile lights up can go to the previous speaker. Overlapping speech is only partly recoverable.
- Selectors live in `packages/platforms/src/meet-dom.ts`.
