/**
 * MarketplaceBrowser — search and install MCP servers from the official
 * registry (registry.modelcontextprotocol.io) via the gateway proxy.
 *
 * Mounted inline inside the MCPs screen "Custom" tab. Two modes:
 *
 *   1. Search:  query input + scrollable result cards.
 *   2. Install: chosen server with package/remote chooser and form fields
 *               for any required env vars / headers / {placeholders}.
 *
 * The gateway does the schema mapping (server.json → mcps row), so this
 * component only needs to render the synthesised ``requirements`` shape and
 * pass user inputs back. On install success, ``onInstalled`` lets the
 * parent screen refresh its list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, font, radius } from '../theme';
import Button from './Button';
import Card from './Card';
import {
  searchMcpMarketplace,
  getMarketplaceServer,
  installFromMarketplace,
  type MarketplaceCard,
  type MarketplaceServerDetail,
  type MarketplacePackage,
  type MarketplaceRemote,
  type MarketplaceField,
  type MarketplaceInstallError,
} from '../services/api';

interface Props {
  onInstalled: () => void;
  onClose: () => void;
}

type Mode =
  | { kind: 'search' }
  | { kind: 'install'; server: MarketplaceCard; detail: MarketplaceServerDetail };

const SEARCH_DEBOUNCE_MS = 300;

function defaultInstallName(registryName: string): string {
  if (!registryName) return 'mcp-marketplace';
  const tail = registryName.split('/').pop() || registryName;
  const slug = tail.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'mcp-marketplace';
}

export default function MarketplaceBrowser({ onInstalled, onClose }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'search' });

  // ── Search state ──
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MarketplaceCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Install-form state ──
  const [pickerKind, setPickerKind] = useState<'package' | 'remote'>('package');
  const [pickerIndex, setPickerIndex] = useState(0);
  const [installName, setInstallName] = useState('');
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [headerValues, setHeaderValues] = useState<Record<string, string>>({});
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);

  // ── Search debounce ──
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSearch = useCallback(async (q: string, cursor?: string, append = false) => {
    setSearching(true);
    setSearchError(null);
    try {
      const data = await searchMcpMarketplace(q, cursor, 30);
      setResults((prev) => (append ? [...prev, ...data.servers] : data.servers));
      setNextCursor(data.nextCursor);
    } catch (e: any) {
      setSearchError(e?.message || String(e));
      if (!append) setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (mode.kind !== 'search') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode.kind, runSearch]);

  // ── Selection ──
  const openInstall = useCallback(async (card: MarketplaceCard) => {
    setInstalling(false);
    setInstallError(null);
    setSuggestedName(null);
    try {
      const detail = await getMarketplaceServer(card.name, card.version || 'latest');
      const hasPackage = detail.requirements.packages.length > 0;
      const hasRemote = detail.requirements.remotes.length > 0;
      const initialKind: 'package' | 'remote' = hasPackage ? 'package' : 'remote';
      setMode({ kind: 'install', server: card, detail });
      setPickerKind(initialKind);
      setPickerIndex(0);
      setInstallName(defaultInstallName(card.name));
      // Pre-fill env/header defaults so the form starts in a "ready" state
      // for one-click installs.
      const envInit: Record<string, string> = {};
      const headerInit: Record<string, string> = {};
      if (hasPackage) {
        for (const f of detail.requirements.packages[0].env_required) {
          if (f.default) envInit[f.name] = f.default;
        }
      } else if (hasRemote) {
        for (const f of detail.requirements.remotes[0].header_required) {
          if (f.default) headerInit[f.name] = f.default;
        }
      }
      setEnvValues(envInit);
      setHeaderValues(headerInit);
      setPlaceholderValues({});
    } catch (e: any) {
      setSearchError(e?.message || String(e));
    }
  }, []);

  // When the user changes which package/remote they're installing, reset
  // the per-package field defaults so secrets don't bleed across choices.
  useEffect(() => {
    if (mode.kind !== 'install') return;
    const env: Record<string, string> = {};
    const headers: Record<string, string> = {};
    if (pickerKind === 'package') {
      const pkg = mode.detail.requirements.packages[pickerIndex];
      if (pkg) for (const f of pkg.env_required) if (f.default) env[f.name] = f.default;
    } else {
      const remote = mode.detail.requirements.remotes[pickerIndex];
      if (remote) for (const f of remote.header_required) if (f.default) headers[f.name] = f.default;
    }
    setEnvValues(env);
    setHeaderValues(headers);
    setPlaceholderValues({});
  }, [pickerKind, pickerIndex, mode]);

  const currentPackage: MarketplacePackage | null = useMemo(() => {
    if (mode.kind !== 'install' || pickerKind !== 'package') return null;
    return mode.detail.requirements.packages[pickerIndex] ?? null;
  }, [mode, pickerKind, pickerIndex]);

  const currentRemote: MarketplaceRemote | null = useMemo(() => {
    if (mode.kind !== 'install' || pickerKind !== 'remote') return null;
    return mode.detail.requirements.remotes[pickerIndex] ?? null;
  }, [mode, pickerKind, pickerIndex]);

  const currentPlaceholders = useMemo(() => {
    if (currentPackage) return currentPackage.placeholders;
    if (currentRemote) return currentRemote.placeholders;
    return [];
  }, [currentPackage, currentRemote]);

  const doInstall = async () => {
    if (mode.kind !== 'install') return;
    setInstalling(true);
    setInstallError(null);
    setSuggestedName(null);
    try {
      const mcp = await installFromMarketplace({
        name: mode.server.name,
        version: mode.server.version || 'latest',
        choice: { kind: pickerKind, index: pickerIndex },
        install_name: installName.trim() || undefined,
        env: envValues,
        headers: headerValues,
        placeholders: placeholderValues,
      });
      // Success — bubble up and reset to search.
      onInstalled();
      setMode({ kind: 'search' });
    } catch (e: any) {
      const err = e as MarketplaceInstallError | Error;
      if ((err as MarketplaceInstallError).status === 409) {
        const me = err as MarketplaceInstallError;
        setInstallError(me.error);
        if (me.suggested_name) setSuggestedName(me.suggested_name);
      } else {
        setInstallError(((err as MarketplaceInstallError).error) || (err as Error).message || String(err));
      }
    } finally {
      setInstalling(false);
    }
  };

  // ── Render: install form ──
  if (mode.kind === 'install') {
    const server = mode.server;
    const detail = mode.detail;
    const packages = detail.requirements.packages;
    const remotes = detail.requirements.remotes;

    return (
      <Card padded={false} style={styles.panel}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{server.title || server.name}</Text>
            <Text style={styles.headerSub}>
              {server.name}{server.version ? `  ·  v${server.version}` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setMode({ kind: 'search' })}>
            <Feather name="x" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {server.description && (
          <Text style={styles.description}>{server.description}</Text>
        )}

        {(packages.length + remotes.length) > 1 && (
          <View style={styles.tabRow}>
            {packages.length > 0 && (
              <PickerTab
                label={`Local (${packages.length})`}
                active={pickerKind === 'package'}
                onPress={() => { setPickerKind('package'); setPickerIndex(0); }}
              />
            )}
            {remotes.length > 0 && (
              <PickerTab
                label={`Remote (${remotes.length})`}
                active={pickerKind === 'remote'}
                onPress={() => { setPickerKind('remote'); setPickerIndex(0); }}
              />
            )}
          </View>
        )}

        {pickerKind === 'package' && packages.length > 1 && (
          <PackagePicker
            packages={packages}
            selected={pickerIndex}
            onSelect={setPickerIndex}
          />
        )}
        {pickerKind === 'remote' && remotes.length > 1 && (
          <RemotePicker
            remotes={remotes}
            selected={pickerIndex}
            onSelect={setPickerIndex}
          />
        )}

        {currentPackage && (
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Runtime</Text>
            <Text style={styles.metaValue}>
              {currentPackage.runtime}
              {currentPackage.identifier ? `  ·  ${currentPackage.identifier}` : ''}
              {currentPackage.version ? `@${currentPackage.version}` : ''}
            </Text>
            {!currentPackage.supported && (
              <Text style={styles.warn}>
                Unsupported runtime — install will fail. Try a different package or runtime.
              </Text>
            )}
          </View>
        )}
        {currentRemote && (
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Endpoint</Text>
            <Text style={styles.metaValue}>{currentRemote.url}</Text>
          </View>
        )}

        {/* Env vars (packages) or headers (remotes). */}
        {currentPackage && currentPackage.env_required.length > 0 && (
          <FieldList
            title="Environment variables"
            fields={currentPackage.env_required}
            values={envValues}
            onChange={(name, v) => setEnvValues((prev) => ({ ...prev, [name]: v }))}
          />
        )}
        {currentRemote && currentRemote.header_required.length > 0 && (
          <FieldList
            title="HTTP headers"
            fields={currentRemote.header_required}
            values={headerValues}
            onChange={(name, v) => setHeaderValues((prev) => ({ ...prev, [name]: v }))}
          />
        )}

        {currentPlaceholders.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Placeholders</Text>
            {currentPlaceholders.map((ph) => (
              <View key={ph.token} style={styles.fieldRow}>
                <Text style={styles.fieldName}>{`{${ph.token}}`}</Text>
                {ph.description && <Text style={styles.fieldDesc}>{ph.description}</Text>}
                <TextInput
                  style={styles.input}
                  value={placeholderValues[ph.token] || ''}
                  onChangeText={(v) => setPlaceholderValues((prev) => ({ ...prev, [ph.token]: v }))}
                  placeholder={`Value for {${ph.token}}`}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Install name</Text>
          <TextInput
            style={styles.input}
            value={installName}
            onChangeText={setInstallName}
            placeholder={defaultInstallName(server.name)}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {suggestedName && (
            <TouchableOpacity
              onPress={() => { setInstallName(suggestedName); setSuggestedName(null); setInstallError(null); }}
              style={styles.suggestionChip}
            >
              <Feather name="corner-down-right" size={11} color={colors.primary} />
              <Text style={styles.suggestionText}>Use suggested: {suggestedName}</Text>
            </TouchableOpacity>
          )}
        </View>

        {installError && <Text style={styles.error}>{installError}</Text>}

        <View style={styles.footer}>
          <Button variant="ghost" size="sm" label="Back" onPress={() => setMode({ kind: 'search' })} />
          <Button
            variant="primary"
            size="sm"
            label={installing ? 'Installing…' : 'Install'}
            icon="download"
            onPress={doInstall}
            disabled={installing || (currentPackage ? !currentPackage.supported : false)}
          />
        </View>
      </Card>
    );
  }

  // ── Render: search ──
  return (
    <Card padded={false} style={styles.panel}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Browse marketplace</Text>
          <Text style={styles.headerSub}>
            registry.modelcontextprotocol.io · preview registry, occasional outages possible
          </Text>
        </View>
        <TouchableOpacity onPress={onClose}>
          <Feather name="x" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <Feather name="search" size={13} color={colors.textMuted} style={{ marginRight: 6 }} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search MCP servers (e.g. github, filesystem, postgres)"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searching && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {searchError && <Text style={styles.error}>{searchError}</Text>}

      <ScrollView style={styles.results} contentContainerStyle={{ paddingBottom: 6 }}>
        {!searching && results.length === 0 && !searchError && (
          <Text style={styles.emptyText}>
            {query ? 'No matching servers.' : 'Type to search the marketplace.'}
          </Text>
        )}
        {results.map((card) => (
          <View key={`${card.name}@${card.version || 'latest'}`} style={styles.resultRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.resultName}>{card.title || card.name}</Text>
              <Text style={styles.resultMeta}>
                {card.name}{card.version ? `  ·  v${card.version}` : ''}
              </Text>
              {card.description && (
                <Text style={styles.resultDesc} numberOfLines={2}>{card.description}</Text>
              )}
            </View>
            <Button
              variant="secondary"
              size="xs"
              label="Select"
              icon="chevron-right"
              iconPosition="right"
              onPress={() => openInstall(card)}
            />
          </View>
        ))}
        {nextCursor && !searching && (
          <View style={styles.loadMoreWrap}>
            <Button
              variant="ghost"
              size="xs"
              label="Load more"
              onPress={() => runSearch(query.trim(), nextCursor, true)}
            />
          </View>
        )}
      </ScrollView>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────

function PickerTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PackagePicker({
  packages, selected, onSelect,
}: { packages: MarketplacePackage[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <View style={styles.subPickerRow}>
      {packages.map((p, i) => (
        <TouchableOpacity
          key={`pkg-${i}`}
          style={[styles.chip, selected === i && styles.chipActive, !p.supported && styles.chipMuted]}
          onPress={() => onSelect(i)}
        >
          <Text style={[styles.chipLabel, selected === i && styles.chipLabelActive]}>
            {p.runtime}{p.version ? ` ${p.version}` : ''}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function RemotePicker({
  remotes, selected, onSelect,
}: { remotes: MarketplaceRemote[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <View style={styles.subPickerRow}>
      {remotes.map((r, i) => (
        <TouchableOpacity
          key={`rem-${i}`}
          style={[styles.chip, selected === i && styles.chipActive]}
          onPress={() => onSelect(i)}
        >
          <Text style={[styles.chipLabel, selected === i && styles.chipLabelActive]}>
            {r.transport || 'http'} #{i + 1}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function FieldList({
  title, fields, values, onChange,
}: {
  title: string;
  fields: MarketplaceField[];
  values: Record<string, string>;
  onChange: (name: string, v: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {fields.map((f) => (
        <View key={f.name} style={styles.fieldRow}>
          <View style={styles.fieldHeaderRow}>
            <Text style={styles.fieldName}>{f.name}</Text>
            {f.isRequired && <Text style={styles.requiredBadge}>required</Text>}
            {f.isSecret && <Text style={styles.secretBadge}>secret</Text>}
          </View>
          {f.description && <Text style={styles.fieldDesc}>{f.description}</Text>}
          <TextInput
            style={styles.input}
            value={values[f.name] || ''}
            onChangeText={(v) => onChange(f.name, v)}
            placeholder={f.default || (f.isSecret ? '••••••••' : f.value_template || `Set ${f.name}`)}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={f.isSecret}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginBottom: 12, padding: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  headerTitle: {
    fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: font.display,
  },
  headerSub: {
    fontSize: 11, color: colors.textMuted, marginTop: 2,
  },
  description: {
    fontSize: 12, color: colors.textSecondary, lineHeight: 17, marginBottom: 10,
  },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  searchInput: {
    flex: 1, color: colors.text, fontSize: 13, paddingVertical: 4, fontFamily: font.sans,
  },
  results: { maxHeight: 360, marginTop: 8 },
  emptyText: {
    fontSize: 12, color: colors.textMuted, textAlign: 'center',
    paddingVertical: 18,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  resultName: { fontSize: 13, fontWeight: '500', color: colors.text },
  resultMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1, fontFamily: font.mono },
  resultDesc: { fontSize: 11.5, color: colors.textSecondary, marginTop: 4, lineHeight: 16 },
  loadMoreWrap: { alignItems: 'center', paddingTop: 10 },

  // Install panel
  tabRow: { flexDirection: 'row', gap: 4, marginBottom: 8 },
  tab: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.primarySoft, borderColor: colors.primary,
  },
  tabLabel: { fontSize: 11.5, color: colors.textSecondary },
  tabLabelActive: { color: colors.primary, fontWeight: '600' },

  subPickerRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.inputBg,
  },
  chipActive: {
    backgroundColor: colors.primarySoft, borderColor: colors.primary,
  },
  chipMuted: { opacity: 0.6 },
  chipLabel: { fontSize: 11, color: colors.textSecondary, fontFamily: font.mono },
  chipLabelActive: { color: colors.primary, fontWeight: '600' },

  metaBlock: { marginBottom: 10 },
  metaLabel: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3,
  },
  metaValue: { fontSize: 12, color: colors.text, fontFamily: font.mono },
  warn: { fontSize: 11, color: colors.warning, marginTop: 4 },

  section: { marginTop: 4, marginBottom: 8 },
  sectionLabel: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  fieldRow: { marginBottom: 8 },
  fieldHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  fieldName: { fontSize: 12, color: colors.text, fontFamily: font.mono, fontWeight: '500' },
  fieldDesc: { fontSize: 11, color: colors.textMuted, marginBottom: 4, lineHeight: 15 },
  requiredBadge: {
    fontSize: 9, color: colors.error, backgroundColor: colors.errorSoft,
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: radius.xs,
    fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4,
  },
  secretBadge: {
    fontSize: 9, color: colors.textMuted, backgroundColor: colors.mutedSoft,
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: radius.xs,
    fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 10, paddingVertical: 8,
    color: colors.text, fontSize: 12, fontFamily: font.mono,
  },

  suggestionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 6, alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: colors.primarySoft, borderRadius: radius.sm,
  },
  suggestionText: { fontSize: 11, color: colors.primary, fontFamily: font.mono },

  error: {
    fontSize: 11.5, color: colors.error,
    backgroundColor: colors.errorSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 6,
    marginTop: 6, marginBottom: 4,
  },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 6,
  },
});
