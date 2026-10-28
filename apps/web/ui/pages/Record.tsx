import { useEffect, useMemo, useState } from 'react';
import { nearestFirst, speakerHint, suggestEvent } from '../../src/meetings/link-pick.js';
import { Brand } from '../Brand.js';
import { useConfirm } from '../Confirm.js';
import { EventPicker, useLinkableEvents, windowAround } from '../EventPicker.js';
import { formatDuration } from '../format.js';
import { ConsentDialog } from '../recorder/ConsentDialog.js';
import {
  useFinishRedirect,
  useOnline,
  usePhoneConfig,
  useRecorderSession,
  useTicker,
} from '../recorder/hooks.js';
import { LevelMeter } from '../recorder/LevelMeter.js';
import { recorderSession, type Phase } from '../recorder/session.js';
import { SpeakerCountSelect } from '../recorder/SpeakerCountSelect.js';
import { loadSpeakerPreference, saveSpeakerPreference } from '../recorder/speakerPreference.js';
import { UnfinishedBanner } from '../recorder/UnfinishedBanner.js';
import '../recorder/recorder.css';

const STATE_TEXT: Record<Phase, string> = {
  idle: 'Ready to record',
  starting: 'Starting the microphone',
  recording: 'Recording',
  paused: 'Paused',
  stopping: 'Saving the recording',
  uploading: 'Uploading',
  done: 'Saved',
  failed: 'Recording stopped',
};

const SHORT_MS = 3000;
const WAKE_HINT =
  'Keep this screen on while recording; your phone may stop recording when it sleeps.';

function Notices() {
  const { wakeLock, wasHidden, error, phase, waiting } = useRecorderSession();
  const online = useOnline();
  const live = phase === 'recording' || phase === 'paused';
  useTicker(live, 1000);
  const gap = live && recorderSession.hasGap();
  return (
    <div className="record-notices" aria-live="polite">
      {live && (wakeLock === 'unsupported' || wakeLock === 'refused') && (
        <p className="notice warn">{WAKE_HINT}</p>
      )}
      {live && wasHidden && (
        <p className="notice warn">
          This page was in the background. Your phone may have paused the recording, so check the
          length when you are done.
        </p>
      )}
      {gap && (
        <p className="notice warn">
          Less audio has been saved than the time that passed. Keep this screen open.
        </p>
      )}
      {!online && (phase === 'recording' || phase === 'paused' || phase === 'uploading') && (
        <p className="notice">
          You are offline. The recording is kept on this device and uploads when you are back
          online.
        </p>
      )}
      {waiting && online && <p className="notice">Upload interrupted, trying again.</p>}
      {error && <p className="notice error">{error}</p>}
    </div>
  );
}

function Stage() {
  const session = useRecorderSession();
  const { phase } = session;
  const live = phase === 'recording' || phase === 'paused';
  useTicker(live);
  const elapsed = recorderSession.elapsed();

  const confirm = useConfirm();
  const stop = async () => {
    if (elapsed < SHORT_MS) {
      const stopAnyway = await confirm({
        title: 'Stop this recording?',
        body: 'It is under 3 seconds long.',
        confirmLabel: 'Stop recording',
        cancelLabel: 'Keep recording',
      });
      if (!stopAnyway) return;
    }
    void recorderSession.stop();
  };
  const [speakers, setSpeakers] = useState(loadSpeakerPreference);
  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => windowAround(now, 3, 24), [now]);
  const found = useLinkableEvents(range.from, range.to);
  const events = useMemo(() => nearestFirst(found, now), [found, now]);
  // Until the user chooses, the meeting closest to now is offered.
  const [picked, setPicked] = useState<string | null>();
  const suggested = suggestEvent(events, now);
  const eventId = picked === undefined ? suggested?.id : (picked ?? undefined);
  const suggestedId = suggested?.id;
  const suggestedPeople = suggested?.people ?? null;
  useEffect(() => {
    const hint = speakerHint(suggestedPeople);
    if (suggestedId && hint) setSpeakers(hint);
  }, [suggestedId, suggestedPeople]);
  const busy = phase === 'starting' || phase === 'stopping' || phase === 'uploading';

  return (
    <section className="record-stage" aria-label="Recorder">
      <div className="record-time" role="timer" aria-label="Elapsed time">
        {formatDuration(elapsed)}
      </div>
      <p className="record-state" data-phase={phase}>
        {STATE_TEXT[phase]}
        {phase === 'uploading' && session.chunks > 0 && (
          <>
            {' '}
            {session.uploaded} of {session.chunks} parts
          </>
        )}
      </p>
      <LevelMeter analyser={phase === 'recording' ? recorderSession.analyser : undefined} />
      {!live && (
        <EventPicker
          events={events}
          value={eventId}
          disabled={busy}
          onChange={(id) => {
            setPicked(id ?? null);
            const hint = speakerHint(events.find((event) => event.id === id)?.people ?? null);
            if (hint) setSpeakers(hint);
          }}
        />
      )}
      {!live && (
        <SpeakerCountSelect
          value={speakers}
          disabled={busy}
          onChange={(value) => {
            setSpeakers(value);
            saveSpeakerPreference(value);
          }}
        />
      )}
      <div className="record-controls">
        {live ? (
          <>
            <button
              className="record-side"
              onClick={() => {
                if (phase === 'paused') recorderSession.resume();
                else recorderSession.pause();
              }}
            >
              {phase === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button
              className="record-button stop"
              onClick={() => void stop()}
              aria-label="Stop recording"
            >
              <span />
            </button>
            <span className="record-side-spacer" />
          </>
        ) : (
          <RecordStart disabled={busy} speakers={speakers} eventId={eventId} />
        )}
      </div>
      <Notices />
    </section>
  );
}

function RecordStart({
  disabled,
  speakers,
  eventId,
}: {
  disabled: boolean;
  speakers: number | undefined;
  eventId: string | undefined;
}) {
  const config = usePhoneConfig();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button
        className="record-button"
        aria-label="Start recording"
        disabled={disabled || !config}
        onClick={() => {
          setAsking(true);
        }}
      >
        <span />
      </button>
      {asking && config && (
        <ConsentDialog
          text={config.consentText}
          onCancel={() => {
            setAsking(false);
          }}
          onConfirm={() => {
            setAsking(false);
            void recorderSession.start(speakers, eventId);
          }}
        />
      )}
    </>
  );
}

export function Record() {
  const config = usePhoneConfig();
  const { phase } = useRecorderSession();
  useFinishRedirect();
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Record</h1>
          <p className="lede">
            Record a conversation with this device. It is transcribed afterwards.
          </p>
        </div>
      </header>
      <UnfinishedBanner />
      {config && !config.enabled && phase === 'idle' ? (
        <div className="panel empty-state">
          <h3>Phone recording is turned off</h3>
          <p>Turn it on in Settings to record meetings with this device.</p>
        </div>
      ) : (
        <Stage />
      )}
    </>
  );
}

export function OfflineRecorder() {
  return (
    <div className="offline-recorder">
      <Brand />
      <main>
        <p className="notice">
          OpenMinutes cannot be reached. You can still record: the audio is kept on this device and
          uploads when you are back online.
        </p>
        <Record />
      </main>
    </div>
  );
}
