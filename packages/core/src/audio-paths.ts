export const meetingFolder = (meetingId: string) => `meetings/${meetingId}`;
export const mergedAudioPath = (meetingId: string) => `${meetingFolder(meetingId)}/merged.opus`;
export const originalAudioPath = (meetingId: string) =>
  `${meetingFolder(meetingId)}/originals/merged.opus`;
