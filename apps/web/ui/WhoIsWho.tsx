import { useCallback, useEffect, useState } from 'react';
import type { VoicesDto } from '../src/dto.js';
import { api } from './api.js';
import { SPEAKER_COLORS } from './speakers.js';
import { VoiceCard } from './VoiceCard.js';
import './voices.css';

interface Props {
  meetingId: string;
  transcriptSize: number;
  audioUrl: string;
  onChanged: () => void;
}

export function WhoIsWho({ meetingId, transcriptSize, audioUrl, onChanged }: Props) {
  const [data, setData] = useState<VoicesDto>();
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api.voices(meetingId).then(setData, () => {
      setData(undefined);
    });
  }, [meetingId]);

  useEffect(load, [load, transcriptSize]);
  useEffect(() => {
    if (data?.needsNaming) setOpen(true);
  }, [data?.needsNaming]);

  if (!data || data.voices.length === 0) return null;
  if (!open) {
    return (
      <p className="voices-open">
        <button
          onClick={() => {
            setOpen(true);
          }}
        >
          Edit speakers
        </button>
      </p>
    );
  }

  return (
    <section className="panel card who" aria-labelledby="who-title">
      <header className="card-head">
        <h3 id="who-title">Who is who?</h3>
        <p>
          {data.needsNaming
            ? 'Listen to a few words and name each voice. Names are used in the transcript, the summary and the minutes.'
            : 'Rename a voice, or give two voices the same name to merge them.'}
        </p>
      </header>
      <div className="card-body voices">
        {data.voices.map((voice, index) => (
          <VoiceCard
            key={voice.id}
            meetingId={meetingId}
            voice={voice}
            slot={index % SPEAKER_COLORS}
            rememberEnabled={data.rememberEnabled}
            audioUrl={audioUrl}
            onSaved={() => {
              load();
              onChanged();
            }}
          />
        ))}
      </div>
      {!data.needsNaming && (
        <footer className="card-foot">
          <div className="actions">
            <button
              onClick={() => {
                setOpen(false);
              }}
            >
              Done
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
