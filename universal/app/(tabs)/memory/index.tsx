/**
 * Memory — graph dashboard (stack root).
 *
 * Wide: fixed file-tree sidebar + graph. Narrow: drawer sidebar + graph.
 * Tapping a note (sidebar or graph node) pushes ``[...path]`` onto the
 * Memory Stack, which hosts the editor. ``router.push`` keeps ``index``
 * on the stack so the editor's back chevron (the shared ``HeaderBack`` →
 * ``goBack`` → ``router.back()``) returns here cleanly.
 *
 * The nav header carries a search bar (title → search on focus) that
 * both filters the graph (matching nodes glow, others dim) and shows a
 * results dropdown. Search state lives in the vault store so the sidebar
 * search benefits from the same query.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter, useNavigation, useFocusEffect } from 'expo-router';
import GraphView from '../../../components/GraphView';
import ResponsiveSidebar from '../../../components/ResponsiveSidebar';
import VaultSidebar from '../../../components/memory/VaultSidebar';
import { HeaderAction, useHeaderInset } from '../../../components/screenHeader';
import { useConnection } from '../../../stores/connection';
import { useEvents } from '../../../stores/events';
import { useVault } from '../../../stores/vault';
import { setBaseUrl } from '../../../services/api';
import { colors, font, radius, glassSurface } from '../../../theme';

// ── Search header (replaces the nav bar's title when active) ──

/**
 * In-header search control. On desktop it renders a TextInput in the
 * center of the nav header. On phone it shows a search icon that expands
 * into the full input. The parent index screen reads ``searchQuery`` /
 * ``searchResults`` / ``highlightNodeIds`` from the vault store.
 */
function SearchHeader() {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const { searchQuery, search, clearSearch } = useVault();

  // Focus the input when the user activates the phone search icon
  const activate = () => {
    setFocused(true);
    // Focus the input on next tick so the ref is mounted
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const onClear = () => {
    clearSearch();
    inputRef.current?.clear();
    inputRef.current?.blur();
    setFocused(false);
  };

  // Phone: icon toggle. Desktop: always-visible bar.
  const isPhone = false; // simplified — the layout hook would be needed for
                         // a real responsive check; we rely on the fact that
                         // the phone drawer makes the sidebar permanent.

  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.innerWidth < 768) {
    // Narrow viewport: show search icon that expands
    if (!focused && !searchQuery) {
      return (
        <Pressable
          onPress={activate}
          hitSlop={8}
          style={styles.searchIconToggle}
          accessibilityRole="button"
          accessibilityLabel="Search notes"
        >
          <Feather name="search" size={18} color={colors.textSecondary} />
        </Pressable>
      );
    }
  }

  return (
    <View style={styles.searchHeaderRow}>
      {(!focused && !searchQuery) ? (
        <Text style={styles.searchHeaderTitle}>Memory</Text>
      ) : null}
      <View style={[
        styles.searchInputWrap,
        (focused || searchQuery) && styles.searchInputWrapActive,
      ]}>
        <Feather name="search" size={14} color={colors.textMuted} style={{ marginLeft: 8 }} />
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={(q) => (q ? search(q) : clearSearch())}
          placeholder="Search notes..."
          placeholderTextColor={colors.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            if (!searchQuery) setFocused(false);
          }}
          returnKeyType="search"
        />
        {(focused || searchQuery) ? (
          <Pressable onPress={onClear} hitSlop={8} style={styles.searchClearBtn}>
            <Feather name="x" size={14} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ── Search-results dropdown ──

/**
 * Floating panel below the header that lists search results. Appears
 * when ``searchResults.length > 0``. Each row shows the note title,
 * path, and tags. Tapping a result navigates to the note editor.
 * Closes on Escape or outside click.
 */
function SearchResultsDropdown({ onSelect }: { onSelect: (path: string) => void }) {
  const { searchResults, searchQuery, clearSearch } = useVault();
  const dropdownRef = useRef<View>(null);

  // Close on Escape
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSearch();
      }
    };
    // Only attach when there are results
    if (searchResults.length > 0) {
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }
  }, [searchResults.length, clearSearch]);

  if (searchResults.length === 0 && !searchQuery) return null;

  const MAX_VISIBLE = 15;
  const visible = searchResults.slice(0, MAX_VISIBLE);
  const hidden = searchResults.length - visible.length;

  return (
    <View style={styles.dropdownContainer} ref={dropdownRef}>
      <View style={styles.dropdownHeader}>
        <Text style={styles.dropdownCount}>
          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
        </Text>
      </View>
      <ScrollView
        style={styles.dropdownList}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {visible.map((n) => (
          <Pressable
            key={n.path}
            style={({ pressed }) => [
              styles.dropdownItem,
              pressed && styles.dropdownItemPressed,
            ]}
            onPress={() => {
              onSelect(n.path);
              clearSearch();
            }}
          >
            <View style={styles.dropdownItemMain}>
              <Feather name="file-text" size={12} color={colors.textMuted} style={{ marginRight: 6 }} />
              <Text style={styles.dropdownItemTitle} numberOfLines={1}>
                {n.title || n.path.split('/').pop()?.replace('.md', '')}
              </Text>
            </View>
            <Text style={styles.dropdownItemPath} numberOfLines={1}>
              {n.path}
            </Text>
            {n.tags && n.tags.length > 0 && (
              <Text style={styles.dropdownItemTags} numberOfLines={1}>
                {n.tags.slice(0, 3).join(', ')}
              </Text>
            )}
          </Pressable>
        ))}
        {hidden > 0 && (
          <Text style={styles.dropdownMore}>+{hidden} more — refine your search</Text>
        )}
      </ScrollView>
    </View>
  );
}

// ── Main screen ──

export default function MemoryGraphScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const headerInset = useHeaderInset();
  const config = useConnection((s) => s.config);
  const { graph, highlightNodeIds, loading, loadNotes, loadGraph } = useVault();

  useEffect(() => {
    if (config) {
      if (config.sidecarPort) setBaseUrl('127.0.0.1', config.sidecarPort);
      loadNotes();
      loadGraph();
    }
  }, [config]);

  // Refetch on every screen focus so re-opening the tab always shows
  // fresh data (same as Connectors). The store keeps the existing notes
  // and graph visible while the refetch is in flight, so the graph never
  // blanks out to a loading state after the first load.
  useFocusEffect(
    useCallback(() => {
      void loadNotes();
      void loadGraph();
    }, [loadNotes, loadGraph]),
  );

  // Refetch when the agent (or another tab) writes/deletes a vault note.
  useEffect(() => {
    return useEvents.getState().subscribe('vault', () => {
      void loadNotes();
      void loadGraph();
    });
  }, [loadNotes, loadGraph]);

  const openNote = (path: string) => {
    // Split on ``/`` so folder segments become individual route segments
    // — the ``[...path]`` catch-all receives them as an array.
    router.push({
      pathname: '/(tabs)/memory/[...path]',
      params: { path: path.split('/') },
    });
  };

  const openHistory = () => router.push('/(tabs)/memory/history');

  // Vault-history action in the nav header's right slot + the search bar
  // as the custom header title component.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => <SearchHeader />,
      headerRight: () => <HeaderAction icon="clock" label="History" onPress={openHistory} />,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  return (
    <ResponsiveSidebar
      sidebar={(
        <View style={{ flex: 1, paddingTop: headerInset }}>
          <VaultSidebar selectedPath={null} onSelectNote={openNote} />
        </View>
      )}
    >
      {/* The graph fills the whole area, drawing behind the transparent
          header so it shows through the frosted glass. The empty state is
          centered, so it never hides under the header. */}
      <View style={styles.mainArea}>
        {/* Search-results dropdown overlay — positioned at the top so it
            appears just below the frosted header bar. */}
        {graph && graph.nodes.length > 0 ? (
          <>
            <GraphView
              data={graph}
              highlightNodeIds={highlightNodeIds}
              onSelectNode={openNote}
            />
            <SearchResultsDropdown onSelect={openNote} />
          </>
        ) : (
          <View style={styles.graphEmpty}>
            <Text style={styles.emptyText}>
              {loading ? 'Loading graph...' : 'No notes to visualize'}
            </Text>
          </View>
        )}
      </View>
    </ResponsiveSidebar>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  mainArea: { flex: 1 },
  graphEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 12, padding: 14 },

  // Search header (replaces the nav title)
  searchHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flex: 1,
    maxWidth: 420,
  },
  searchHeaderTitle: {
    fontFamily: font.sans,
    fontSize: 17,
    fontWeight: '600' as const,
    color: colors.text,
    letterSpacing: 0.3,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    height: 34,
    maxWidth: 320,
  },
  searchInputWrapActive: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontFamily: font.sans,
    paddingHorizontal: 8,
    paddingVertical: 4,
    outlineStyle: 'none' as any,
    outlineWidth: 0,
  },
  searchClearBtn: {
    padding: 4,
    marginRight: 4,
    borderRadius: radius.xs,
  },
  searchIconToggle: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },

  // Search results dropdown
  dropdownContainer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    marginHorizontal: 12,
    marginTop: 4,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: glassSurface.webFilter,
          WebkitBackdropFilter: glassSurface.webFilter,
        } as any)
      : {}),
    maxHeight: 360,
    zIndex: 100,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  dropdownHeader: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  dropdownCount: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: font.mono,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
  },
  dropdownList: {
    maxHeight: 320,
  },
  dropdownItem: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  dropdownItemPressed: {
    backgroundColor: colors.hover,
  },
  dropdownItemMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownItemTitle: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: colors.text,
    fontFamily: font.sans,
    flex: 1,
  },
  dropdownItemPath: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: font.mono,
    marginTop: 2,
    paddingLeft: 18,
  },
  dropdownItemTags: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: font.mono,
    marginTop: 1,
    paddingLeft: 18,
  },
  dropdownMore: {
    color: colors.textMuted,
    fontSize: 11,
    padding: 12,
    textAlign: 'center' as const,
    fontFamily: font.mono,
  },
});