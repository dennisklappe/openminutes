export type MicState = 'on' | 'off' | 'unknown';

export interface MicControl {
  state(): Promise<MicState>;
  toggle(): Promise<void>;
  wait(ms: number): Promise<void>;
}

const MUTE_ATTEMPTS = 5;
const SETTLE_MS = 300;

export async function muteMicrophone(control: MicControl): Promise<boolean> {
  for (let attempt = 0; attempt < MUTE_ATTEMPTS; attempt++) {
    const state = await control.state();
    if (state === 'off') return true;
    if (state === 'on') await control.toggle();
    await control.wait(SETTLE_MS);
  }
  return (await control.state()) === 'off';
}
