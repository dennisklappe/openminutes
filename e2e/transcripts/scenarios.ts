import { seeded, type Random } from './random.js';

export const VOICES = [
  'en_US-lessac-medium',
  'en_US-ryan-medium',
  'en_US-amy-medium',
  'en_GB-alan-medium',
  'en_US-kristin-medium',
] as const;

export interface Utterance {
  speaker: string;
  text: string;
  gapMs: number;
  interjection?: boolean;
}

export interface Scenario {
  name: string;
  speakers: number;
  utterances: Utterance[];
  voices: Record<string, string>;
  /** Volume per speaker (default 1), to model a far or quiet voice. */
  gains?: Record<string, number>;
}

interface Shape {
  name: string;
  speakers: number;
  seed: number;
  turns: number;
  turnGapMs: readonly [number, number];
  overlapRate: number;
  interjectionRate: number;
  runOn?: true;
}

const SENTENCES = [
  'The release is planned for the end of next month.',
  'I still need to finish the payment integration before we can test it.',
  'Can you check whether the new pricing page is live yet?',
  'We should talk to the customer before we change the contract.',
  'The backend is almost ready and the tests are passing.',
  'Last time the review took a week, so we should submit early.',
  'I will prepare the campaign and send the announcement on Monday.',
  'Does anyone have a problem with moving the meeting to Thursday?',
  'The numbers from last quarter look better than we expected.',
  'Please send me the document so I can review it tonight.',
  'We need a decision on the budget before the end of the week.',
  'The design team has finished the first version of the new dashboard.',
  'I think the main risk is that we run out of time.',
  'Let us make sure that everybody knows who owns which task.',
  'The support queue is much shorter than it was a month ago.',
  'I can take the follow up with the supplier if nobody else wants it.',
  'There is one open question about the old invoices.',
  'We agreed to share the notes with the whole team after the call.',
  'The new onboarding flow reduced the drop off quite a lot.',
  'Could you explain how the export feature handles large files?',
];

const BACKCHANNELS = ['Yes.', 'Right.', 'Okay.', 'Sure.', 'Exactly.', 'Agreed.'];

const SHAPES: readonly Shape[] = [
  {
    name: 'two-speakers',
    seed: 1000,
    speakers: 2,
    turns: 14,
    turnGapMs: [400, 1500],
    overlapRate: 0,
    interjectionRate: 0,
  },
  {
    name: 'three-speakers',
    seed: 1001,
    speakers: 3,
    turns: 18,
    turnGapMs: [300, 1500],
    overlapRate: 0,
    interjectionRate: 0,
  },
  {
    name: 'five-speakers',
    seed: 1002,
    speakers: 5,
    turns: 24,
    turnGapMs: [300, 1500],
    overlapRate: 0,
    interjectionRate: 0,
  },
  {
    name: 'quick-replies-3',
    seed: 1003,
    speakers: 3,
    turns: 18,
    turnGapMs: [50, 400],
    overlapRate: 0,
    interjectionRate: 0,
  },
  {
    name: 'run-on-2',
    seed: 1004,
    speakers: 2,
    turns: 14,
    turnGapMs: [400, 1500],
    overlapRate: 0,
    interjectionRate: 0,
    runOn: true,
  },
  {
    name: 'late-turns-4',
    seed: 1006,
    speakers: 4,
    turns: 20,
    turnGapMs: [50, 500],
    overlapRate: 0,
    interjectionRate: 0,
  },
  {
    name: 'overlap-3',
    seed: 1005,
    speakers: 3,
    turns: 18,
    turnGapMs: [200, 900],
    overlapRate: 0.3,
    interjectionRate: 0.3,
  },
];

function turnOf(random: Random, speaker: string, shape: Shape, first: boolean): Utterance[] {
  const sentences = Array.from({ length: random.int(1, 3) }, () => random.pick(SENTENCES));
  const gapMs = first
    ? 600
    : random.chance(shape.overlapRate)
      ? -random.between(250, 700)
      : random.between(...shape.turnGapMs);
  if (shape.runOn) {
    const text = sentences.map((sentence) => sentence.replace(/[.,?]/g, '').toLowerCase());
    return [{ speaker, text: text.join(' '), gapMs: Math.round(gapMs) }];
  }
  return sentences.map((text, i) => ({
    speaker,
    text,
    gapMs: Math.round(i === 0 ? gapMs : random.between(150, 500)),
  }));
}

function build(shape: Shape, seed: number): Scenario {
  const random = seeded(seed);
  const speakers = Array.from({ length: shape.speakers }, (_, i) => `speaker-${i + 1}`);
  const utterances: Utterance[] = [];
  let current = speakers[0] ?? '';
  for (let turn = 0; turn < shape.turns; turn++) {
    const others = speakers.filter((speaker) => speaker !== current);
    current = turn === 0 ? current : random.pick(others);
    utterances.push(...turnOf(random, current, shape, turn === 0));
    if (shape.interjectionRate > 0 && random.chance(shape.interjectionRate)) {
      const interjector = random.pick(speakers.filter((speaker) => speaker !== current));
      utterances.push({
        speaker: interjector,
        text: random.pick(BACKCHANNELS),
        gapMs: -random.int(100, 300),
        interjection: true,
      });
      utterances.push({
        speaker: current,
        text: random.pick(SENTENCES),
        gapMs: random.int(0, 200),
      });
    }
  }
  return {
    name: shape.name,
    speakers: shape.speakers,
    utterances,
    voices: Object.fromEntries(speakers.map((speaker, i) => [speaker, VOICES[i] ?? VOICES[0]])),
  };
}

export const scenarios = (): Scenario[] => SHAPES.map((shape) => build(shape, shape.seed));
