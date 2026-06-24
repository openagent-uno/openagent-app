/**
 * Memory — vault-wide git history. Pushed onto the Memory Stack.
 *
 * Lists the vault's git log newest-first: each commit shows its subject,
 * a relative date, the short hash, and a provenance chip (origin +
 * session / workflow / task when the agent stamped them). Subscribes to
 * the ``'vault'`` resource-event channel so it refetches live whenever
 * the agent (or another tab) writes a note — mirrors ``memory/index``.
 *
 * Per-note history lives at ``memory/history/[...path]`` — same body,
 * scoped to one note via ``getVaultHistory(path)``.
 */

import { useEffect, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import type { VaultCommit } from '../../../../common/types';
import { useConnection } from '../../../stores/connection';
import { useEvents } from '../../../stores/events';
import { getVaultHistory, setBaseUrl } from '../../../services/api';
import { colors, font, radius } from '../../../theme';

// Relative-age label from an ISO date string (mirror ``fmtAge`` in
// MembersPanel, which works off epoch seconds).
function fmtSince(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = Math.max(0, (Date.now() - t) / 1000);
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// Compact provenance label — origin first, then whichever of
// session / workflow / task is present. Keeps the chip short.
function provenanceLabel(p: Record<string, string>): string {
  const parts: string[] = [];
  if (p.origin) parts.push(p.origin);
  for (const k of ['workflow', 'task', 'session'] as const) {
    if (p[k]) {
      parts.push(`${k}:${p[k].slice(0, 8)}`);
      break;
    }
  }
  return parts.join(' · ');
}

export function HistoryList({ path }: { path?: string }) {
  const config = useConnection((s) => s.config);
  const [commits, setCommits] = useState<VaultCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    if (config.sidecarPort) setBaseUrl('127.0.0.1', config.sidecarPort);
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getVaultHistory(path, 100);
        if (!cancelled) {
          setCommits(res.commits ?? []);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    // Live-refresh on vault writes — same channel the graph screen uses.
    const unsub = useEvents.getState().subscribe('vault', () => void load());
    return () => {
      cancelled = true;
      unsub();
    };
  }, [config, path]);

  if (loading && commits.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Loading history…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (commits.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No commits yet</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {commits.map((c) => {
        const prov = provenanceLabel(c.provenance ?? {});
        return (
          <View key={c.hash} style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.subject} numberOfLines={2}>{c.subject}</Text>
              <Text style={styles.hash}>{c.hash.slice(0, 7)}</Text>
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.metaText}>{fmtSince(c.date)}</Text>
              {c.author ? <Text style={styles.metaText}> · {c.author}</Text> : null}
              {prov ? (
                <View style={styles.provChip}>
                  <Text style={styles.provChipText}>{prov}</Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

export default function VaultHistoryScreen() {
  const navigation = useNavigation();

  // Back to the graph root — same ``popTo('index')`` pattern as the
  // editor (``router.back()`` would bubble to the Tabs navigator).
  const backToGraph = () => navigation.dispatch(StackActions.popTo('index'));

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={backToGraph} style={styles.backBtn}>
          <View style={styles.backBtnContent}>
            <Feather name="arrow-left" size={14} color={colors.primary} />
            <Text style={styles.backBtnText}>Graph</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>Vault history</Text>
      </View>
      <HistoryList />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  backBtn: { paddingVertical: 4, paddingHorizontal: 6, marginRight: 10 },
  backBtnContent: { flexDirection: 'row', alignItems: 'center' },
  backBtnText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500', marginLeft: 5 },
  title: {
    fontSize: 14, fontWeight: '500', color: colors.text, flex: 1,
    fontFamily: font.display, letterSpacing: -0.2,
  },
  list: { flex: 1 },
  listContent: { padding: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: {
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  subject: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '500', lineHeight: 18 },
  hash: {
    fontSize: 10, color: colors.textMuted, fontFamily: font.mono,
    marginTop: 2,
  },
  rowMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  metaText: { fontSize: 10.5, color: colors.textMuted, fontFamily: font.mono },
  provChip: {
    marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.xs, backgroundColor: colors.mutedSoft,
  },
  provChipText: { fontSize: 9.5, color: colors.textSecondary, fontFamily: font.mono },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: colors.textMuted, fontSize: 12 },
  errorText: { color: colors.error, fontSize: 12, textAlign: 'center' },
});
