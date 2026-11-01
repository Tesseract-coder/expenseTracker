import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

interface Preferences {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  privacy: boolean;
  setPrivacy: (p: boolean) => void;
}

const PreferencesContext = createContext<Preferences | null>(null);
const THEME_KEY = 'kharcha.theme';
const PRIVACY_KEY = 'kharcha.privacy';

function readTheme(): ThemePref {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  const [privacy, setPrivacy] = useState(() => localStorage.getItem(PRIVACY_KEY) === '1');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    localStorage.setItem(THEME_KEY, theme);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('privacy-blur', privacy);
    localStorage.setItem(PRIVACY_KEY, privacy ? '1' : '0');
  }, [privacy]);

  const value = useMemo(() => ({ theme, setTheme, privacy, setPrivacy }), [theme, privacy]);
  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}

export function usePreferences(): Preferences {
  const ctx = use(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}
