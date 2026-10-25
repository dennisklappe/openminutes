import { describe, expect, it } from 'vitest';
import { muteMicrophone, type MicState } from './mic.js';

function control(states: MicState[]) {
  const toggles: number[] = [];
  let index = 0;
  return {
    toggles,
    state: () => Promise.resolve(states[Math.min(index++, states.length - 1)] as MicState),
    toggle: () => {
      toggles.push(index);
      return Promise.resolve();
    },
    wait: () => Promise.resolve(),
  };
}

describe('muteMicrophone', () => {
  it('does nothing when the microphone is already off', async () => {
    const mic = control(['off']);
    await expect(muteMicrophone(mic)).resolves.toBe(true);
    expect(mic.toggles).toEqual([]);
  });

  it('presses mute once when the microphone is on', async () => {
    const mic = control(['on', 'off']);
    await expect(muteMicrophone(mic)).resolves.toBe(true);
    expect(mic.toggles).toHaveLength(1);
  });

  it('presses mute again when the first press did not take', async () => {
    const mic = control(['on', 'on', 'off']);
    await expect(muteMicrophone(mic)).resolves.toBe(true);
    expect(mic.toggles).toHaveLength(2);
  });

  it('reports failure when the state never shows off', async () => {
    await expect(muteMicrophone(control(['on']))).resolves.toBe(false);
    await expect(muteMicrophone(control(['unknown']))).resolves.toBe(false);
  });
});
