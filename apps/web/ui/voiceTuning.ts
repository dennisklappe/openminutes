import type { VoiceTuningDto } from '../src/dto.js';

export interface TuningField {
  key: keyof VoiceTuningDto;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const TUNING_FIELDS: readonly TuningField[] = [
  {
    key: 'readySeconds',
    label: 'Seconds of clean speech for a ready profile',
    min: 10,
    max: 3600,
    step: 10,
  },
  { key: 'readyMeetings', label: 'Meetings for a ready profile', min: 1, max: 50, step: 1 },
  { key: 'readyWays', label: 'Ways of sounding for a ready profile', min: 1, max: 30, step: 1 },
  {
    key: 'agreeScore',
    label: 'Score at which a voice agrees with a profile',
    min: 0.2,
    max: 0.95,
    step: 0.05,
  },
  {
    key: 'mergeSimilarity',
    label: 'Similarity at which a sample joins a way of sounding',
    min: 0.2,
    max: 0.95,
    step: 0.05,
  },
];

/** A typed value kept inside the range of its field. Whole numbers for counts and seconds. */
export function clampTuning(field: TuningField, value: number): number {
  const whole = Number.isInteger(field.step);
  const bounded = Math.min(field.max, Math.max(field.min, value));
  return whole ? Math.round(bounded) : Math.round(bounded * 100) / 100;
}

/** Every value clamped, a value that is not a number falls back to the default. */
export function clampAll(values: VoiceTuningDto, defaults: VoiceTuningDto): VoiceTuningDto {
  const next = { ...values };
  for (const field of TUNING_FIELDS) {
    const value = values[field.key];
    next[field.key] = Number.isFinite(value) ? clampTuning(field, value) : defaults[field.key];
  }
  return next;
}

export const tuningIsDefault = (values: VoiceTuningDto, defaults: VoiceTuningDto) =>
  TUNING_FIELDS.every((field) => values[field.key] === defaults[field.key]);
