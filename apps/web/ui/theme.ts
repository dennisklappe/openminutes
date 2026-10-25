import { useCallback, useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'openminutes.theme';

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = theme;
}

function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be blocked, the choice then only lasts until reload.
  }
  apply(theme);
  window.dispatchEvent(new Event('openminutes-theme'));
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setCurrent] = useState<Theme>(stored);
  useEffect(() => {
    const update = () => {
      setCurrent(stored());
    };
    window.addEventListener('openminutes-theme', update);
    return () => {
      window.removeEventListener('openminutes-theme', update);
    };
  }, []);
  const change = useCallback((next: Theme) => {
    setTheme(next);
  }, []);
  return [theme, change];
}
