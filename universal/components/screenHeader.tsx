/**
 * Shared react-navigation header pieces.
 *
 * EVERY screen — top-level tabs AND pushed sub-screens (editors, run
 * history, note views) — uses the real navigator header, never a custom
 * in-content title bar. Top-level screens get `HeaderMenu` (the phone
 * drawer toggle) as `headerLeft`; pushed sub-screens get `HeaderBack`.
 * Right-side actions use `HeaderAction` (labelled button) or
 * `HeaderIconButton` (icon-only). All controls are `no-drag` so the rest
 * of the header still drags the window. See DragRegion.
 */

import { Pressable, Text, Platform, View } from 'react-native';
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

/** Back control for `headerLeft` on pushed sub-screens — a themed,
 *  no-drag chevron that pops the enclosing stack (never `router.back()`,
 *  which can bubble to the drawer / land on the login screen). Pass
 *  `onPress` to override the dismissal (e.g. terminal closes its window). */
export function HeaderBack({ onPress, label }: { onPress?: () => void; label?: string }) {
  const navigation = useNavigation<any>();
  const goBack = () => {
    if (onPress) { onPress(); return; }
    if (navigation.canGoBack?.()) navigation.goBack();
  };
  return (
    <Pressable
      onPress={goBack}
      hitSlop={8}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 2,
        height: 36, paddingHorizontal: 8, marginLeft: 4,
        borderRadius: radius.md, ...NO_DRAG,
      }}
      accessibilityRole="button"
      accessibilityLabel="Back"
      // @ts-ignore web hover
      {...(Platform.OS === 'web' ? { className: 'oa-side-row' } : {})}
    >
      <Feather name="chevron-left" size={22} color={colors.accent} />
      {label ? (
        <Text style={{ fontFamily: font.sans, fontSize: 14, fontWeight: '600', color: colors.accent }}>{label}</Text>
      ) : null}
    </Pressable>
  );
}

/** Right-side header action — the unified "create / add new / save" control. */
export function HeaderAction({
  icon = 'plus',
  label,
  onPress,
  disabled = false,
}: {
  icon?: IconName;
  label?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
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
        opacity: disabled ? 0.45 : 1,
        ...NO_DRAG,
      }}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
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

/** Icon-only header control (no-drag). Use for refresh / mode toggles /
 *  secondary actions; group several inside a `HeaderRight` row. */
export function HeaderIconButton({
  icon,
  onPress,
  active = false,
  disabled = false,
  accessibilityLabel,
}: {
  icon: IconName;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={{
        width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
        borderRadius: radius.md, borderWidth: 1,
        borderColor: active ? colors.border : 'transparent',
        backgroundColor: active ? colors.primaryLight : 'transparent',
        opacity: disabled ? 0.45 : 1,
        ...NO_DRAG,
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={accessibilityLabel}
      // @ts-ignore web hover
      {...(Platform.OS === 'web' ? { className: 'oa-side-row' } : {})}
    >
      <Feather name={icon} size={16} color={active ? colors.accent : colors.textSecondary} />
    </Pressable>
  );
}

/** Row wrapper for several header controls (keeps right padding consistent). */
export function HeaderRight({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 }}>
      {children}
    </View>
  );
}
