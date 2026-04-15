import { colors } from '../theme';
/**
 * App header with drag area + account switcher.
 *
 * - macOS: 78px left padding for traffic light buttons
 * - Windows: ~140px right padding for window controls
 * - Linux: similar to Windows
 * - Entire bar is draggable; interactive elements are no-drag zones
 */

import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../stores/connection';
import { useIsWideScreen } from '../hooks/useLayout';
import { useDrawer } from '../stores/drawer';
import { useThemeStore } from '../stores/theme';
import { useConfirm } from './ConfirmDialog';

// Detect desktop platform from preload bridge
function getDesktopPlatform(): 'darwin' | 'win32' | 'linux' | null {
  if (Platform.OS !== 'web') return null;
  const p = (window as any).desktop?.platform;
  if (p === 'darwin' || p === 'win32' || p === 'linux') return p;
  return null;
}

export default function Header() {
  const router = useRouter();
  const platform = getDesktopPlatform();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const isWide = useIsWideScreen();
  const requestToggle = useDrawer((s) => s.requestToggle);
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const confirm = useConfirm();

  const {
    accounts, activeAccountId, isConnected, agentName,
    switchAccount, removeAccount,
  } = useConnection();

  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const displayName = activeAccount?.name || agentName || 'Not Connected';

  const handleSwitch = (id: string) => {
    setDropdownOpen(false);
    if (id !== activeAccountId) {
      switchAccount(id);
      router.replace('/(tabs)/chat');
    }
  };

  const handleRemove = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: 'Remove Agent',
      message: `Remove "${name}"? You can re-add it later.`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;

    removeAccount(id);
    setDropdownOpen(false);
    if (id === activeAccountId) {
      router.replace('/');
    }
  };

  const handleAdd = () => {
    setDropdownOpen(false);
    // Disconnect so the login screen doesn't auto-redirect back to tabs
    useConnection.getState().disconnect();
    router.replace('/');
  };

  return (
    <View style={[
      styles.header,
      // @ts-ignore web CSS
      { WebkitAppRegion: 'drag' },
    ]}>
      {/* macOS traffic light padding */}
      {platform === 'darwin' && <View style={styles.macPadding} />}

      {/* Hamburger button (narrow screens only) */}
      {!isWide && (
        <TouchableOpacity
          onPress={requestToggle}
          style={[
            styles.hamburgerBtn,
            // @ts-ignore
            { WebkitAppRegion: 'no-drag' },
          ]}
        >
          <Feather name="menu" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}

      {/* Center: account switcher */}
      <View style={styles.center}>
        <TouchableOpacity
          onPress={() => setDropdownOpen(!dropdownOpen)}
          style={[
            styles.switcherBtn,
            // @ts-ignore
            { WebkitAppRegion: 'no-drag' },
          ]}
        >
          <View style={[styles.statusDot, isConnected ? styles.dotGreen : styles.dotGray]} />
          <Text style={styles.accountName} numberOfLines={1}>{displayName}</Text>
          <Feather name="chevron-down" size={14} color={colors.textMuted} style={styles.chevron} />
        </TouchableOpacity>
      </View>

      {/* Add account button */}
      <TouchableOpacity
        onPress={handleAdd}
        style={[
          styles.addBtn,
          // @ts-ignore
          { WebkitAppRegion: 'no-drag' },
        ]}
      >
        <Feather name="plus" size={16} color={colors.primary} />
      </TouchableOpacity>

      {/* Dark mode toggle — desktop/wide-screen only. Sits before the
          Windows/Linux window-control padding so it stays clear of
          the min/max/close buttons. */}
      {isWide && (
        <TouchableOpacity
          onPress={toggleTheme}
          accessibilityLabel={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={[
            styles.themeBtn,
            // @ts-ignore
            { WebkitAppRegion: 'no-drag' },
          ]}
        >
          <Feather
            name={themeMode === 'dark' ? 'sun' : 'moon'}
            size={15}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      )}

      {/* Windows/Linux window button padding */}
      {(platform === 'win32' || platform === 'linux') && <View style={styles.winPadding} />}

      {/* Dropdown */}
      {dropdownOpen && (
        <>
          {/* Backdrop to close on outside click */}
          <Pressable
            style={styles.backdrop}
            onPress={() => setDropdownOpen(false)}
          />
          <View style={styles.dropdown}>
            {accounts.length === 0 && (
              <Text style={styles.emptyDropdown}>No saved accounts</Text>
            )}
            {accounts.map((acc) => (
              <View key={acc.id} style={styles.dropdownRow}>
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => handleSwitch(acc.id)}
                >
                  <Feather
                    name={acc.id === activeAccountId ? 'check-circle' : 'circle'}
                    size={14}
                    color={acc.id === activeAccountId ? colors.primary : colors.textMuted}
                    style={styles.radioBtn}
                  />
                  <View style={styles.dropdownInfo}>
                    <Text style={styles.dropdownName} numberOfLines={1}>{acc.name}</Text>
                    <Text style={styles.dropdownHost}>{acc.host}:{acc.port}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { void handleRemove(acc.id, acc.name); }}
                  style={styles.removeBtn}
                >
                  <Feather name="x" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.dropdownAdd} onPress={handleAdd}>
              <View style={styles.dropdownAddContent}>
                <Feather name="plus" size={14} color={colors.primary} />
                <Text style={styles.dropdownAddText}>Add Agent</Text>
              </View>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sidebar,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    position: 'relative',
    zIndex: 200,
  },
  macPadding: { width: 78 },
  winPadding: { width: 140 },
  hamburgerBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    borderRadius: 6,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switcherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 7,
  },
  dotGreen: { backgroundColor: colors.success },
  dotGray: { backgroundColor: colors.border },
  accountName: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    maxWidth: 200,
  },
  chevron: {
    marginLeft: 5,
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: colors.primaryLight,
  },
  themeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  // Dropdown
  backdrop: {
    position: 'absolute',
    top: 38,
    left: 0,
    right: 0,
    bottom: -1000,
    zIndex: 999,
  },
  dropdown: {
    position: 'absolute',
    top: 36,
    left: '50%',
    // @ts-ignore web transform
    transform: [{ translateX: -120 }],
    width: 240,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    // @ts-ignore
    elevation: 8,
    zIndex: 1000,
    paddingVertical: 4,
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  dropdownItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  radioBtn: {
    marginRight: 8,
  },
  dropdownInfo: { flex: 1 },
  dropdownName: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },
  dropdownHost: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  removeBtn: {
    padding: 6,
  },
  emptyDropdown: {
    padding: 12,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  dropdownAdd: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 2,
  },
  dropdownAddContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownAddText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
    marginLeft: 8,
  },
});
