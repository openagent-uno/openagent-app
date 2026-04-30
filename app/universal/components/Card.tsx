/**
 * Card — JARVIS-themed bordered surface with an optional cyan top rail.
 *
 * `padded` adds default interior padding (16); omit for list-style cards
 * where inner rows handle their own padding. `rail` (default true) shows
 * the glowing cyan accent line at the top edge — set false on dense
 * lists where the rail would be too busy.
 */

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View, StyleSheet, Platform } from 'react-native';
import { colors, radius } from '../theme';

interface CardProps {
  children: ReactNode;
  padded?: boolean;
  tight?: boolean;
  rail?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function Card({
  children,
  padded = true,
  tight = false,
  rail = true,
  style,
}: CardProps) {
  return (
    <View
      style={[
        styles.card,
        padded && (tight ? styles.tight : styles.padded),
        Platform.OS === 'web' && webGlassStyle(),
        style,
      ]}
    >
      {rail && (
        <View
          style={[
            styles.rail,
            // @ts-ignore boxShadow web-only
            Platform.OS === 'web' && { boxShadow: `0 0 6px ${colors.accentGlow}` },
          ]}
        />
      )}
      {children}
    </View>
  );
}

function webGlassStyle(): any {
  return {
    backdropFilter: 'blur(12px) saturate(140%)',
    WebkitBackdropFilter: 'blur(12px) saturate(140%)',
  };
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    position: 'relative',
    overflow: 'hidden',
  },
  padded: { padding: 16 },
  tight: { padding: 12 },
  rail: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: colors.panelRail,
  },
});

/** Thin divider row used inside Cards to separate stacked items. */
export function CardDivider() {
  return <View style={{ height: 1, backgroundColor: colors.borderLight }} />;
}
