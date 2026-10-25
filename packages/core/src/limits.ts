export const MAX_CONCURRENT_MEETINGS = 10;

const EXPIRY_MARGIN_SECONDS = 600;

export const joinJobExpirySeconds = (lobbyTimeoutSeconds: number, maxDurationMinutes: number) =>
  lobbyTimeoutSeconds + maxDurationMinutes * 60 + EXPIRY_MARGIN_SECONDS;
