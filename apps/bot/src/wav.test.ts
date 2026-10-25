import { describe, expect, it } from 'vitest';
import { pcm16Wav, silentWav } from './wav.js';

describe('wav', () => {
  it('writes a mono 16-bit PCM header around the samples', () => {
    const wav = pcm16Wav(new Int16Array([1, -1, 2]), 8000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(8000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(6);
    expect(wav.readInt16LE(46)).toBe(-1);
  });

  it('is silent', () => {
    const wav = silentWav();
    expect(wav.subarray(44).every((byte) => byte === 0)).toBe(true);
    expect(wav.length).toBeGreaterThan(44);
  });
});
