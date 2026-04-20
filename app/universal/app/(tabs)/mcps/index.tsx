/**
 * MCPs — dashboard grid.
 *
 * Three-way TabStrip:
 *
 *   - Builtin: rows where ``kind !== 'custom'`` — MCPs shipped with
 *     OpenAgent. Toggle-only; remove is never offered (deleting a
 *     builtin row makes no sense — the row is its control surface).
 *   - Custom: rows where ``kind === 'custom'`` — user-added (manual or
 *     via marketplace install). Toggle + remove.
 *   - Browse: marketplace proxy (/api/marketplace/search). Each result
 *     that matches an installed row shows "Installed"; others show a
 *     primary Install button that pushes to /mcps/install.
 *
 * Grid column count is derived from the *container's* measured width via
 * ``onLayout`` (not ``useWindowDimensions``), so it stays correct even
 * when the app-level chrome (sidebars, bottom tab bar, Electron window
 * edges) reduces content width below the window width.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Platform,
  type LayoutChangeEvent,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter, useFocusEffect } from 'expo-router';
import { useConnection } from '../../../stores/connection';
import {
  setBaseUrl, listMcps, deleteMcp, enableMcp, disableMcp,
  searchMcpMarketplace,
  type MarketplaceCard,
} from '../../../services/api';
import type { MCPEntry } from '../../../../common/types';
import { colors, font, radius } from '../../../theme';
import Button from '../../../components/Button';
import TabStrip from '../../../components/TabStrip';
import { useConfirm } from '../../../components/ConfirmDialog';
import McpTile from '../../../components/mcps/McpTile';
import MarketplaceTile from '../../../components/mcps/MarketplaceTile';

type Mode = 'builtin' | 'custom' | 'browse';

const MARKETPLACE_SOURCE_PREFIX = 'marketplace:registry.modelcontextprotocol.io/';
const SEARCH_DEBOUNCE_MS = 300;
const TILE_MIN_WIDTH = 260;
const TILE_MAX_COLS = 4;

/**
 * Compute column count from the *container's* measured width. Base the
 * count on how many TILE_MIN_WIDTH-sized cells fit with gaps in between.
 * We use measured width (via onLayout) rather than window width so that
 * any outer chrome (Electron sidebar, bottom tab bar, padding) is
 * naturally accounted for.
 */
function columnsForWidth(width: number, gap: number): number {
  if (width <= 0) return 1;
  // n cells need n*cell + (n-1)*gap <= width → n <= (width+gap)/(cell+gap)
  const n = Math.floor((width + gap) / (TILE_MIN_WIDTH + gap));
  return Math.max(1, Math.min(TILE_MAX_COLS, n));
}

/** Derive the registry server name a row was installed from (empty string for non-marketplace rows). */
function registryNameOf(entry: MCPEntry): string {
  const src = entry.source || '';
  if (!src.startsWith(MARKETPLACE_SOURCE_PREFIX)) return '';
  const remainder = src.slice(MARKETPLACE_SOURCE_PREFIX.length);
  const at = remainder.lastIndexOf('@');
  return at === -1 ? remainder : remainder.slice(0, at);
}

export default function McpsScreen() {
  const router = useRouter();
  const config = useConnection((s) => s.config);
  const confirm = useConfirm();

  const [mode, setMode] = useState<Mode>('builtin');
  const [installed, setInstalled] = useState<MCPEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [installedQuery, setInstalledQuery] = useState('');

  // Marketplace state
  const [mktQuery, setMktQuery] = useState('');
  const [mktResults, setMktResults] = useState<MarketplaceCard[]>([]);
  const [mktCursor, setMktCursor] = useState<string | undefined>(undefined);
  const [mktLoading, setMktLoading] = useState(false);
  const [mktError, setMktError] = useState<string | null>(null);
  const mktDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Container-measured width. Starts at 0; first layout pass fills it.
  const [containerWidth, setContainerWidth] = useState(0);
  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    // Debounce updates to avoid thrashing on web window resizes.
    if (Math.abs(w - containerWidth) > 1) setContainerWidth(w);
  }, [containerWidth]);
  const cols = useMemo(() => columnsForWidth(containerWidth, 14), [containerWidth]);

  // ── Data loading ──
  const refresh = useCallback(async () => {
    try {
      const rows = await listMcps();
      setInstalled(rows);
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.host, config.port);
      refresh();
    }
  }, [config, refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // ── Installed actions ──
  const toggleEntry = async (entry: MCPEntry) => {
    try {
      if (entry.enabled) await disableMcp(entry.name);
      else await enableMcp(entry.name);
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const removeEntry = async (entry: MCPEntry) => {
    const ok = await confirm({
      title: 'Remove MCP',
      message: `Remove "${entry.name}" from your installed MCP list?`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await deleteMcp(entry.name);
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  // ── Marketplace search (debounced) ──
  const runSearch = useCallback(async (q: string, cursor?: string, append = false) => {
    setMktLoading(true);
    setMktError(null);
    try {
      const data = await searchMcpMarketplace(q, cursor, 30);
      setMktResults((prev) => (append ? [...prev, ...data.servers] : data.servers));
      setMktCursor(data.nextCursor);
    } catch (e: any) {
      setMktError(e?.message || String(e));
      if (!append) setMktResults([]);
    } finally {
      setMktLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'browse') return;
    if (mktDebounceRef.current) clearTimeout(mktDebounceRef.current);
    mktDebounceRef.current = setTimeout(() => runSearch(mktQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => {
      if (mktDebounceRef.current) clearTimeout(mktDebounceRef.current);
    };
  }, [mktQuery, mode, runSearch]);

  // ── Computed ──
  const builtinRows = useMemo(
    () => installed.filter((e) => e.kind !== 'custom'),
    [installed],
  );
  const customRows = useMemo(
    () => installed.filter((e) => e.kind === 'custom'),
    [installed],
  );

  const filteredInstalled = useMemo(() => {
    const src = mode === 'builtin' ? builtinRows : customRows;
    const q = installedQuery.trim().toLowerCase();
    if (!q) return src;
    return src.filter((e) => e.name.toLowerCase().includes(q));
  }, [mode, builtinRows, customRows, installedQuery]);

  const installedRegistryNames = useMemo(() => {
    const s = new Set<string>();
    for (const e of installed) {
      const n = registryNameOf(e);
      if (n) s.add(n);
    }
    return s;
  }, [installed]);

  const activeCount = useMemo(
    () => installed.filter((e) => e.enabled).length,
    [installed],
  );

  // ── Marketplace install click ──
  const onInstallClick = (card: MarketplaceCard) => {
    router.push({
      pathname: '/mcps/install',
      params: { name: card.name, version: card.version || 'latest' },
    });
  };

  // ── Render ──
  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onLayout={onContainerLayout}
      >
        {/* Header — same style as other tabs (Geist display, hint under, no serif) */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>MCPs</Text>
            <Text style={styles.hint}>
              Model Context Protocol servers give the agent extra tools.{' '}
              {installed.length} installed, {activeCount} active. Changes are live on the next message.
            </Text>
          </View>
          <Button
            variant="ghost"
            size="sm"
            icon="refresh-cw"
            label="Refresh"
            onPress={refresh}
          />
        </View>

        <View style={styles.tabsRow}>
          <TabStrip<Mode>
            tabs={[
              { id: 'builtin', label: `Builtin · ${builtinRows.length}`, icon: 'package' },
              { id: 'custom', label: `Custom · ${customRows.length}`, icon: 'sliders' },
              { id: 'browse', label: 'Browse', icon: 'compass' },
            ]}
            active={mode}
            onChange={setMode}
            size="md"
          />
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={13} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {mode === 'builtin' && (
          <InstalledPane
            kind="builtin"
            query={installedQuery}
            setQuery={setInstalledQuery}
            items={filteredInstalled}
            cols={cols}
            onToggle={toggleEntry}
            onRemove={undefined}
          />
        )}
        {mode === 'custom' && (
          <InstalledPane
            kind="custom"
            query={installedQuery}
            setQuery={setInstalledQuery}
            items={filteredInstalled}
            cols={cols}
            onToggle={toggleEntry}
            onRemove={removeEntry}
            onExplore={() => setMode('browse')}
          />
        )}
        {mode === 'browse' && (
          <MarketplacePane
            query={mktQuery}
            setQuery={setMktQuery}
            loading={mktLoading}
            error={mktError}
            results={mktResults}
            cursor={mktCursor}
            cols={cols}
            installedNames={installedRegistryNames}
            onInstallClick={onInstallClick}
            onLoadMore={() => runSearch(mktQuery.trim(), mktCursor, true)}
          />
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Installed panes (builtin + custom share layout; differ in remove button)
// ───────────────────────────────────────────────────────────────────────

interface InstalledPaneProps {
  kind: 'builtin' | 'custom';
  query: string;
  setQuery: (v: string) => void;
  items: MCPEntry[];
  cols: number;
  onToggle: (entry: MCPEntry) => void;
  onRemove?: (entry: MCPEntry) => void;
  onExplore?: () => void;
}

function InstalledPane({
  kind, query, setQuery, items, cols, onToggle, onRemove, onExplore,
}: InstalledPaneProps) {
  const placeholder = kind === 'builtin'
    ? 'Filter bundled MCPs…'
    : 'Filter custom MCPs…';

  const emptyTitle = kind === 'builtin'
    ? (query ? 'No bundled MCPs match' : 'No bundled MCPs loaded')
    : (query ? 'No custom MCPs match' : 'No custom MCPs yet');

  const emptyMessage = kind === 'builtin'
    ? 'Builtins are seeded on every agent boot. If you see this, the bootstrap did not run — check the gateway logs.'
    : 'Install one from the marketplace, or add a custom server directly via the gateway API.';

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.searchBox}>
        <Feather name="search" size={13} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
      </View>

      {items.length === 0 ? (
        <EmptyState
          icon={kind === 'builtin' ? 'package' : 'sliders'}
          title={emptyTitle}
          message={emptyMessage}
          primary={
            kind === 'custom' && onExplore && !query
              ? { label: 'Browse marketplace', icon: 'compass', onPress: onExplore }
              : undefined
          }
        />
      ) : (
        <Grid cols={cols}>
          {items.map((entry) => (
            <McpTile
              key={entry.name}
              entry={entry}
              onToggle={() => onToggle(entry)}
              onRemove={onRemove ? () => onRemove(entry) : undefined}
            />
          ))}
        </Grid>
      )}
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Marketplace pane
// ───────────────────────────────────────────────────────────────────────

interface MarketplacePaneProps {
  query: string;
  setQuery: (v: string) => void;
  loading: boolean;
  error: string | null;
  results: MarketplaceCard[];
  cursor?: string;
  cols: number;
  installedNames: Set<string>;
  onInstallClick: (card: MarketplaceCard) => void;
  onLoadMore: () => void;
}

function MarketplacePane({
  query, setQuery, loading, error, results, cursor, cols,
  installedNames, onInstallClick, onLoadMore,
}: MarketplacePaneProps) {
  return (
    <View style={{ gap: 14 }}>
      <View style={[styles.searchBox, styles.searchBoxLarge]}>
        <Feather name="search" size={15} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search the MCP registry — try 'github', 'sqlite', 'browser'"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.searchInput, { fontSize: 14 }]}
        />
        {loading && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      <View style={styles.previewRibbon}>
        <Feather name="info" size={10} color={colors.textMuted} />
        <Text style={styles.previewRibbonText}>
          Preview registry — occasional outages expected —{' '}
          <Text style={styles.previewRibbonDomain}>registry.modelcontextprotocol.io</Text>
        </Text>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Feather name="alert-circle" size={13} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {results.length === 0 && !loading && !error ? (
        <EmptyState
          icon="compass"
          title={query ? 'Nothing matches' : 'Type to start searching'}
          message={query
            ? 'Try a shorter or more general term.'
            : 'The registry holds every publicly-listed Model Context Protocol server.'}
        />
      ) : (
        <Grid cols={cols}>
          {results.map((card) => (
            <MarketplaceTile
              key={`${card.name}@${card.version || 'latest'}`}
              card={card}
              installed={installedNames.has(card.name)}
              onInstall={() => onInstallClick(card)}
            />
          ))}
        </Grid>
      )}

      {cursor && !loading && (
        <View style={styles.loadMore}>
          <Button
            variant="ghost"
            size="sm"
            label="Load more results"
            icon="chevron-down"
            onPress={onLoadMore}
          />
        </View>
      )}
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Small building blocks
// ───────────────────────────────────────────────────────────────────────

function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  // `basis` is the exact percentage width; `maxWidth` prevents a single
  // last row orphan from stretching to full width.
  const gap = 14;
  const nodes = Array.isArray(children) ? children : [children];
  const basis = `${100 / cols}%` as `${number}%`;
  return (
    <View style={[gridStyles.grid, { gap }]}>
      {nodes.map((child, i) => (
        <View
          key={i}
          style={[gridStyles.cell, { flexBasis: basis, maxWidth: basis }]}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

function EmptyState({
  icon, title, message, primary, secondary,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  message: string;
  primary?: { label: string; icon?: keyof typeof Feather.glyphMap; onPress: () => void };
  secondary?: { label: string; icon?: keyof typeof Feather.glyphMap; onPress: () => void };
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Feather name={icon} size={20} color={colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {(primary || secondary) && (
        <View style={styles.emptyActions}>
          {secondary && (
            <Button variant="secondary" size="sm" label={secondary.label} icon={secondary.icon} onPress={secondary.onPress} />
          )}
          {primary && (
            <Button variant="primary" size="sm" label={primary.label} icon={primary.icon} onPress={primary.onPress} />
          )}
        </View>
      )}
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Styles — match existing screen conventions (model.tsx / tasks.tsx):
//   title: fontSize 20, weight 500, font.display, letterSpacing -0.4
//   hint:  fontSize 12-13, textMuted, lineHeight 18
// ───────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 24,
    maxWidth: 1400,
    width: '100%',
    alignSelf: 'center',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 20, fontWeight: '500', color: colors.text,
    marginBottom: 4,
    fontFamily: font.display, letterSpacing: -0.4,
  },
  hint: {
    fontSize: 12.5, color: colors.textMuted, lineHeight: 18,
    maxWidth: 640,
  },

  tabsRow: { marginBottom: 16 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 12,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.errorSoft,
    borderWidth: 1, borderColor: colors.errorBorder,
    borderRadius: radius.md,
  },
  errorText: { color: colors.error, fontSize: 12, flex: 1 },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    borderWidth: 1, borderColor: colors.border,
  },
  searchBoxLarge: {
    paddingVertical: 11, paddingHorizontal: 14,
    borderRadius: radius.lg,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontFamily: font.sans,
    paddingVertical: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },

  previewRibbon: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 2, marginTop: -6,
  },
  previewRibbonText: {
    fontSize: 10.5, color: colors.textMuted, fontFamily: font.sans,
  },
  previewRibbonDomain: {
    fontFamily: font.mono, color: colors.textSecondary,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: 56,
    gap: 10,
  },
  emptyIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.sidebar,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  emptyTitle: {
    fontSize: 15, color: colors.text, fontWeight: '500',
    fontFamily: font.display, letterSpacing: -0.2,
    marginTop: 2,
  },
  emptyMessage: {
    fontSize: 12.5, color: colors.textMuted,
    textAlign: 'center', maxWidth: 420, lineHeight: 18,
  },
  emptyActions: { flexDirection: 'row', gap: 8, marginTop: 8 },

  loadMore: { alignItems: 'center', marginTop: 6 },
});

const gridStyles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
  },
  cell: { flexGrow: 1, flexShrink: 0 },
});
