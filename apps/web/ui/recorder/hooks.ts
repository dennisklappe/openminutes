import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PhoneConfigDto } from '../../src/dto.js';
import { fetchPhoneConfig } from './client.js';
import { recorderSession, type SessionSnapshot } from './session.js';

export const useRecorderSession = (): SessionSnapshot =>
  useSyncExternalStore(recorderSession.subscribe, recorderSession.getSnapshot);

const CACHE_KEY = 'openminutes.phone';

function cachedConfig(): PhoneConfigDto | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PhoneConfigDto) : undefined;
  } catch {
    return undefined;
  }
}

async function loadConfig(): Promise<PhoneConfigDto | undefined> {
  try {
    const config = await fetchPhoneConfig();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(config));
    } catch {
      // storage unavailable: the config is only a convenience for offline use
    }
    return config;
  } catch {
    return cachedConfig();
  }
}

let phoneConfig: Promise<PhoneConfigDto | undefined> | undefined;

export function usePhoneConfig(): PhoneConfigDto | undefined {
  const [config, setConfig] = useState<PhoneConfigDto>();
  useEffect(() => {
    phoneConfig ??= loadConfig().then((config) => {
      if (!config) phoneConfig = undefined;
      return config;
    });
    let current = true;
    void phoneConfig.then((value) => {
      if (current) setConfig(value);
    });
    return () => {
      current = false;
    };
  }, []);
  return config;
}

export function useTicker(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [active, intervalMs]);
  return now;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function useFinishRedirect(): void {
  const { phase, meetingId } = useRecorderSession();
  useEffect(() => {
    if (phase !== 'done' || !meetingId) return;
    window.location.hash = `#/meetings/${meetingId}`;
    recorderSession.reset();
  }, [phase, meetingId]);
}
