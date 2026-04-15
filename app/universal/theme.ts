/**
 * Shared color palette and design tokens.
 * Primary gradient: #d94841 (accent red) → #f3a33a (amber).
 *
 * Dark mode: the exported `colors` object is MUTATED in place when the
 * user toggles the theme, so modules that captured `colors` values inside
 * `StyleSheet.create(...)` at import time keep pointing at the same
 * underlying object. Because StyleSheet resolves concrete values at
 * module-init time, a window reload is used to re-evaluate styles when
 * the theme flips (see `stores/theme.ts`).
 */

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'openagent:theme';

export const lightColors = {
  // Brand — accent reserved for primary actions
  primary: '#D94841',
  primaryEnd: '#F3A33A',
  primaryLight: '#F8EFEA',
  primaryMuted: '#E47C63',

  // Neutrals
  bg: '#F5F6F8',
  surface: '#FFFFFF',
  sidebar: '#F1F3F5',
  border: '#E2E8F0',
  borderLight: '#EDF2F7',
  inputBg: '#FFFFFF',

  // Text
  text: '#111827',
  textSecondary: '#475467',
  textMuted: '#667085',
  textInverse: '#FFFFFF',

  // Status
  success: '#1F9D6A',
  error: '#C94A43',
  warning: '#D88B1F',

  // Graph canvas
  graphBg: '#F8FAFC',
  graphEdge: '#CBD5E1',
  graphLabel: '#334155',
  graphRing: '#F3A33A',
  graphNodeMuted: '#94A3B8',

  // Graph node palette
  graph: [
    '#D94841',
    '#F3A33A',
    '#2563EB',
    '#0F766E',
    '#7C3AED',
    '#475569',
    '#DC2626',
    '#EA580C',
    '#0284C7',
    '#4F46E5',
  ],

  // Code blocks
  codeBg: '#0F172A',
  codeText: '#E2E8F0',
  codeKeyword: '#F3A33A',
} as const;

export const darkColors: typeof lightColors = {
  // Brand
  primary: '#E85C55',
  primaryEnd: '#F3A33A',
  primaryLight: '#2A1F1C',
  primaryMuted: '#B66251',

  // Neutrals
  bg: '#0F1115',
  surface: '#1A1D23',
  sidebar: '#141619',
  border: '#2A2F37',
  borderLight: '#232830',
  inputBg: '#1A1D23',

  // Text
  text: '#F2F4F7',
  textSecondary: '#B9C0CC',
  textMuted: '#8A94A6',
  textInverse: '#FFFFFF',

  // Status
  success: '#34C77B',
  error: '#E56A62',
  warning: '#EEB154',

  // Graph canvas
  graphBg: '#0F1115',
  graphEdge: '#334055',
  graphLabel: '#D6DCE6',
  graphRing: '#F3A33A',
  graphNodeMuted: '#566070',

  // Graph node palette
  graph: [
    '#E85C55',
    '#F3A33A',
    '#60A5FA',
    '#2DD4BF',
    '#A78BFA',
    '#94A3B8',
    '#F87171',
    '#FB923C',
    '#38BDF8',
    '#818CF8',
  ],

  // Code blocks
  codeBg: '#0A0D12',
  codeText: '#E2E8F0',
  codeKeyword: '#F3A33A',
};

/**
 * Read the persisted theme mode synchronously at module init. Using
 * localStorage keeps this usable both in the browser and inside the
 * Electron renderer (Chromium). Native platforms without localStorage
 * always default to `'light'`.
 */
function readInitialMode(): ThemeMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(THEME_STORAGE_KEY);
      if (v === 'dark') return 'dark';
    }
  } catch {
    /* ignore */
  }
  return 'light';
}

let currentMode: ThemeMode = readInitialMode();

/** Mutable, singleton color palette. Mutate in place via `setTheme`. */
export const colors: { -readonly [K in keyof typeof lightColors]: (typeof lightColors)[K] } = {
  ...(currentMode === 'dark' ? darkColors : lightColors),
};

export function getThemeMode(): ThemeMode {
  return currentMode;
}

/**
 * Replace all keys of `colors` with the chosen palette. Persists the
 * choice in localStorage so subsequent module evaluations pick it up.
 */
export function setTheme(mode: ThemeMode): void {
  currentMode = mode;
  const src = mode === 'dark' ? darkColors : lightColors;
  Object.assign(colors, src);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    /* ignore */
  }
}

/** CSS gradient string for web backgrounds */
export const primaryGradient = 'linear-gradient(135deg, #d94841 0%, #f3a33a 100%)';
export const primaryGradientStops = [lightColors.primary, lightColors.primaryEnd] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  full: 9999,
} as const;

export const font = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
} as const;
