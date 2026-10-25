import { CHAT_HEADING, chatInstructions, type SummaryProvider } from '@openminutes/providers';

const MAX_ROUNDS = 4;

const CHAT_NOTES = ` Lines under "${CHAT_HEADING.slice(3)}" are chat messages: keep every URL in them, with who shared it, and do not retell the rest.`;

const notesPrompt = (index: number, total: number, withChat: boolean) =>
  `You are given excerpt ${index} of ${total} of a meeting transcript, or of notes taken on one. Write compact, factual notes in the language of the excerpt: topics discussed, decisions, action items with owner and deadline when named, and open questions. Use only what is in the excerpt and keep speaker names. Do not add an introduction or a conclusion.${withChat ? CHAT_NOTES : ''}`;

const COMBINED_NOTES = `The input is not a transcript. It is a set of notes on consecutive excerpts of one meeting. Treat them together as the whole meeting and follow the instructions above.`;

export function splitText(text: string, limit: number): string[] {
  const parts: string[] = [];
  let current = '';
  const flush = () => {
    if (current) parts.push(current);
    current = '';
  };
  for (const line of text.split('\n')) {
    for (let start = 0; start === 0 || start < line.length; start += limit) {
      const piece = line.slice(start, start + limit);
      if (current.length + piece.length + 1 > limit) flush();
      current += current ? `\n${piece}` : piece;
    }
  }
  flush();
  return parts;
}

export async function summarizeTranscript(
  provider: SummaryProvider,
  transcript: string,
  basePrompt: string,
  chat = '',
): Promise<string> {
  const limit = provider.maxInputChars;
  const text = chat ? `${transcript}\n\n${CHAT_HEADING}\n${chat}` : transcript;
  const prompt = chat ? `${basePrompt}\n\n${chatInstructions}` : basePrompt;
  if (text.length <= limit) return provider.summarize(text, prompt);

  let parts = splitText(text, limit);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const notes: string[] = [];
    for (const [index, part] of parts.entries()) {
      notes.push(await provider.summarize(part, notesPrompt(index + 1, parts.length, chat !== '')));
    }
    const combined = notes.map((note, i) => `### Excerpt ${i + 1}\n\n${note}`).join('\n\n');
    if (combined.length <= limit) {
      return provider.summarize(combined, `${prompt}\n\n${COMBINED_NOTES}`);
    }
    parts = splitText(combined, limit);
  }
  throw new Error(
    `The notes are still larger than the model input limit after ${MAX_ROUNDS} condensing rounds, raise the limit or use a model with a larger context`,
  );
}
