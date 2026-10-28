import { useEffect, useRef, type ReactNode } from 'react';
import { api } from '../api.js';
import { Panel, SectionHead } from '../Panel.js';
import { useTheme, type Theme } from '../theme.js';
import { TimeZoneSettings } from './TimeZoneSettings.js';
import { UpdateSettings } from '../Updates.js';
import { ApiKeysSettings } from './ApiKeysSettings.js';
import { BotSettings } from './BotSettings.js';
import { CalendarSection } from './CalendarSection.js';
import { EmailSettings } from './EmailSettings.js';
import { GoogleSessionSettings } from './GoogleSessionSettings.js';
import { LimitsSettings } from './LimitsSettings.js';
import { MinutesSettings } from './MinutesSettings.js';
import { PromptsSection } from './PromptsSection.js';
import { ImportSettings } from './ImportSettings.js';
import { PhoneSettings } from './PhoneSettings.js';
import { SharedAccountsSettings } from './SharedAccountsSettings.js';
import { SpeakerSettings } from './SpeakerSettings.js';
import { SummaryChatSettings } from './SummaryChatSettings.js';
import { ProviderSection } from './ProviderSection.js';
import { StorageSettings } from './StorageSettings.js';

function Appearance() {
  const [theme, setTheme] = useTheme();
  const options: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  return (
    <Panel title="Appearance" description="Applies to this browser only.">
      <div className="segmented" role="group" aria-label="Theme">
        {options.map(({ value, label }) => (
          <button
            key={value}
            aria-pressed={theme === value}
            onClick={() => {
              setTheme(value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function WizardReopen() {
  const reopen = () => {
    void api.saveWizard({ completed: false, step: 'transcription' }).then(() => {
      window.location.hash = '#/';
      window.location.reload();
    });
  };
  return (
    <Panel
      title="Setup wizard"
      description="Walk through the first-run setup again. Your current settings are kept."
      foot={<button onClick={reopen}>Open the setup wizard</button>}
    >
      <></>
    </Panel>
  );
}

function Access({ email, onSignOut }: { email?: string | undefined; onSignOut: () => void }) {
  return (
    <Panel
      title="Access"
      description={
        email
          ? 'Sign in is handled by Cloudflare Access. Manage who can reach this instance in your Cloudflare Zero Trust dashboard.'
          : 'This instance is protected by the admin password you chose during setup.'
      }
      foot={!email && <button onClick={onSignOut}>Sign out</button>}
    >
      <dl className="facts">
        <dt>Method</dt>
        <dd>{email ? 'Cloudflare Access' : 'Admin password'}</dd>
        {email && (
          <>
            <dt>Signed in as</dt>
            <dd>{email}</dd>
          </>
        )}
      </dl>
    </Panel>
  );
}

interface Section {
  id: string;
  label: string;
  title: string;
  description: string;
  render: (props: SectionProps) => ReactNode;
}
interface SectionProps {
  route: string;
  email?: string | undefined;
  onSignOut: () => void;
}

const sections: Section[] = [
  {
    id: 'general',
    label: 'General',
    title: 'General',
    description: 'Appearance, timezone, how many meetings run at once, and the first-run setup.',
    render: () => (
      <>
        <Appearance />
        <TimeZoneSettings />
        <LimitsSettings />
        <WizardReopen />
      </>
    ),
  },
  {
    id: 'bot',
    label: 'Bot identity',
    title: 'Bot identity',
    description: 'The name, chat message and camera image the bot joins with.',
    render: () => <BotSettings />,
  },
  {
    id: 'minutes',
    label: 'Minutes',
    title: 'Minutes',
    description:
      'How a meeting is written up when you share or export it. Every minutes document ends with a small "Powered by OpenMinutes" line.',
    render: () => <MinutesSettings />,
  },
  {
    id: 'email',
    label: 'Email',
    title: 'Email',
    description:
      'How minutes are emailed to attendees. Pick a provider, set the sender, and send yourself a test mail. Nothing is ever sent without a click.',
    render: () => <EmailSettings />,
  },
  {
    id: 'calendars',
    label: 'Calendar accounts',
    title: 'Calendar accounts',
    description:
      'Connect a calendar and OpenMinutes joins the Meet and Teams meetings in it. New calendars start on Never, so nothing is joined until you pick a rule.',
    render: ({ route }) => <CalendarSection route={route} />,
  },
  {
    id: 'google-meet',
    label: 'Google Meet sign-in',
    title: 'Google Meet sign-in',
    description: 'Let the bot join Google Meet with its own Google account instead of as a guest.',
    render: () => <GoogleSessionSettings />,
  },
  {
    id: 'phone',
    label: 'Phone recorder',
    title: 'Phone recorder',
    description: 'Record in-person conversations from your phone.',
    render: () => <PhoneSettings />,
  },
  {
    id: 'import',
    label: 'Import',
    title: 'Import',
    description: 'Bring your meeting history over from another notetaker.',
    render: () => <ImportSettings />,
  },
  {
    id: 'transcription',
    label: 'Transcription',
    title: 'Transcription',
    description:
      'Each meeting is transcribed after it ends. The local Whisper service needs no key.',
    render: () => <ProviderSection client={api.transcriptionSettings} />,
  },
  {
    id: 'summaries',
    label: 'Summaries',
    title: 'Summaries',
    description: 'A language model turns the transcript into notes. Skip it to keep summaries off.',
    render: () => (
      <>
        <ProviderSection client={api.summarySettings} />
        <SpeakerSettings />
        <SharedAccountsSettings />
        <SummaryChatSettings />
        <PromptsSection />
      </>
    ),
  },
  {
    id: 'storage',
    label: 'Storage and retention',
    title: 'Storage and retention',
    description: 'Recordings stay on the local volume by default. Transcripts are always kept.',
    render: () => <StorageSettings />,
  },
  {
    id: 'api',
    label: 'API',
    title: 'API',
    description:
      'Let other services use OpenMinutes over HTTP, with the same calls this app makes. Create a key for each service.',
    render: () => <ApiKeysSettings />,
  },
  {
    id: 'access',
    label: 'Access and updates',
    title: 'Access and updates',
    description: 'Who can sign in, and whether OpenMinutes tells you about new versions.',
    render: ({ email, onSignOut }) => (
      <>
        <Access email={email} onSignOut={onSignOut} />
        <UpdateSettings />
      </>
    ),
  },
];

function currentSection(route: string): Section {
  const [path = '', query = ''] = route.split('?');
  const id = /^\/settings\/([\w-]+)/.exec(path)?.[1];
  const params = new URLSearchParams(query);
  const fallback = params.has('connected') || params.has('error') ? 'calendars' : 'general';
  return sections.find((s) => s.id === (id ?? fallback)) ?? (sections[0] as Section);
}

export function Settings(props: SectionProps) {
  const section = currentSection(props.route);
  const subnav = useRef<HTMLElement>(null);
  useEffect(() => {
    // On a phone the section tabs scroll sideways: bring the current one into view.
    const nav = subnav.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && current) {
      const left =
        current.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
      nav.scrollLeft = left - (nav.clientWidth - current.offsetWidth) / 2;
    }
  }, [section.id]);
  return (
    <>
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <div className="settings">
        <nav className="subnav" aria-label="Settings sections" ref={subnav}>
          {sections.map(({ id, label }) => (
            <a
              key={id}
              href={`#/settings/${id}`}
              aria-current={section.id === id ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="settings-body">
          <SectionHead title={section.title} description={section.description} />
          {section.render(props)}
        </div>
      </div>
    </>
  );
}
