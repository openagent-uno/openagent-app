/**
 * Shared color palette and design tokens.
 *
 * On the web/Electron renderer, scalar color tokens are exposed as CSS
 * custom-property references (`var(--oa-<key>)`) so that a theme toggle
 * simply flips `document.documentElement.dataset.theme` and the entire
 * UI updates without reloading. The raw hex palettes (`lightColors`,
 * `darkColors`) remain available for any code that needs actual color
 * values (e.g. graph canvas, gradient stops, color math).
 *
 * On native, no CSS var plumbing exists — `colors` holds hex values that
 * are mutated in place on `setTheme`. Native theme-change still needs the
 * containing screen to re-render to pick up module-scoped StyleSheets.
 */

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'openagent:theme';
const STYLE_ELEMENT_ID = 'oa-theme-vars';
const FONTS_ELEMENT_ID = 'oa-fonts';
const GLOBAL_CSS_ELEMENT_ID = 'oa-global-css';

const isWeb = typeof document !== 'undefined';

/**
 * Palette kept in sync with the marketing docs theme at
 * `docs/.vitepress/theme/custom.css`. Brand: `--vp-c-brand-1` (#d94841) →
 * `--vp-c-brand-3` (#f3a33a). Neutrals are warm off-whites / warm blacks
 * for an editorial, craft-forward feel — not cold enterprise grays.
 */
export interface Palette {
  primary: string;
  primaryEnd: string;
  primaryLight: string;
  primaryMuted: string;
  primarySoft: string;
  bg: string;
  surface: string;
  surfaceElevated: string;
  sidebar: string;
  border: string;
  borderLight: string;
  borderStrong: string;
  inputBg: string;
  hover: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  success: string;
  error: string;
  warning: string;
  successSoft: string;
  errorSoft: string;
  errorBorder: string;
  mutedSoft: string;
  graphBg: string;
  graphEdge: string;
  graphLabel: string;
  graphRing: string;
  graphNodeMuted: string;
  graph: readonly string[];
  codeBg: string;
  codeText: string;
  codeKeyword: string;
  codeBorder: string;
  shadowColor: string;
  shadowColorStrong: string;
}

export const lightColors: Palette = {
  // Brand — signature accent reserved for primary actions and emphasis
  primary: '#D94841',
  primaryEnd: '#F3A33A',
  primaryLight: '#FDF1EF',
  primaryMuted: '#E67A41',
  primarySoft: 'rgba(217, 72, 65, 0.06)',

  // Warm neutrals — feels like paper, not plastic
  bg: '#FAFAF7',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  sidebar: '#F5F4F0',
  border: '#EBE8E1',
  borderLight: '#F2F0EA',
  borderStrong: '#D9D5CC',
  inputBg: '#FFFFFF',
  hover: 'rgba(26, 25, 21, 0.04)',

  // Text — warm near-black, not pure #000
  text: '#1A1915',
  textSecondary: '#55524B',
  textMuted: '#8F8B82',
  textInverse: '#FFFFFF',

  // Status
  success: '#15885E',
  error: '#C94A43',
  warning: '#CC8020',

  // Soft/muted variants used for tool-status badges + error outlines.
  successSoft: 'rgba(21, 136, 94, 0.10)',
  errorSoft: 'rgba(201, 74, 67, 0.10)',
  errorBorder: 'rgba(201, 74, 67, 0.32)',
  mutedSoft: 'rgba(143, 139, 130, 0.10)',

  // Graph canvas
  graphBg: '#FAFAF7',
  graphEdge: '#E0DDD5',
  graphLabel: '#3A3831',
  graphRing: '#F3A33A',
  graphNodeMuted: '#A8A49A',

  // Graph node palette — brand-warm spectrum only. Reds, oranges,
  // ambers, and warm neutrals so every node visibly belongs to the
  // OpenAgent brand family rather than a generic multi-hue chart.
  graph: [
    '#D94841', // brand red
    '#B83A34', // deep red
    '#E67A41', // amber-red (primaryMuted)
    '#F3A33A', // brand orange
    '#D86424', // burnt orange
    '#C06A2D', // rust
    '#8F5A3A', // warm brown
    '#A8A49A', // warm muted
    '#5C5A52', // deep neutral
    '#E85E54', // bright red
  ],

  // Code blocks — soft paper, not hard black
  codeBg: '#FAF8F3',
  codeText: '#1A1915',
  codeKeyword: '#C94A43',
  codeBorder: '#EBE8E1',

  // Shadows (as rgb to compose in styles)
  shadowColor: 'rgba(26, 25, 21, 0.06)',
  shadowColorStrong: 'rgba(26, 25, 21, 0.10)',
};

export const darkColors: Palette = {
  // Brand — brighter in dark for warmth against deep ink
  primary: '#E85E54',
  primaryEnd: '#F7B254',
  primaryLight: '#2A1E1A',
  primaryMuted: '#EC8A50',
  primarySoft: 'rgba(232, 94, 84, 0.10)',

  // Warm deep neutrals — ink on leather, not plastic gray
  bg: '#0E0D0B',
  surface: '#17151F',
  surfaceElevated: '#1D1B25',
  sidebar: '#141218',
  border: '#2A2732',
  borderLight: '#201E28',
  borderStrong: '#3A3644',
  inputBg: '#17151F',
  hover: 'rgba(255, 253, 248, 0.04)',

  // Text
  text: '#F5F2EA',
  textSecondary: '#B8B4A8',
  textMuted: '#807B70',
  textInverse: '#0E0D0B',

  // Status
  success: '#3ED28A',
  error: '#F07069',
  warning: '#F2B458',

  // Soft variants
  successSoft: 'rgba(62, 210, 138, 0.14)',
  errorSoft: 'rgba(240, 112, 105, 0.14)',
  errorBorder: 'rgba(240, 112, 105, 0.36)',
  mutedSoft: 'rgba(184, 180, 168, 0.10)',

  // Graph canvas
  graphBg: '#0E0D0B',
  graphEdge: '#2A2732',
  graphLabel: '#B8B4A8',
  graphRing: '#F7B254',
  graphNodeMuted: '#55524B',

  // Graph node palette — brand-warm spectrum in dark mode.
  graph: [
    '#E85E54', // brand red
    '#F07069', // bright red
    '#EC8A50', // amber-red
    '#F7B254', // brand orange
    '#F5A66C', // apricot
    '#D9824A', // rust
    '#B88A5A', // warm tan
    '#A8A49A', // warm muted
    '#7A736A', // deep warm neutral
    '#F08A82', // soft coral
  ],

  // Code blocks
  codeBg: '#141218',
  codeText: '#F5F2EA',
  codeKeyword: '#F7B254',
  codeBorder: '#2A2732',

  // Shadows
  shadowColor: 'rgba(0, 0, 0, 0.40)',
  shadowColorStrong: 'rgba(0, 0, 0, 0.60)',
};

/** Keys whose values are scalar color strings (not arrays). These are
 *  the ones we expose as `var(--oa-<key>)` references on web. */
const SCALAR_KEYS = (Object.keys(lightColors) as (keyof Palette)[])
  .filter((k) => !Array.isArray((lightColors as any)[k]));

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

/** Build the palette that consumers import as `colors`.
 *  - Web: scalar keys become CSS var references, arrays stay as arrays.
 *  - Native: scalar keys are the raw hex values for the current mode. */
function buildColors(mode: ThemeMode): Palette {
  const src = mode === 'dark' ? darkColors : lightColors;
  const out: any = {};
  for (const key of Object.keys(src)) {
    const v = (src as any)[key];
    if (isWeb && SCALAR_KEYS.includes(key as any)) {
      out[key] = `var(--oa-${key})`;
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Mutable, singleton palette. Mutate in place via `setTheme` so modules
 *  that captured references during `StyleSheet.create(...)` keep pointing
 *  at the same underlying object. On web the scalar values are all
 *  `var(--oa-*)` strings, which the browser resolves at paint time — so
 *  a theme toggle doesn't need JS to rewrite any bound styles. */
export const colors: Palette = buildColors(currentMode);

/** Inject Geist + JetBrains Mono fonts on web. Distinctive, modern,
 *  not in the Inter/Roboto/SF camp. */
function ensureFonts(): void {
  if (!isWeb) return;
  if (document.getElementById(FONTS_ELEMENT_ID)) return;
  const link = document.createElement('link');
  link.id = FONTS_ELEMENT_ID;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap';
  document.head.appendChild(link);
}

/** Global base styles — smooth scrollbar, keyframes, focus rings. */
function ensureGlobalCss(): void {
  if (!isWeb) return;
  let el = document.getElementById(GLOBAL_CSS_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = GLOBAL_CSS_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = `
    html, body, #root { background: var(--oa-bg); }
    body { font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
      letter-spacing: -0.005em; }
    * { box-sizing: border-box; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--oa-border); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
    ::-webkit-scrollbar-thumb:hover { background: var(--oa-borderStrong); background-clip: padding-box; border: 2px solid transparent; }
    @keyframes oa-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes oa-slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes oa-pulse-soft { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
    @keyframes oa-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes oa-spin { to { transform: rotate(360deg); } }
    .oa-fade-in { animation: oa-fade-in 0.24s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .oa-slide-up { animation: oa-slide-up 0.32s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .oa-pulse { animation: oa-pulse-soft 1.6s ease-in-out infinite; }
    .oa-hover-lift { transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s, border-color 0.18s; }
    .oa-hover-lift:hover { transform: translateY(-1px); }
    input:focus, textarea:focus, button:focus { outline: none; }
    input:focus-visible, textarea:focus-visible { box-shadow: 0 0 0 3px var(--oa-primarySoft); border-color: var(--oa-primary) !important; }
    button { font-family: inherit; }
    a { color: var(--oa-primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    ::selection { background: var(--oa-primaryLight); color: var(--oa-primary); }
  `;
}

/** Emit the `--oa-*` CSS variables for both themes and apply
 *  `data-theme` to <html>. Called once at startup on web. */
function ensureCssVariables(): void {
  if (!isWeb) return;
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  const toBlock = (selector: string, palette: Palette) => {
    const lines = SCALAR_KEYS
      .map((k) => `  --oa-${k}: ${(palette as any)[k]};`)
      .join('\n');
    return `${selector} {\n${lines}\n}`;
  };
  el.textContent = [
    toBlock(':root, :root[data-theme="light"]', lightColors),
    toBlock(':root[data-theme="dark"]', darkColors),
  ].join('\n\n');
  document.documentElement.setAttribute('data-theme', currentMode);
}

ensureFonts();
ensureCssVariables();
ensureGlobalCss();

export function getThemeMode(): ThemeMode {
  return currentMode;
}

/** Raw palette for the current theme — always actual hex values, never
 *  `var(--oa-*)` references. Use this in contexts that can't resolve CSS
 *  variables at paint time (Canvas 2D `fillStyle`/`strokeStyle`, gradient
 *  stop math, etc.). DOM styles should keep using `colors` so theme
 *  toggles re-paint without re-running JS. */
export function getRawColors(): Palette {
  return currentMode === 'dark' ? darkColors : lightColors;
}

/**
 * Switch theme. On web this just toggles the `data-theme` attribute
 * (browser re-resolves every `var(--oa-*)` instantly — no reload). We
 * also refresh the `colors.graph` array and any other non-scalar values
 * so code that reads them programmatically sees the right palette.
 * Persists the choice in localStorage.
 */
export function setTheme(mode: ThemeMode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  const src = mode === 'dark' ? darkColors : lightColors;
  for (const key of Object.keys(src)) {
    if (!SCALAR_KEYS.includes(key as any)) {
      (colors as any)[key] = (src as any)[key];
    } else if (!isWeb) {
      (colors as any)[key] = (src as any)[key];
    }
  }
  if (isWeb) {
    document.documentElement.setAttribute('data-theme', mode);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    /* ignore */
  }
}

/** CSS gradient string for web backgrounds — uses raw brand hex so it
 *  renders correctly regardless of theme (brand gradient stays brand). */
export const primaryGradient = 'linear-gradient(135deg, #d94841 0%, #f3a33a 100%)';
export const primaryGradientStops = [lightColors.primary, lightColors.primaryEnd] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  pill: 999,
  full: 9999,
} as const;

export const font = {
  mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  display: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: '"Instrument Serif", Georgia, serif',
} as const;

/** Letter-spacing tokens — tighter for display, looser for micro labels. */
export const tracking = {
  tight: -0.02,
  normal: -0.005,
  wide: 0.04,
  wider: 0.08,
} as const;

/** Shadow presets (web-only — native uses elevation). */
export const shadows = {
  sm: {
    shadowColor: 'rgba(26, 25, 21, 0.05)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: 'rgba(26, 25, 21, 0.08)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 2,
  },
  lg: {
    shadowColor: 'rgba(26, 25, 21, 0.12)',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 4,
  },
} as const;
