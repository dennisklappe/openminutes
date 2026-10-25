import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import type { ChatMessageDto, SegmentDto, SpeakerChoiceDto, SpeakerCheckDto } from '../src/dto.js';
import { formatDuration } from './format.js';
import { isTyping } from './keyboard.js';
import { SegmentLine } from './SegmentLine.js';
import { SpeakerReviewBar } from './SpeakerReviewBar.js';
import { speakerSlots } from './speakers.js';
import { stepUncertain, uncertainSegments } from './speakerReview.js';
import { linkParts, mergeTranscript } from './transcript.js';
import './speakerReview.css';
import { UndoToast } from './UndoToast.js';
import { useAudioRange } from './useAudioRange.js';
import { useSpeakerEdits } from './useSpeakerEdits.js';

export interface PlayerHandle {
  playRange: (startMs: number, endMs: number) => void;
}

interface Props {
  meetingId: string;
  recording: { src: string; durationMs: number } | null;
  segments: SegmentDto[];
  speakerChoices: SpeakerChoiceDto[];
  speakerCheck: SpeakerCheckDto;
  chat: ChatMessageDto[];
  showTranscript: boolean;
  onChanged: () => void;
  controls?: Ref<PlayerHandle>;
}

export function TranscriptPlayer(props: Props) {
  const { meetingId, recording, chat, showTranscript, speakerCheck, onChanged, controls } = props;
  const audio = useRef<HTMLAudioElement>(null);
  const active = useRef<HTMLLIElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [onlyUncertain, setOnlyUncertain] = useState(false);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const edits = useSpeakerEdits({
    meetingId,
    segments: props.segments,
    speakerChoices: props.speakerChoices,
    active: showTranscript,
    onChanged,
  });
  const { segments, speakerChoices } = edits;
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const range = useAudioRange(audio);

  useImperativeHandle(controls, () => ({ playRange: range.play }), [range.play]);

  const entries = useMemo(() => mergeTranscript(segments, chat), [segments, chat]);
  const slots = useMemo(() => speakerSlots(segments), [segments]);
  const speakers = useMemo(() => [...slots.keys()], [slots]);
  const uncertain = useMemo(() => uncertainSegments(segments), [segments]);
  const filtering = onlyUncertain && uncertain.length > 0;
  const visible = filtering
    ? entries.filter((entry) => entry.kind === 'segment' && entry.segment.uncertain)
    : entries;
  const lane = (name: string | null) => (name ? speakers.indexOf(name) : -1);
  const slotOf = (name: string | null) => (name === null ? undefined : slots.get(name));
  const laneCount = Math.max(speakers.length, 1);
  const activeId = segments.findLast((s) => s.startMs <= currentMs)?.id;

  useEffect(() => {
    if (audio.current && !audio.current.paused) {
      active.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  const seek = (ms: number) => {
    if (!audio.current) return;
    range.clear();
    audio.current.currentTime = ms / 1000;
    void audio.current.play();
  };

  const toggle = () => {
    if (!audio.current) return;
    range.clear();
    if (audio.current.paused) void audio.current.play();
    else audio.current.pause();
  };

  const step = useCallback(
    (direction: 1 | -1) => {
      const id = stepUncertain(segments, cursorId, direction);
      if (id === null) return;
      setCursorId(id);
      const row = [...(list.current?.children ?? [])].find(
        (child) => child instanceof HTMLElement && child.dataset.segmentId === id,
      );
      row?.scrollIntoView({ block: 'center' });
      row?.querySelector<HTMLElement>('.speaker-name')?.focus({ preventScroll: true });
    },
    [segments, cursorId],
  );

  const reviewing = showTranscript && speakers.length > 0;
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '[') step(-1);
      if (event.key === ']') step(1);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [reviewing, step]);

  const durationMs = recording?.durationMs ?? 0;

  return (
    <>
      {recording && (
        <>
          <audio
            ref={audio}
            preload="metadata"
            src={recording.src}
            onTimeUpdate={(e) => {
              const ms = e.currentTarget.currentTime * 1000;
              setCurrentMs(ms);
              range.check(ms);
            }}
            onPlay={() => {
              setPlaying(true);
            }}
            onPause={() => {
              setPlaying(false);
            }}
          />
          <div className="player">
            <button className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                {playing ? (
                  <path d="M3 2h3.5v12H3zM9.5 2H13v12H9.5z" />
                ) : (
                  <path d="M3.5 1.8v12.4a.6.6 0 0 0 .9.5l10-6.2a.6.6 0 0 0 0-1L4.4 1.3a.6.6 0 0 0-.9.5z" />
                )}
              </svg>
            </button>
            <button
              className="timeline"
              aria-label="Seek"
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - box.left) / box.width) * durationMs);
              }}
            >
              <span className="rule" />
              {segments.map((s) => {
                const index = lane(s.speaker);
                return (
                  <i
                    key={s.id}
                    data-speaker-slot={slotOf(s.speaker)}
                    data-uncertain={s.uncertain || undefined}
                    style={{
                      background: 'var(--spk)',
                      left: `${(s.startMs / durationMs) * 100}%`,
                      width: `${Math.max(((s.endMs - s.startMs) / durationMs) * 100, 0.4)}%`,
                      top: `${(Math.max(index, 0) / laneCount) * 26 + 2}px`,
                      height: `${Math.max(26 / laneCount - 3, 4)}px`,
                    }}
                  />
                );
              })}
              <span className="head" style={{ left: `${(currentMs / durationMs) * 100}%` }} />
            </button>
            <span className="clock mono">
              {formatDuration(currentMs)} / {formatDuration(durationMs)}
            </span>
          </div>
        </>
      )}
      {reviewing && (
        <SpeakerReviewBar
          meetingId={meetingId}
          check={speakerCheck}
          uncertain={uncertain.length}
          hasSegments={segments.length > 0}
          onlyUncertain={onlyUncertain}
          onToggleOnly={setOnlyUncertain}
          onStep={step}
          onStarted={onChanged}
        />
      )}
      {speakers.length > 0 && (
        <ul className="speakers" aria-label="Speakers" hidden={!showTranscript}>
          {speakers.map((name) => (
            <li key={name} data-speaker-slot={slots.get(name)}>
              {name}
            </li>
          ))}
        </ul>
      )}
      <ol className="transcript" ref={list} hidden={!showTranscript}>
        {visible.map((entry) => {
          if (entry.kind === 'chat') {
            const { message } = entry;
            return (
              <li key={message.id} className="chat">
                <button
                  onClick={() => {
                    seek(message.offsetMs);
                  }}
                >
                  <span className="mono muted">{formatDuration(message.offsetMs)}</span>
                  <span className="bubble">
                    <strong>{message.sender}</strong>
                    <span className="chat-text">
                      {linkParts(message.text).map((part, index) =>
                        part.kind === 'link' ? (
                          <a
                            key={index}
                            href={part.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                          >
                            {part.text}
                          </a>
                        ) : (
                          part.text
                        ),
                      )}
                    </span>
                    <time dateTime={message.sentAt}>
                      {new Date(message.sentAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </span>
                </button>
              </li>
            );
          }
          const { segment } = entry;
          return (
            <SegmentLine
              key={segment.id}
              segment={segment}
              segments={segments}
              choices={speakerChoices}
              slot={slotOf(segment.speaker)}
              active={segment.id === activeId}
              reviewing={segment.id === cursorId}
              rowRef={segment.id === activeId ? active : undefined}
              onSeek={seek}
              onEdit={(input) => void edits.apply(input)}
            />
          );
        })}
      </ol>
      <UndoToast toast={edits.toast} onUndo={() => void edits.undo()} onDismiss={edits.dismiss} />
    </>
  );
}
