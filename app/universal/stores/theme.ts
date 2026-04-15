/**
 * Theme state: light vs dark mode, persisted in localStorage.
 *
 * The actual color palette lives in `../theme.ts`. On web, scalar tokens
 * are CSS custom-property references (`var(--oa-<key>)`) so flipping
 * `data-theme` on <html> is enough for the entire UI to re-paint — no
 * reload required.
 */

import { create } from 'zustand';
import { setTheme, getThemeMode, type ThemeMode } from '../theme';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: getThemeMode(),
  setMode: (mode) => {
    if (mode === get().mode) return;
    setTheme(mode);
    set({ mode });
  },
  toggle: () => {
    const next: ThemeMode = get().mode === 'light' ? 'dark' : 'light';
    get().setMode(next);
  },
}));
