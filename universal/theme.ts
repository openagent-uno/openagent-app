/**
 * Shared color palette and design tokens — JARVIS HUD theme.
 *
 * Two palettes share one token set: the default dark sci-fi look
 * (near-black canvas, cyan accents, dotted grid, glass panels) and a
 * light counterpart (cool-white canvas, the same cyan accent identity,
 * ink text). The active palette is chosen by `getThemeMode()` and
 * switched live with `setTheme()` — see Settings → Appearance.
 *
 * On the web/Electron renderer, scalar color tokens are exposed as CSS
 * custom-property references (`var(--oa-<key>)`) so component styles
 * stay value-stable across a theme switch — flipping the mode only
 * re-writes the `:root` custom properties, and every style repaints in
 * place. On native, `colors` holds raw hex values for the active mode.
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
  /** Frosted-glass tint behind a `backdrop-filter` blur — shared by the
   *  nav header and every floating panel. Theme-aware so glass reads
   *  dark on the JARVIS canvas and light on the light canvas. */
  glassBg: string;
}

/** JARVIS dark palette — the default mode. */
export const darkColors: Palette = {
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
  gridLine: 'rgba(102, 180, 255, 0.04)',
  gridDot: 'rgba(102, 180, 255, 0.10)',
  tickDim: 'rgba(180, 210, 240, 0.36)',
  tickActive: '#3FC8FF',
  panelBg: 'rgba(8, 14, 26, 0.60)',
  panelBgSolid: '#0A1322',
  panelRail: '#3FC8FF',
  scanLine: 'rgba(63, 200, 255, 0.60)',
  orbCore: '#050810',
  orbRing: '#3FC8FF',
  orbHalo: 'rgba(63, 200, 255, 0.60)',
  glassBg: 'rgba(8, 12, 22, 0.42)',
};

/** Back-compat alias — the dark palette is the historical JARVIS look.
 *  Kept so existing imports of `jarvisColors` keep resolving. */
export const jarvisColors: Palette = darkColors;

/** Light palette — a cool-white counterpart that keeps the cyan accent
 *  identity. Same token keys as `darkColors`, deeper cyan for contrast
 *  on a light canvas and ink-blue text. */
export const lightColors: Palette = {
  primary: '#0892CE',
  primaryEnd: '#39B7EA',
  primaryLight: 'rgba(8, 146, 206, 0.10)',
  primaryMuted: '#2AA3DC',
  primarySoft: 'rgba(8, 146, 206, 0.16)',

  bg: '#F3F6FB',
  surface: 'rgba(255, 255, 255, 0.80)',
  surfaceElevated: '#FFFFFF',
  sidebar: 'rgba(247, 250, 253, 0.92)',
  border: 'rgba(18, 50, 80, 0.12)',
  borderLight: 'rgba(18, 50, 80, 0.07)',
  borderStrong: 'rgba(8, 146, 206, 0.42)',
  inputBg: 'rgba(255, 255, 255, 0.90)',
  hover: 'rgba(8, 146, 206, 0.08)',

  text: '#0E1B28',
  textSecondary: '#44566B',
  textMuted: '#8090A2',
  textInverse: '#FFFFFF',

  success: '#0F9A6A',
  error: '#E0455A',
  warning: '#D98A1F',

  successSoft: 'rgba(15, 154, 106, 0.14)',
  errorSoft: 'rgba(224, 69, 90, 0.12)',
  errorBorder: 'rgba(224, 69, 90, 0.40)',
  mutedSoft: 'rgba(68, 86, 107, 0.10)',

  graphBg: '#F3F6FB',
  graphEdge: 'rgba(8, 146, 206, 0.34)',
  graphLabel: '#44566B',
  graphRing: '#0892CE',
  graphNodeMuted: '#C3CEDB',

  // Same cool spectrum, tuned a shade deeper so nodes/labels read on
  // a light canvas.
  graph: [
    '#0892CE',
    '#39B7EA',
    '#1C7FB8',
    '#6A5BE0',
    '#1FA2D6',
    '#0F9A6A',
    '#7C5CE6',
    '#5878A6',
    '#AEBCCC',
    '#E0455A',
  ],

  codeBg: 'rgba(240, 244, 249, 0.92)',
  codeText: '#1A2A3A',
  codeKeyword: '#0892CE',
  codeBorder: 'rgba(18, 50, 80, 0.12)',

  shadowColor: 'rgba(18, 38, 63, 0.12)',
  shadowColorStrong: 'rgba(18, 38, 63, 0.22)',

  accent: '#0892CE',
  accentSoft: 'rgba(8, 146, 206, 0.18)',
  accentGlow: 'rgba(8, 146, 206, 0.34)',
  accentDim: 'rgba(8, 146, 206, 0.24)',
  gridLine: 'rgba(18, 90, 150, 0.05)',
  gridDot: 'rgba(18, 90, 150, 0.10)',
  tickDim: 'rgba(40, 90, 130, 0.34)',
  tickActive: '#0892CE',
  panelBg: 'rgba(255, 255, 255, 0.70)',
  panelBgSolid: '#FFFFFF',
  panelRail: '#0892CE',
  scanLine: 'rgba(8, 146, 206, 0.45)',
  orbCore: '#FFFFFF',
  orbRing: '#0892CE',
  orbHalo: 'rgba(8, 146, 206, 0.40)',
  glassBg: 'rgba(255, 255, 255, 0.55)',
};

export type ThemeMode = 'light' | 'dark';

/** All palettes keyed by mode. */
export const palettes: Record<ThemeMode, Palette> = {
  dark: darkColors,
  light: lightColors,
};

const THEME_STORAGE_KEY = 'oa-theme-mode-v1';

function loadInitialMode(): ThemeMode {
  if (isWeb && typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // private mode / blocked storage — fall through to default
    }
  }
  return 'dark';
}

let activeMode: ThemeMode = loadInitialMode();

function activePalette(): Palette {
  return palettes[activeMode];
}

/** Current theme mode. */
export function getThemeMode(): ThemeMode {
  return activeMode;
}

const themeListeners = new Set<(mode: ThemeMode) => void>();

/** Subscribe to theme changes. Returns an unsubscribe fn. */
export function subscribeTheme(fn: (mode: ThemeMode) => void): () => void {
  themeListeners.add(fn);
  return () => {
    themeListeners.delete(fn);
  };
}

// Token keys derived from the dark palette (both palettes share keys).
const SCALAR_KEYS = (Object.keys(darkColors) as (keyof Palette)[])
  .filter((k) => !Array.isArray((darkColors as any)[k]));

function buildColors(): Palette {
  const src = activePalette();
  const out: any = {};
  for (const key of Object.keys(src)) {
    const v = (src as any)[key];
    if (isWeb && SCALAR_KEYS.includes(key as any)) {
      // On web every scalar resolves through a CSS custom property, so
      // `colors` is mode-agnostic — switching themes only rewrites the
      // `:root` vars (see `ensureCssVariables`). Array tokens (graph)
      // keep raw values since they're consumed by canvas/SVG.
      out[key] = `var(--oa-${key})`;
    } else {
      out[key] = v;
    }
  }
  return out;
}

export const colors: Palette = buildColors();

/**
 * Frosted-glass surface — the single recipe shared by the nav header and
 * every floating panel (dialogs, sheets, command palette) so blur, tint
 * and saturation read identically across all of them. Apply
 * `glassSurface.backgroundColor` always and `glassSurface.webFilter`
 * (backdrop-filter) only on web.
 *
 * The tint resolves through `colors.glassBg` — `var(--oa-glassBg)` on
 * web — so glass panels follow the active theme (dark tint on the
 * JARVIS canvas, light tint on the light canvas) and repaint on switch.
 */
export const glassSurface = {
  backgroundColor: colors.glassBg,
  webFilter: 'blur(2.6px) saturate(140%)',
} as const;

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
    /* Message / tool-card entrance — a touch more travel than oa-fade-in
       so transcript rows visibly slide-and-fade up as they stream in. */
    @keyframes oa-msg-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes oa-slide-in-x { from { transform: translateX(-100%); } to { transform: translateX(0); } }
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
    .oa-msg-in { animation: oa-msg-in 0.42s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .oa-slide-in-x { animation: oa-slide-in-x 0.26s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .oa-pulse { animation: oa-pulse-soft 1.6s ease-in-out infinite; }
    /* Hover-lift: a 1px float on hover + a subtle press-in on active, so
       buttons feel tactile. Used app-wide via Button / PrimaryButton. */
    .oa-hover-lift { transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s, border-color 0.18s, background-color 0.18s; }
    .oa-hover-lift:hover { transform: translateY(-1px); }
    .oa-hover-lift:active { transform: translateY(0) scale(0.97); transition-duration: 0.08s; }
    /* Icon buttons (paperclip / mic / message actions): a soft cyan wash
       on hover and a quick squish on press. */
    .oa-icon-btn { transition: background-color 0.16s ease, color 0.16s ease, transform 0.12s ease; }
    .oa-icon-btn:hover { background-color: var(--oa-hover); }
    .oa-icon-btn:active { transform: scale(0.92); }
    /* Press-only feedback for tappables that shouldn't lift (e.g. Send). */
    .oa-press { transition: transform 0.12s ease, opacity 0.16s ease, background-color 0.16s ease; }
    .oa-press:active { transform: scale(0.92); }
    /* The chat composer reacts to focus from any child input via
       :focus-within — border brightens and the bar lifts a hair. Crisp,
       no blur glow. */
    .oa-composer { transition: border-color 0.22s ease, transform 0.22s ease; }
    .oa-composer:focus-within { border-color: var(--oa-primary); transform: translateY(-1px); }
    /* Expandable cards (tool calls, delegations): a gentle border/bg lift
       on hover so they read as interactive. */
    .oa-card-hover { transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.18s ease; }
    .oa-card-hover:hover { border-color: var(--oa-borderStrong); background-color: var(--oa-hover); }
    /* Sidebar / list rows: a soft cyan wash on hover, with a quick
       color transition so nav and recent rows feel responsive. */
    .oa-side-row { transition: background-color 0.16s ease, color 0.16s ease; border-radius: 8px; }
    .oa-side-row:hover { background-color: var(--oa-hover); }
    /* Show on hover: any child with inline opacity:0 inside an
       .oa-row-hover container becomes visible when the row is hovered.
       Used by message actions (Copy / Edit / Regenerate / etc). */
    .oa-row-hover:hover > div > div > div[style*="opacity: 0"],
    .oa-row-hover:hover div[style*="opacity: 0"] { opacity: 1 !important; }
    /* Spin keyframe wrapper for loader icons. */
    .oa-spin { animation: oa-spin 0.9s linear infinite; display: inline-block; }
    /* Skeleton placeholder — a shimmering bar shown while a list / screen
       loads, so the page renders immediately instead of flashing an
       empty-state message. See [[components/Skeleton.tsx]]. */
    .oa-skeleton {
      background-image: linear-gradient(90deg,
        var(--oa-surface) 25%, var(--oa-hover) 50%, var(--oa-surface) 75%);
      background-size: 200% 100%;
      animation: oa-shimmer 1.5s ease-in-out infinite;
    }
    /* (The reasoning indicator animates via the RN Animated API on every
       platform — see components/ReasoningIndicator.tsx. No CSS keyframes:
       this RNW build doesn't forward className to the DOM.) */
    /* Shiki-rendered code blocks — strip its default background and
       apply our font stack so highlighted code matches the surface. */
    .oa-shiki pre {
      margin: 0 !important;
      padding: 12px !important;
      background: transparent !important;
      font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace !important;
      font-size: 12.5px !important;
      line-height: 19px !important;
      overflow-x: auto;
    }
    .oa-shiki code { font-family: inherit !important; font-size: inherit !important; }
    /* KaTeX integration — restyle for our color palette. */
    .oa-katex-block { display: block; margin: 12px 0; overflow-x: auto; color: var(--oa-text); }
    .oa-katex-block .katex-display { margin: 0 !important; }
    .oa-katex-inline { color: var(--oa-text); }
    input:focus, textarea:focus, button:focus { outline: none; }
    /* Focused fields get a clean, crisp border highlight — no blurry glow
       ring. The border transition is owned by each field's inline style. */
    input:focus-visible, textarea:focus-visible { box-shadow: none; border-color: var(--oa-primary) !important; }
    button { font-family: inherit; }
    a { color: var(--oa-primary); text-decoration: none; }
    a:hover { text-decoration: underline; text-shadow: 0 0 6px var(--oa-accentGlow); }
    ::selection { background: var(--oa-primarySoft); color: var(--oa-text); }
    /* Respect users who ask for less motion — drop entrance animations
       and interaction transforms, keep functional state changes. */
    @media (prefers-reduced-motion: reduce) {
      .oa-fade-in, .oa-slide-up, .oa-msg-in, .oa-slide-in-x { animation: none !important; }
      .oa-hover-lift:hover, .oa-hover-lift:active, .oa-icon-btn:active,
      .oa-press:active, .oa-composer:focus-within { transform: none !important; }
    }
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
  const pal = activePalette();
  const lines = SCALAR_KEYS
    .map((k) => `  --oa-${k}: ${(pal as any)[k]};`)
    .join('\n');
  el.textContent = `:root {\n${lines}\n}`;
  document.documentElement.setAttribute('data-theme', activeMode);
}

/**
 * Switch the active theme mode. On web this only rewrites the `:root`
 * CSS custom properties, so every component that styles through
 * `colors` (i.e. `var(--oa-*)`) repaints instantly with no re-render.
 * On native it mutates the shared `colors` object in place; consumers
 * pick up the new values on their next render (drive that re-render via
 * the theme store / a `subscribeTheme` listener). Persists to
 * localStorage so the choice survives a reload.
 */
export function setTheme(mode: ThemeMode): void {
  if (mode === activeMode) return;
  activeMode = mode;
  if (isWeb && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // quota / private mode — ignore, the in-memory switch still works
    }
  }
  if (isWeb) {
    ensureCssVariables();
  } else {
    // Native holds raw hex — mutate in place so already-imported
    // `colors` references see the new palette.
    Object.assign(colors as any, buildColors());
  }
  themeListeners.forEach((fn) => fn(mode));
}

ensureFonts();
ensureCssVariables();
ensureGlobalCss();

/** Raw palette — actual hex values, never `var(--oa-*)` refs. Use this
 *  in contexts that can't resolve CSS variables at paint time (Canvas
 *  2D `fillStyle`/`strokeStyle`, gradient stop math, etc.). DOM styles
 *  should keep using `colors` so they remain CSS-var-driven. */
export function getRawColors(): Palette {
  return activePalette();
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
