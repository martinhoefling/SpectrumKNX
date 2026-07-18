import { useEffect, useLayoutEffect, useState } from 'react';
import { getPref, setPref } from '../utils/prefs';

export type Theme = 'system' | 'dark' | 'light';

const VALID_THEMES: Theme[] = ['system', 'dark', 'light'];

function applyTheme(theme: Theme) {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = getPref('theme') as Theme | null;
    return saved && VALID_THEMES.includes(saved) ? saved : 'system';
  });

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    setPref('theme', t);
  };

  return [theme, setTheme];
}

/**
 * Returns an incrementing counter that bumps whenever the active theme changes
 * (either via explicit data-theme attribute or via prefers-color-scheme media query).
 * Use as a useMemo dependency in chart components that have JS-side color values.
 */
export function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      mq.removeEventListener('change', bump);
    };
  }, []);
  return tick;
}
