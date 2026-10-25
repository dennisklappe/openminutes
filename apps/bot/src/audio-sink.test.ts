import { describe, expect, it } from 'vitest';
import { createAudioSink } from './audio-sink.js';

describe('createAudioSink', () => {
  it('gives each meeting its own sink so concurrent recordings stay apart', async () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return Promise.resolve('42');
    };

    const sink = await createAudioSink('0cb1a56a-5e13-4c22-b1bc-b94f251a1ea3', run);

    expect(calls).toEqual([
      ['load-module', 'module-null-sink', 'sink_name=openminutes_0cb1a56a5e13'],
    ]);
    expect(sink.source).toBe('openminutes_0cb1a56a5e13.monitor');
    expect(sink.env).toEqual({ PULSE_SINK: 'openminutes_0cb1a56a5e13' });

    await sink.dispose();
    expect(calls[1]).toEqual(['unload-module', '42']);
  });
});
