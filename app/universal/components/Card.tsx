/**
 * Card — consistent bordered surface used for grouped content.
 * `padded` adds default interior padding (16); omit for list-style cards
 * where inner rows handle their own padding.
 */

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';

interface CardProps {
  children: ReactNode;
  padded?: boolean;
  tight?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function Card({ children, padded = true, tight = false, style }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        padded && (tight ? styles.tight : styles.padded),
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  padded: { padding: 16 },
  tight: { padding: 12 },
});

/** Thin divider row used inside Cards to separate stacked items. */
export function CardDivider() {
  return <View style={{ height: 1, backgroundColor: colors.borderLight }} />;
}
