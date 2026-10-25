import { useEffect, useRef, useState } from 'react';
import type { SpeakerChoiceDto, SpeakerTargetInput } from '../src/dto.js';
import { otherSpeaker, splitParts, splitWords } from './speakerEdits.js';

interface Props {
  text: string;
  choices: SpeakerChoiceDto[];
  currentId: string | null;
  onSplit: (wordIndex: number, speaker: SpeakerTargetInput) => void;
  onCancel: () => void;
}

/**
 * Two steps: pick the gap between two words (click, or arrows and Enter), then who says the second
 * half. Escape cancels at any point.
 */
export function SplitLine({ text, choices, currentId, onSplit, onCancel }: Props) {
  const words = splitWords(text);
  const [gap, setGap] = useState<number>();
  const [at, setAt] = useState(Math.ceil(words.length / 2));
  const root = useRef<HTMLDivElement>(null);
  const fallback = otherSpeaker(choices, currentId);
  const preferred = 'id' in fallback ? fallback.id : undefined;

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[tabindex="0"], [data-default]')?.focus();
  }, [gap, at]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (gap !== undefined) return;
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    setAt((value) => Math.min(Math.max(value + step, 1), words.length - 1));
  };

  const parts = splitParts(words, gap ?? at);
  return (
    <div
      ref={root}
      className="split-line"
      role="group"
      aria-label="Split line"
      onKeyDown={onKeyDown}
    >
      {gap === undefined ? (
        <>
          <p className="split-hint muted">
            Choose where the line splits: click between words, or use the arrow keys and Enter.
          </p>
          <p className="split-words">
            {words.map((word, index) => (
              <span key={index}>
                {index > 0 && (
                  <button
                    type="button"
                    className="split-gap"
                    tabIndex={index === at ? 0 : -1}
                    aria-label={`Split before ${word}`}
                    aria-current={index === at}
                    onClick={() => {
                      setGap(index);
                    }}
                  />
                )}
                {word}{' '}
              </span>
            ))}
          </p>
        </>
      ) : (
        <>
          <p className="split-words">
            <span>{parts[0]}</span> <span className="split-second">{parts[1]}</span>
          </p>
          <p className="split-hint muted">Who says the second part?</p>
          <div className="split-speakers">
            {choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                data-default={choice.id === preferred || undefined}
                onClick={() => {
                  onSplit(gap, { id: choice.id });
                }}
              >
                {choice.name}
              </button>
            ))}
            <button
              type="button"
              data-default={preferred === undefined || undefined}
              onClick={() => {
                onSplit(gap, { create: true });
              }}
            >
              New speaker
            </button>
          </div>
        </>
      )}
      <button type="button" className="split-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
