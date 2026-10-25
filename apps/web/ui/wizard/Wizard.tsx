import { useState, type ReactNode } from 'react';
import type { WizardStep } from '../../src/dto.js';
import { api } from '../api.js';
import { JoinBox } from '../JoinBox.js';
import { BotSettings } from '../pages/BotSettings.js';
import { CalendarSection } from '../pages/CalendarSection.js';
import { TimeZoneSettings } from '../pages/TimeZoneSettings.js';
import { LimitsSettings } from '../pages/LimitsSettings.js';
import { ProviderSection } from '../pages/ProviderSection.js';
import { StorageSettings } from '../pages/StorageSettings.js';
import { flow } from './steps.js';
import { WizardFrame } from './WizardFrame.js';

const content: Record<
  Exclude<WizardStep, 'done'>,
  { title: string; intro: string; body: (route: string) => ReactNode }
> = {
  transcription: {
    title: 'Transcription',
    intro:
      'OpenMinutes transcribes each meeting after it ends. The default is the local Whisper service, which needs no key. Pick a hosted provider if you prefer, and use Test to check it works.',
    body: () => <ProviderSection client={api.transcriptionSettings} />,
  },
  summary: {
    title: 'Summaries',
    intro:
      'A summary needs a language model. Skip this to keep summaries off, you can add one later in Settings.',
    body: () => <ProviderSection client={api.summarySettings} />,
  },
  calendar: {
    title: 'Calendar',
    intro:
      'Connect a calendar so OpenMinutes joins your meetings by itself. This needs your own OAuth app, the guides walk you through it. You can also skip this and paste meeting links by hand.',
    body: (route) => <CalendarSection route={route} />,
  },
  bot: {
    title: 'The bot',
    intro:
      'The bot joins as a guest and announces itself by name. The defaults work, change them if you like.',
    body: () => (
      <>
        <BotSettings />
        <TimeZoneSettings />
        <LimitsSettings />
      </>
    ),
  },
  storage: {
    title: 'Storage and retention',
    intro:
      'Recordings stay on the local volume by default. Use an S3-compatible bucket if you prefer, and decide how long audio is kept.',
    body: () => <StorageSettings />,
  },
};

export function Wizard({
  initialStep,
  route,
  onFinished,
}: {
  initialStep: WizardStep;
  route: string;
  onFinished: (meetingId?: string) => void;
}) {
  const [step, setStep] = useState(initialStep);
  const position = flow.indexOf(step);

  const go = (target: WizardStep) => {
    setStep(target);
    void api.saveWizard({ step: target });
  };
  const finish = (meetingId?: string) => {
    void api.saveWizard({ completed: true }).then(() => {
      onFinished(meetingId);
    });
  };
  const previous = flow[position - 1];
  const next = flow[position + 1];

  if (step === 'done') {
    return (
      <WizardFrame
        current="done"
        title="You are set up"
        intro="Paste a meeting link to send the bot in right now, or open OpenMinutes and wait for your calendar."
      >
        <JoinBox
          onJoined={(meeting) => {
            finish(meeting.id);
          }}
        />
        <div className="actions wizard-nav">
          <button
            onClick={() => {
              go('storage');
            }}
          >
            Back
          </button>
          <button
            className="primary"
            onClick={() => {
              finish();
            }}
          >
            Open OpenMinutes
          </button>
        </div>
      </WizardFrame>
    );
  }

  const { title, intro, body } = content[step];
  return (
    <WizardFrame current={step} title={title} intro={intro}>
      {body(route)}
      <div className="actions wizard-nav">
        {previous && (
          <button
            onClick={() => {
              go(previous);
            }}
          >
            Back
          </button>
        )}
        <button
          className="link"
          onClick={() => {
            finish();
          }}
        >
          Skip setup
        </button>
        {next && (
          <button
            className="primary"
            onClick={() => {
              go(next);
            }}
          >
            Next
          </button>
        )}
      </div>
    </WizardFrame>
  );
}
