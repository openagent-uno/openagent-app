/**
 * DetachedHeader — the top bar for a detached screen (run history, the
 * scheduled-task editor, …).
 *
 * Detached screens render either in their own desktop window or as a
 * pushed full-screen route on web / native. Either way they need a
 * consistent dismiss control and title: the back chevron calls
 * ``onClose`` (wired to ``closeDetached``, which closes the window on
 * desktop or pops the stack elsewhere). An optional ``right`` slot
 * carries a primary action such as the editor's Save button.
 *
 * On the desktop shell a thin draggable strip (the app ``Header``)
 * already sits above this; this bar is the screen's own content header.
 */

import Feather from '@expo/vector-icons/Feather';
import { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, font, radius } from '../theme';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  right?: ReactNode;
}

export default function DetachedHeader({ title, subtitle, onClose, right }: Props) {
  return (
    <View style={styles.bar}>
      <TouchableOpacity
        onPress={onClose}
        style={styles.backBtn}
        accessibilityLabel="Back"
      >
        <Feather name="chevron-left" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: 6,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  titleWrap: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    fontFamily: font.display,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
    fontFamily: font.mono,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
