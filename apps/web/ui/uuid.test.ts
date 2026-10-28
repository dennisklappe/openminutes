import { describe, expect, it } from 'vitest';
import { uuid } from './uuid.js';

describe('uuid', () => {
  it('falls back to getRandomValues when randomUUID is missing (plain http)', () => {
    const insecure = {
      getRandomValues: <T extends ArrayBufferView>(array: T) => {
        new Uint8Array(array.buffer).fill(0xff);
        return array;
      },
    };
    const id = uuid(insecure);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('gives different ids with the real crypto without randomUUID', () => {
    const bare = {
      getRandomValues: <T extends ArrayBufferView>(array: T) => crypto.getRandomValues(array),
    };
    expect(uuid(bare)).not.toBe(uuid(bare));
  });

  it('uses randomUUID when present', () => {
    expect(
      uuid({
        getRandomValues: crypto.getRandomValues.bind(crypto),
        randomUUID: () => 'x' as never,
      }),
    ).toBe('x');
  });
});
