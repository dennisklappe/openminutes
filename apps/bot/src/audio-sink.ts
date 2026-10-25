import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type Pactl = (args: string[]) => Promise<string>;

export interface AudioSink {
  source: string;
  env: Record<string, string>;
  dispose(): Promise<void>;
}

const pactl: Pactl = async (args) => (await execFileAsync('pactl', args)).stdout.trim();

export async function createAudioSink(meetingId: string, run: Pactl = pactl): Promise<AudioSink> {
  const name = `openminutes_${meetingId.replaceAll('-', '').slice(0, 12)}`;
  const moduleId = await run(['load-module', 'module-null-sink', `sink_name=${name}`]);
  return {
    source: `${name}.monitor`,
    env: { PULSE_SINK: name },
    dispose: async () => {
      await run(['unload-module', moduleId]);
    },
  };
}
