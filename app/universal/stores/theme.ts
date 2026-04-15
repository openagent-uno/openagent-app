/**
 * Theme state: light vs dark mode, persisted in localStorage.
 *
 * The actual color palette lives in `../theme.ts` as a mutable singleton.
 * This store drives the toggle UI and reloads the window on change so
 * that `StyleSheet.create(...)` blocks evaluated at module load pick up
 * the new palette.
 */

import { create } from 'zustand';
import { Platform } from 'react-native';
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
    // Reload so all module-scoped StyleSheet definitions re-evaluate
    // with the new palette. On native we just update state — native
    // layouts can re-read colors on re-render of screens that recreate
    // styles inside their component body.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    }
  },
  toggle: () => {
    const next: ThemeMode = get().mode === 'light' ? 'dark' : 'light';
    get().setMode(next);
  },
}));
