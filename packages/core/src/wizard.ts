import type { SettingsStore } from './settings.js';

export const wizardSteps = [
  'transcription',
  'summary',
  'calendar',
  'bot',
  'storage',
  'done',
] as const;

export type WizardStep = (typeof wizardSteps)[number];

export interface WizardState {
  completed: boolean;
  step: WizardStep;
}

export interface WizardPatch {
  step?: WizardStep | undefined;
  completed?: boolean | undefined;
}

export async function loadWizard(settings: SettingsStore): Promise<WizardState> {
  const [completed, step] = await Promise.all([
    settings.get('wizard.completed'),
    settings.get('wizard.step'),
  ]);
  return {
    completed: completed !== 'false',
    step: wizardSteps.find((candidate) => candidate === step) ?? wizardSteps[0],
  };
}

export async function saveWizard(
  settings: SettingsStore,
  patch: WizardPatch,
): Promise<WizardState> {
  if (patch.step) await settings.set('wizard.step', patch.step);
  if (patch.completed !== undefined)
    await settings.set('wizard.completed', String(patch.completed));
  return loadWizard(settings);
}
