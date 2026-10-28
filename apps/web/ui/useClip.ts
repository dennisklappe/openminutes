import { useEffect, useRef, useState } from 'react';

/** The clip that is playing now, so starting another one stops it. */
let playing: HTMLAudioElement | undefined;

export interface Clip {
  startMs: number;
  endMs: number;
}

/**
 * Plays one stretch of the meeting audio on an element of its own, so the main player, the scroll
 * position and the focus stay where they are. Only one clip plays at a time, and it stops when the
 * component goes away. Put the returned ref on an `<audio src preload="none">`.
 */
export function useClip(clip: Clip | undefined, maxMs: number) {
  const audio = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState(false);

  const stop = () => {
    audio.current?.pause();
    setActive(false);
  };

  useEffect(() => stop, []);

  const play = () => {
    const element = audio.current;
    if (!element || !clip) return;
    if (playing && playing !== element) playing.pause();
    playing = element;
    const endsAt = Math.min(clip.endMs, clip.startMs + maxMs) / 1000;
    const start = () => {
      element.currentTime = clip.startMs / 1000;
      element.play().then(
        () => {
          setActive(true);
        },
        () => {
          setActive(false);
        },
      );
    };
    element.ontimeupdate = () => {
      if (element.currentTime >= endsAt) stop();
    };
    element.onended = stop;
    element.onpause = () => {
      setActive(false);
    };
    if (element.readyState >= 1) start();
    else {
      element.onloadedmetadata = start;
      element.load();
    }
  };

  return { audio, active, play, stop };
}
