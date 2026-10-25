import { useCallback, useEffect, useState } from 'react';
import type { SessionDto, WizardDto } from '../src/dto.js';
import { api } from './api.js';
import { AuthForm } from './pages/AuthForm.js';
import { MeetingDetail } from './pages/MeetingDetail.js';
import { Meetings } from './pages/Meetings.js';
import { Archive } from './pages/Archive.js';
import { Bin } from './pages/Bin.js';
import { Minutes } from './pages/Minutes.js';
import { minutesView } from './minutes/views.js';
import { OfflineRecorder, Record } from './pages/Record.js';
import { Settings } from './pages/Settings.js';
import { Shell } from './Shell.js';
import { useRoute } from './useRoute.js';
import { PasswordStep } from './wizard/PasswordStep.js';
import { Wizard } from './wizard/Wizard.js';

export function App() {
  const [session, setSession] = useState<SessionDto>();
  const [wizard, setWizard] = useState<WizardDto>();
  const [unreachable, setUnreachable] = useState(false);
  const route = useRoute();

  const refresh = useCallback(() => {
    api.session().then(
      (next) => {
        setSession(next);
        setUnreachable(false);
      },
      () => {
        setUnreachable(true);
      },
    );
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);
  const authenticated = session?.authenticated;
  useEffect(() => {
    if (authenticated) void api.wizard().then(setWizard);
  }, [authenticated]);

  if (!session) return unreachable ? <OfflineRecorder /> : null;
  if (!session.authenticated) {
    return session.setupRequired ? (
      <PasswordStep onDone={refresh} />
    ) : (
      <AuthForm onDone={refresh} />
    );
  }
  if (!wizard) return null;
  if (!wizard.completed) {
    return (
      <Wizard
        initialStep={wizard.step}
        route={route}
        onFinished={(meetingId) => {
          if (meetingId) window.location.hash = `#/meetings/${meetingId}`;
          setWizard({ ...wizard, completed: true });
        }}
      />
    );
  }

  const meetingId = /^\/meetings\/([\w-]+)$/.exec(route)?.[1];
  const page = meetingId ? (
    <MeetingDetail id={meetingId} />
  ) : route.startsWith('/minutes') ? (
    <Minutes view={minutesView(route)} />
  ) : route === '/archive' ? (
    <Archive />
  ) : route === '/bin' ? (
    <Bin />
  ) : route === '/record' ? (
    <Record />
  ) : route.startsWith('/settings') ? (
    <Settings
      route={route}
      email={session.email}
      onSignOut={() => {
        void api.logout().then(refresh);
      }}
    />
  ) : (
    <Meetings />
  );
  return (
    <Shell
      route={route}
      email={session.email}
      onSignOut={() => {
        void api.logout().then(refresh);
      }}
    >
      {page}
    </Shell>
  );
}
