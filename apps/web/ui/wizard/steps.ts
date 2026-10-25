import type { WizardStep } from '../../src/dto.js';

export type StepId = 'password' | WizardStep;

export const flow: WizardStep[] = [
  'transcription',
  'summary',
  'calendar',
  'bot',
  'storage',
  'done',
];

export const stepIds: StepId[] = ['password', ...flow];

export const stepLabels: Record<StepId, string> = {
  password: 'Password',
  transcription: 'Transcription',
  summary: 'Summaries',
  calendar: 'Calendar',
  bot: 'Bot',
  storage: 'Storage',
  done: 'Finish',
};
