/**
 * Shared color palette and design tokens.
 * Primary gradient: #d94841 (accent red) → #f3a33a (amber).
 */

export const colors = {
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

/** CSS gradient string for web backgrounds */
export const primaryGradient = 'linear-gradient(135deg, #d94841 0%, #f3a33a 100%)';
export const primaryGradientStops = [colors.primary, colors.primaryEnd] as const;

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
