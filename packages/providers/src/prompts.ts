import { readFileSync } from 'node:fs';
import type { Segment } from './types.js';

const MEETING_SUMMARY_FILE = new URL('../prompts/meeting-summary.md', import.meta.url);

export const defaultMeetingSummaryPrompt = readFileSync(MEETING_SUMMARY_FILE, 'utf8').trim();

export function resolvePrompt(override?: string): string {
  return override?.trim() ? override.trim() : defaultMeetingSummaryPrompt;
}

function timestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export function formatTranscript(segments: Segment[]): string {
  return segments
    .map(
      (s) =>
        `[${timestamp(s.startMs)}] ${s.speaker ? `${s.speaker}${s.speakerUncertain ? '?' : ''}: ` : ''}${s.text}`,
    )
    .join('\n');
}

export const CHAT_HEADING = '## Chat messages';

export const chatInstructions = `The input ends with a "${CHAT_HEADING.slice(3)}" section, one line per message in the form \`[hh:mm:ss] Sender: text\`. It is extra context for the meeting, not part of what was said aloud. Do not retell the chat in the other sections. Add a final section \`## Resources\` with a bullet for every URL shared in the chat: the URL, a few words on what it is for, and who shared it. Leave the section out when the chat shares no URL.`;

export function formatChat(messages: { offsetMs: number; sender: string; text: string }[]): string {
  return messages
    .map((m) => `[${timestamp(m.offsetMs)}] ${m.sender}: ${m.text.replace(/\s+/g, ' ').trim()}`)
    .join('\n');
}
