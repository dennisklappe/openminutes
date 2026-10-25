import type { ReactNode } from 'react';

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PencilIcon = () => (
  <Svg>
    <path d="m10.8 2.7 2.5 2.5L5.4 13.1l-3.2.7.7-3.2zM9.4 4.1l2.5 2.5" />
  </Svg>
);
export const MeetingsIcon = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10.5" rx="2" />
    <path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" />
  </Svg>
);
export const MinutesIcon = () => (
  <Svg>
    <path d="M4 1.8h5.2L12.5 5v8.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1zM9 1.8V5h3.5M5.5 8h5M5.5 10.6h5" />
  </Svg>
);
export const FolderIcon = () => (
  <Svg>
    <path d="M2 4.2a1 1 0 0 1 1-1h3l1.4 1.6H13a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
  </Svg>
);
export const BuildingIcon = () => (
  <Svg>
    <path d="M3.5 14V2.8a.8.8 0 0 1 .8-.8h5.4a.8.8 0 0 1 .8.8V14M10.5 6.5h1.7a.8.8 0 0 1 .8.8V14M2 14h12M6 5h2M6 7.6h2M6 10.2h2" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const SettingsIcon = () => (
  <Svg>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </Svg>
);
export const LinkIcon = () => (
  <Svg>
    <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.7.7" />
    <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.7-.7" />
  </Svg>
);
export const SearchIcon = () => (
  <Svg>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Svg>
);
export const SunIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </Svg>
);
export const MoonIcon = () => (
  <Svg>
    <path d="M13.5 9.6A5.7 5.7 0 0 1 6.4 2.5a5.7 5.7 0 1 0 7.1 7.1z" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
);
export const AlertIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.4M8 10.8v.1" />
  </Svg>
);
export const ChevronIcon = () => (
  <Svg>
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </Svg>
);
export const ClockIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.4" />
  </Svg>
);
export const UsersIcon = () => (
  <Svg>
    <circle cx="6" cy="5.6" r="2.4" />
    <path d="M1.8 13c.3-2.3 2-3.6 4.2-3.6s3.9 1.3 4.2 3.6M10.6 3.5a2.3 2.3 0 0 1 0 4.4M12.2 9.7c1.2.5 2 1.6 2.2 3.3" />
  </Svg>
);
export const SignOutIcon = () => (
  <Svg>
    <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10 5l3 3-3 3M13 8H6" />
  </Svg>
);

/** Google Meet: a camera body with a lens wedge, drawn in one colour. */
function MeetIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="icon">
      <rect x="1.5" y="4" width="10" height="10" rx="2.2" fill="#1a9f6b" />
      <path d="M12.5 7.6 16 5.4a.4.4 0 0 1 .6.35v6.5a.4.4 0 0 1-.6.35l-3.5-2.2z" fill="#2fbf84" />
    </svg>
  );
}

/** Microsoft Teams: a rounded tile with a T. */
function TeamsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="icon">
      <rect x="1.5" y="2.5" width="15" height="13" rx="3.2" fill="#5b5fc7" />
      <path d="M5.6 6.6h6.8M9 6.6v5.4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** A phone recording: a microphone. */
export function PhoneIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="icon">
      <rect x="6.5" y="1.8" width="5" height="9" rx="2.5" fill="currentColor" />
      <path
        d="M3.8 8.6a5.2 5.2 0 0 0 10.4 0M9 13.8v2.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function PlatformIcon({ platform }: { platform: 'meet' | 'teams' | 'recording' }) {
  if (platform === 'recording') return <PhoneIcon />;
  return platform === 'meet' ? <MeetIcon /> : <TeamsIcon />;
}
export const DocumentIcon = () => (
  <Svg>
    <path d="M4 1.8h5.2L12.5 5v9.2H4zM9 1.8V5.2h3.5M6 8.2h4.5M6 10.8h4.5" />
  </Svg>
);
export const ExternalIcon = () => (
  <Svg size={12}>
    <path d="M6.5 3H3v10h10V9.5M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />
  </Svg>
);
export const DownloadIcon = () => (
  <Svg>
    <path d="M8 2v8.2M4.8 7.2 8 10.4l3.2-3.2M2.5 13.5h11" />
  </Svg>
);
export const MoreIcon = () => (
  <Svg>
    <circle cx="3.5" cy="8" r="0.9" fill="currentColor" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    <circle cx="12.5" cy="8" r="0.9" fill="currentColor" />
  </Svg>
);
export const ArchiveIcon = () => (
  <Svg>
    <rect x="2" y="2.8" width="12" height="3.2" rx="1" />
    <path d="M3.2 6v6.2a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V6M6.5 9h3" />
  </Svg>
);
export const TrashIcon = () => (
  <Svg>
    <path d="M2.5 4.2h11M6 4.2V2.6h4v1.6M4 4.2l.6 8.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.4M6.6 7v3.6M9.4 7v3.6" />
  </Svg>
);
