import type { BrowserContext, Page } from 'playwright-core';

const LOUD_PEAK = 0.02;
const SAMPLE_MS = 250;
const GLOBAL = '__openminutesMic';

const guardScript = `(() => {
  const media = navigator.mediaDevices;
  if (!media) return;
  const guard = { loud: 0, peak: 0 };
  window.${GLOBAL} = guard;
  const original = media.getUserMedia.bind(media);
  media.getUserMedia = async (constraints) => {
    const stream = await original(constraints);
    for (const track of stream.getAudioTracks()) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 32768;
      const silencer = context.createGain();
      silencer.gain.value = 0;
      context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      analyser.connect(silencer).connect(context.destination);
      const samples = new Float32Array(analyser.fftSize);
      setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        guard.peak = Math.max(guard.peak, peak);
        if (peak < ${LOUD_PEAK}) return;
        guard.loud += 1;
        track.enabled = false;
      }, ${SAMPLE_MS});
    }
    return stream;
  };
})();`;

export async function installMicGuard(context: BrowserContext): Promise<void> {
  await context.addInitScript(guardScript);
}

export const loudMicSamples = (page: Page): Promise<number> =>
  page.evaluate<number>(`window.${GLOBAL}?.loud ?? 0`);
