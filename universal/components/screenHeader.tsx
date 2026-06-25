/**
 * Shared react-navigation header pieces.
 *
 * Every top-level screen uses the real navigator header (not a custom
 * in-content title bar): a left-aligned title, a phone-only menu button
 * that toggles the drawer, and an optional right-side action (the
 * screen's "create / add new" control). Workflows, Scheduled and
 * Connectors all share `themedHeader` + `HeaderAction` so their headers
 * and create buttons line up exactly.
 */

import { Pressable, Text, Platform } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { useLayout } from '../hooks/useLayout';
import DragRegion, { NO_DRAG } from './DragRegion';
import { colors, font, radius } from '../theme';

type IconName = keyof typeof Feather.glyphMap;

// The whole header drags the window. react-navigation paints `headerBackground`
// as a fill BEHIND the title + buttons (its siblings, not its children), so the
// `no-drag` buttons are never nested inside the drag region — which is what
// caused the macOS double-click-to-maximize button freeze. See DragRegion.

/** Themed header options shared by every screen's navigator. */
export const themedHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.bg },
  headerShadowVisible: false,
  headerTitleAlign: 'center' as const,
  headerTintColor: colors.accent,
  // Full-width window drag strip behind the title/buttons (Electron only;
  // paints the header background everywhere else).
  headerBackground: () => <DragRegion color={colors.bg} />,
  headerTitleStyle: {
    fontFamily: font.sans,
    fontSize: 17,
    fontWeight: '600' as const,
    color: colors.text,
    letterSpacing: 0.3,
  },
};

/** Phone-only hamburger for `headerLeft` on top-level screens — toggles
 *  the drawer. Renders nothing on tablet/desktop (sidebar is permanent). */
export function HeaderMenu() {
  const navigation = useNavigation();
  const { isPhone } = useLayout();
  if (!isPhone) return null;
  return (
    <Pressable
      onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
      hitSlop={8}
      style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: 6, borderRadius: radius.md, ...NO_DRAG }}
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      // @ts-ignore web hover
      {...(Platform.OS === 'web' ? { className: 'oa-side-row' } : {})}
    >
      <Feather name="menu" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

/** Right-side header action — the unified "create / add new" control. */
export function HeaderAction({
  icon = 'plus',
  label,
  onPress,
}: {
  icon?: IconName;
  label?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 11,
        paddingVertical: 6,
        marginRight: 12,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.primaryLight,
        ...NO_DRAG,
      }}
      accessibilityRole="button"
      accessibilityLabel={label ?? 'Create'}
      // @ts-ignore web hover
      {...(Platform.OS === 'web' ? { className: 'oa-hover-lift' } : {})}
    >
      <Feather name={icon} size={14} color={colors.accent} />
      {label ? (
        <Text style={{ fontFamily: font.sans, fontSize: 13, fontWeight: '600', color: colors.text }}>{label}</Text>
      ) : null}
    </Pressable>
  );
}
