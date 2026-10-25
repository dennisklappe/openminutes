class MicrophoneError extends Error {}

export function describeMicrophoneError(error: unknown, secureContext: boolean): string {
  if (!secureContext) {
    return 'Recording needs a secure connection. Open OpenMinutes over HTTPS.';
  }
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Allow it for this site in your browser settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The microphone is in use by another app. Close it and try again.';
  }
  return 'The microphone could not be started.';
}

const NO_RECORDER_TEXT =
  'This browser cannot record audio. Update your browser (iPhone: iOS 14.5 or newer, in Safari) or use another one.';

export async function openMicrophone(): Promise<MediaStream> {
  const secure = window.isSecureContext;
  if (!secure || !('mediaDevices' in navigator)) {
    throw new MicrophoneError(describeMicrophoneError(undefined, false));
  }
  if (typeof MediaRecorder === 'undefined') throw new MicrophoneError(NO_RECORDER_TEXT);
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    throw new MicrophoneError(describeMicrophoneError(error, true));
  }
}
