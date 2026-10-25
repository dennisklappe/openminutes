import type { ReactNode } from 'react';
import { Brand } from './Brand.js';
import {
  MeetingsIcon,
  MinutesIcon,
  MoonIcon,
  SettingsIcon,
  SignOutIcon,
  SunIcon,
} from './icons.js';
import { useTheme, type Theme } from './theme.js';
import { RecordLink } from './recorder/RecordLink.js';
import { StoredLinks } from './StoredLinks.js';
import { UpdateBanner, VersionLabel } from './Updates.js';

const order: Theme[] = ['system', 'light', 'dark'];
const labels: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = order[(order.indexOf(theme) + 1) % order.length] ?? 'system';
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <button
      className="nav-item"
      onClick={() => {
        setTheme(next);
      }}
      title={`Theme: ${labels[theme]}. Click for ${labels[next]}.`}
    >
      {dark ? <MoonIcon /> : <SunIcon />}
      <span>Theme: {labels[theme]}</span>
    </button>
  );
}

export function Shell(props: {
  route: string;
  email?: string | undefined;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { route, email, onSignOut, children } = props;
  const settings = route.startsWith('/settings');
  const minutes = route.startsWith('/minutes');
  const record = route === '/record';
  const stored = route === '/archive' || route === '/bin';
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Main">
          <a
            className="nav-item"
            href="#/"
            aria-current={settings || record || minutes || stored ? undefined : 'page'}
          >
            <MeetingsIcon />
            <span>Meetings</span>
          </a>
          <a
            className="nav-item"
            href="#/minutes"
            aria-current={minutes || stored ? 'page' : undefined}
          >
            <MinutesIcon />
            <span>Minutes</span>
          </a>
          <RecordLink className="nav-item record-link" current={record} />
          <a className="nav-item" href="#/settings" aria-current={settings ? 'page' : undefined}>
            <SettingsIcon />
            <span>Settings</span>
          </a>
        </nav>
        <div className="sidebar-foot">
          <StoredLinks route={route} where="sidebar" />
          <ThemeToggle />
          {email ? (
            <span className="nav-item static" title={email}>
              <span className="avatar">{email.slice(0, 1).toUpperCase()}</span>
              <span className="truncate">{email}</span>
            </span>
          ) : (
            <button className="nav-item" onClick={onSignOut}>
              <SignOutIcon />
              <span>Sign out</span>
            </button>
          )}
          <VersionLabel />
        </div>
      </aside>
      <main>
        <UpdateBanner />
        {children}
      </main>
    </div>
  );
}
