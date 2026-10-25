import { useEffect, useRef } from 'react';

const BARS = 24;

export function LevelMeter({ analyser }: { analyser: AnalyserNode | undefined }) {
  const meter = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = meter.current;
    if (!analyser || !element) return;
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const draw = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      element.style.setProperty('--level', level.toFixed(3));
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      element.style.setProperty('--level', '0');
    };
  }, [analyser]);
  return (
    <div className="level-meter" ref={meter} role="img" aria-label="Microphone level">
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} style={{ '--at': (i + 1) / BARS } as React.CSSProperties} />
      ))}
    </div>
  );
}
