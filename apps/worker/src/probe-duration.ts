import { runFfmpeg } from './ffmpeg.js';

export type ProbeDuration = (path: string) => Promise<number>;

const DURATION = /Duration: (\d+):(\d{2}):(\d{2})\.(\d{2})/;

export function parseDuration(log: string): number | undefined {
  const match = DURATION.exec(log);
  if (!match) return undefined;
  const [, hours = '0', minutes = '0', seconds = '0', hundredths = '0'] = match;
  return (
    ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(hundredths) * 10
  );
}

export const probeDuration: ProbeDuration = async (path) => {
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', path, '-t', '0', '-f', 'null', '-']);
  const duration = parseDuration(stderr);
  if (duration === undefined) throw new Error('The length of the audio could not be read');
  return duration;
};
