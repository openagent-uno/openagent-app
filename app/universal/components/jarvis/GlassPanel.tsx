import React from 'react';
import { View, StyleSheet, Platform, ViewStyle, StyleProp } from 'react-native';
import { colors, radius as r, spacing as s } from '../../theme';

interface Props {
  children: React.ReactNode;
  /** Show the glowing cyan rail across the top edge. Default true. */
  rail?: boolean;
  /** Make the rail glow continuously (pulse). Default false. */
  pulseRail?: boolean;
  /** Tighter padding for inline / list-row use. */
  compact?: boolean;
  /** Override padding completely. */
  padding?: number;
  /** Use a more opaque, more solid look (when there's no canvas grid behind). */
  solid?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Optional pressable layer outside this component should set this true to suppress hover effects. */
  noHover?: boolean;
}

/**
 * The shared JARVIS panel material. Translucent dark fill, hairline
 * cyan border, and an optional cyan glowing top rail (the "plugged
 * into a rail" detail you see on the music + chat widgets in the
 * reference video).
 *
 * Web uses backdrop-filter blur for the glass effect. Native uses a
 * solid translucent color (BlurView is opt-in via `solid={false}` —
 * we keep this v1-simple and skip BlurView; it can be added in a
 * later pass when expo-blur is installed).
 */
export default function GlassPanel({
  children,
  rail = true,
  pulseRail = false,
  compact = false,
  padding,
  solid = false,
  style,
  noHover = false,
}: Props) {
  const pad = padding ?? (compact ? s.sm : s.lg);
  return (
    <View
      style={[
        styles.panel,
        solid ? styles.solid : styles.glass,
        { padding: pad },
        Platform.OS === 'web' && webGlassStyle(solid),
        style,
      ]}
    >
      {rail && (
        <View
          style={[
            styles.rail,
            // @ts-ignore — boxShadow web-only
            Platform.OS === 'web' && { boxShadow: `0 0 8px ${colors.accentGlow}` },
            pulseRail && Platform.OS === 'web' && ({ animation: 'oa-jarvis-rail-pulse 2.4s ease-in-out infinite' } as any),
          ]}
        />
      )}
      {children}
    </View>
  );
}

function webGlassStyle(solid: boolean): any {
  if (solid) return null;
  return {
    backdropFilter: 'blur(14px) saturate(140%)',
    WebkitBackdropFilter: 'blur(14px) saturate(140%)',
  };
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: colors.border,
    position: 'relative',
    overflow: 'hidden',
  },
  glass: {
    backgroundColor: colors.panelBg,
  },
  solid: {
    backgroundColor: colors.panelBgSolid,
  },
  rail: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.panelRail,
  },
});
