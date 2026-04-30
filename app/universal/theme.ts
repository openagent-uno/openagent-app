/**
 * Shared color palette and design tokens — JARVIS HUD theme.
 *
 * Single dark sci-fi palette: near-black canvas, cyan accents, dotted
 * grid background, translucent glass panels. There is no light mode —
 * the previous editorial / warm-paper theme has been removed along
 * with the toggle UI; this is a one-theme app.
 *
 * On the web/Electron renderer, scalar color tokens are exposed as CSS
 * custom-property references (`var(--oa-<key>)`) so component styles
 * stay value-stable while still letting us tweak the palette in one
 * place. On native, `colors` holds raw hex values.
 */

const STYLE_ELEMENT_ID = 'oa-theme-vars';
const FONTS_ELEMENT_ID = 'oa-fonts';
const GLOBAL_CSS_ELEMENT_ID = 'oa-global-css';

const isWeb = typeof document !== 'undefined';

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
  // JARVIS-specific HUD tokens.
  accent: string;
  accentSoft: string;
  accentGlow: string;
  accentDim: string;
  gridLine: string;
  gridDot: string;
  tickDim: string;
  tickActive: string;
  panelBg: string;
  panelBgSolid: string;
  panelRail: string;
  scanLine: string;
  orbCore: string;
  orbRing: string;
  orbHalo: string;
}

/** Single JARVIS dark palette. */
export const jarvisColors: Palette = {
  primary: '#3FC8FF',
  primaryEnd: '#7FE0FF',
  primaryLight: 'rgba(63, 200, 255, 0.14)',
  primaryMuted: '#5FD2FF',
  primarySoft: 'rgba(63, 200, 255, 0.20)',

  bg: '#050810',
  surface: 'rgba(10, 16, 30, 0.72)',
  surfaceElevated: 'rgba(14, 22, 40, 0.82)',
  sidebar: 'rgba(4, 6, 14, 0.94)',
  border: 'rgba(63, 200, 255, 0.20)',
  borderLight: 'rgba(63, 200, 255, 0.10)',
  borderStrong: 'rgba(63, 200, 255, 0.40)',
  inputBg: 'rgba(8, 14, 26, 0.70)',
  hover: 'rgba(63, 200, 255, 0.10)',

  text: '#EEF4FB',
  textSecondary: '#9BACC2',
  textMuted: '#5A6878',
  textInverse: '#050810',

  success: '#3FE0A0',
  error: '#FF6B7A',
  warning: '#F7B254',

  successSoft: 'rgba(63, 224, 160, 0.16)',
  errorSoft: 'rgba(255, 107, 122, 0.16)',
  errorBorder: 'rgba(255, 107, 122, 0.44)',
  mutedSoft: 'rgba(155, 172, 194, 0.12)',

  graphBg: '#050810',
  graphEdge: 'rgba(63, 200, 255, 0.36)',
  graphLabel: '#9BACC2',
  graphRing: '#3FC8FF',
  graphNodeMuted: '#2C3645',

  // Cool spectrum — cyans, teals, violets, ice — no warm hues.
  graph: [
    '#3FC8FF',
    '#7FE0FF',
    '#4FB8E6',
    '#7B6FFF',
    '#5FD2FF',
    '#3FE0A0',
    '#A78BFF',
    '#5A78A0',
    '#2C3645',
    '#FF6B7A',
  ],

  codeBg: 'rgba(8, 14, 26, 0.75)',
  codeText: '#E0EAF5',
  codeKeyword: '#3FC8FF',
  codeBorder: 'rgba(63, 200, 255, 0.20)',

  shadowColor: 'rgba(0, 0, 0, 0.55)',
  shadowColorStrong: 'rgba(0, 0, 0, 0.78)',

  accent: '#3FC8FF',
  accentSoft: 'rgba(63, 200, 255, 0.22)',
  accentGlow: 'rgba(63, 200, 255, 0.50)',
  accentDim: 'rgba(63, 200, 255, 0.32)',
  gridLine: 'rgba(102, 180, 255, 0.07)',
  gridDot: 'rgba(102, 180, 255, 0.16)',
  tickDim: 'rgba(180, 210, 240, 0.36)',
  tickActive: '#3FC8FF',
  panelBg: 'rgba(8, 14, 26, 0.60)',
  panelBgSolid: '#0A1322',
  panelRail: '#3FC8FF',
  scanLine: 'rgba(63, 200, 255, 0.60)',
  orbCore: '#050810',
  orbRing: '#3FC8FF',
  orbHalo: 'rgba(63, 200, 255, 0.60)',
};

const SCALAR_KEYS = (Object.keys(jarvisColors) as (keyof Palette)[])
  .filter((k) => !Array.isArray((jarvisColors as any)[k]));

function buildColors(): Palette {
  const out: any = {};
  for (const key of Object.keys(jarvisColors)) {
    const v = (jarvisColors as any)[key];
    if (isWeb && SCALAR_KEYS.includes(key as any)) {
      out[key] = `var(--oa-${key})`;
    } else {
      out[key] = v;
    }
  }
  return out;
}

export const colors: Palette = buildColors();

/** Inject Geist + Geist Mono + Orbitron + Rajdhani fonts on web.
 *  Orbitron is the JARVIS wordmark / clock face; Rajdhani is the
 *  condensed display font for tracked-out small caps and labels. */
function ensureFonts(): void {
  if (!isWeb) return;
  if (document.getElementById(FONTS_ELEMENT_ID)) return;
  const link = document.createElement('link');
  link.id = FONTS_ELEMENT_ID;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Orbitron:wght@400;500;600;700;800&family=Rajdhani:wght@300;400;500;600;700&display=swap';
  document.head.appendChild(link);
}

/** Global base styles — JARVIS canvas, scrollbar, keyframes, focus rings. */
function ensureGlobalCss(): void {
  if (!isWeb) return;
  let el = document.getElementById(GLOBAL_CSS_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = GLOBAL_CSS_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = `
    html, body, #root { background: var(--oa-bg) !important; color: var(--oa-text); margin: 0; min-height: 100vh; }
    body { font-family: 'Rajdhani', 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
      letter-spacing: 0.005em; }
    * { box-sizing: border-box; }
    /* Some default react-native-web bottom-tabbar wrappers paint a white
       safe-area strip; force any direct child of the bottom nav to keep
       its background transparent so the JARVIS canvas shows through. */
    [data-testid="tab-bar"], [role="tablist"] { background-color: transparent !important; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--oa-border); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
    ::-webkit-scrollbar-thumb:hover { background: var(--oa-borderStrong); background-clip: padding-box; border: 2px solid transparent; }
    @keyframes oa-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes oa-slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes oa-pulse-soft { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
    @keyframes oa-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes oa-spin { to { transform: rotate(360deg); } }
    @keyframes oa-jarvis-arc-spin { to { transform: rotate(360deg); } }
    @keyframes oa-jarvis-arc-spin-rev { to { transform: rotate(-360deg); } }
    @keyframes oa-jarvis-halo-breath {
      0%, 100% { opacity: 0.85; transform: scale(1.0); }
      50% { opacity: 1.0; transform: scale(1.03); }
    }
    @keyframes oa-jarvis-tick-twinkle {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1.0; }
    }
    @keyframes oa-jarvis-scan {
      0% { transform: translateX(-100%); opacity: 0; }
      10%, 90% { opacity: 1; }
      100% { transform: translateX(100%); opacity: 0; }
    }
    @keyframes oa-jarvis-rail-pulse {
      0%, 100% { opacity: 0.7; }
      50% { opacity: 1.0; }
    }
    .oa-fade-in { animation: oa-fade-in 0.24s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .oa-slide-up { animation: oa-slide-up 0.32s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .oa-pulse { animation: oa-pulse-soft 1.6s ease-in-out infinite; }
    .oa-hover-lift { transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s, border-color 0.18s; }
    .oa-hover-lift:hover { transform: translateY(-1px); }
    input:focus, textarea:focus, button:focus { outline: none; }
    input:focus-visible, textarea:focus-visible { box-shadow: 0 0 0 2px var(--oa-primarySoft), 0 0 16px var(--oa-accentGlow); border-color: var(--oa-primary) !important; }
    button { font-family: inherit; }
    a { color: var(--oa-primary); text-decoration: none; }
    a:hover { text-decoration: underline; text-shadow: 0 0 6px var(--oa-accentGlow); }
    ::selection { background: var(--oa-primarySoft); color: var(--oa-text); }
  `;
}

function ensureCssVariables(): void {
  if (!isWeb) return;
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  const lines = SCALAR_KEYS
    .map((k) => `  --oa-${k}: ${(jarvisColors as any)[k]};`)
    .join('\n');
  el.textContent = `:root {\n${lines}\n}`;
  document.documentElement.setAttribute('data-theme', 'dark');
}

ensureFonts();
ensureCssVariables();
ensureGlobalCss();

/** Raw palette — actual hex values, never `var(--oa-*)` refs. Use this
 *  in contexts that can't resolve CSS variables at paint time (Canvas
 *  2D `fillStyle`/`strokeStyle`, gradient stop math, etc.). DOM styles
 *  should keep using `colors` so they remain CSS-var-driven. */
export function getRawColors(): Palette {
  return jarvisColors;
}

/** Cyan accent gradient — used sparingly (focus rings, primary buttons). */
export const primaryGradient = 'linear-gradient(135deg, #3FC8FF 0%, #7FE0FF 100%)';
export const primaryGradientStops = [jarvisColors.primary, jarvisColors.primaryEnd] as const;

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
  sans: '"Rajdhani", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  display: '"Orbitron", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: '"Orbitron", Georgia, serif',
} as const;

export const tracking = {
  tight: -0.01,
  normal: 0.005,
  wide: 0.08,
  wider: 0.16,
} as const;

export const shadows = {
  sm: {
    shadowColor: 'rgba(0, 0, 0, 0.45)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: 'rgba(0, 0, 0, 0.55)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 2,
  },
  lg: {
    shadowColor: 'rgba(0, 0, 0, 0.70)',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 28,
    elevation: 4,
  },
  glow: {
    shadowColor: '#3FC8FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 0,
  },
} as const;
