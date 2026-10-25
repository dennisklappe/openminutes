import { seeded } from './random.js';
import { VOICES, type Scenario, type Utterance } from './scenarios.js';

const SENTENCES = [
  'Hello, this is about the appointment we planned for next week.',
  'I can come by on Tuesday afternoon if that works for you.',
  'The invoice should have been paid at the end of last month.',
  'Could you send me the address once more, please?',
  'We had a problem with the delivery, the box arrived damaged.',
  'I will call the supplier tomorrow morning and let you know.',
  'That sounds good to me, let us do it that way.',
  'Do you have a reference number for the order?',
  'The technician will visit between nine and twelve.',
  'I am not sure about the price, it seems higher than before.',
  'Thank you for calling, is there anything else I can help with?',
  'Yes, one more thing about the contract that I wanted to ask.',
];

interface PhoneShape {
  name: string;
  speakers: number;
  seed: number;
  turns: number;
  /** Gap in ms inserted before the speaker at this turn index, to model a pause on the line. */
  pauses?: Record<number, number>;
}

const SHAPES: readonly PhoneShape[] = [
  { name: 'phone-2a', speakers: 2, seed: 2001, turns: 16 },
  { name: 'phone-2b', speakers: 2, seed: 2002, turns: 16 },
  { name: 'phone-3a', speakers: 3, seed: 2003, turns: 20 },
  { name: 'phone-3b', speakers: 3, seed: 2004, turns: 20 },
  { name: 'phone-4a', speakers: 4, seed: 2005, turns: 24 },
  { name: 'phone-4b', speakers: 4, seed: 2006, turns: 24 },
  { name: 'pause-2', speakers: 2, seed: 2007, turns: 14, pauses: { 7: 25_000 } },
  { name: 'pause-1', speakers: 1, seed: 2008, turns: 6, pauses: { 3: 25_000 } },
];

function build(shape: PhoneShape): Scenario {
  const random = seeded(shape.seed);
  const speakers = Array.from({ length: shape.speakers }, (_, i) => `speaker-${String(i + 1)}`);
  const utterances: Utterance[] = [];
  let current = speakers[0] ?? '';
  for (let turn = 0; turn < shape.turns; turn++) {
    if (turn > 0 && speakers.length > 1) {
      current = random.pick(speakers.filter((speaker) => speaker !== current));
    }
    const count = random.int(1, 3);
    for (let i = 0; i < count; i++) {
      const pause = i === 0 ? shape.pauses?.[turn] : undefined;
      utterances.push({
        speaker: current,
        text: random.pick(SENTENCES),
        gapMs: pause ?? Math.round(i === 0 ? random.between(150, 700) : random.between(150, 400)),
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

const SHORT_REPLIES = [
  'Yes, that works for me.',
  'Right, I see what you mean.',
  'Okay, sounds good to me.',
  'No, not really.',
  'I agree with that.',
  'Fine by me, go ahead.',
  'Tomorrow would be fine.',
  'Of course, no problem.',
  'Yes, I can do that.',
  'That was quite nice.',
];

interface RapidShape {
  name: string;
  seed: number;
  /** Volume of the second voice relative to the first, a far speaker on a table recording. */
  quietGain: number;
  exchanges: number;
}

const RAPID_SHAPES: readonly RapidShape[] = [
  { name: 'rapid-2a', seed: 2101, quietGain: 0.35, exchanges: 30 },
  { name: 'rapid-2b', seed: 2102, quietGain: 0.5, exchanges: 30 },
];

/** Two voices at a table: one talks in sentences, the other mostly answers in 1 to 2 s replies. */
function buildRapid(shape: RapidShape): Scenario {
  const random = seeded(shape.seed);
  const [talker, answerer] = ['speaker-1', 'speaker-2'] as const;
  const utterances: Utterance[] = [];
  for (let i = 0; i < shape.exchanges; i++) {
    const long = i % 3 === 0;
    utterances.push({
      speaker: talker,
      text: long ? random.pick(SENTENCES) : random.pick(SHORT_REPLIES),
      gapMs: Math.round(random.between(100, 350)),
    });
    utterances.push({
      speaker: answerer,
      text: random.pick(SHORT_REPLIES),
      gapMs: Math.round(random.between(100, 350)),
    });
  }
  return {
    name: shape.name,
    speakers: 2,
    utterances,
    voices: { [talker]: VOICES[0], [answerer]: VOICES[1] },
    gains: { [answerer]: shape.quietGain },
  };
}

export const phoneScenarios = (): Scenario[] => [
  ...SHAPES.map(build),
  ...RAPID_SHAPES.map(buildRapid),
];
