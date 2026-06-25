/**
 * Memory — graph dashboard (stack root).
 *
 * Wide: fixed file-tree sidebar + graph. Narrow: drawer sidebar + graph.
 * Tapping a note (sidebar or graph node) pushes ``[...path]`` onto the
 * Memory Stack, which hosts the editor. ``router.push`` keeps ``index``
 * on the stack so the editor's back button pops cleanly via
 * ``StackActions.popTo('index')`` — same pattern as MCPs / Workflows.
 */

import { useEffect, useLayoutEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import GraphView from '../../../components/GraphView';
import ResponsiveSidebar from '../../../components/ResponsiveSidebar';
import VaultSidebar from '../../../components/memory/VaultSidebar';
import { HeaderAction } from '../../../components/screenHeader';
import { useConnection } from '../../../stores/connection';
import { useEvents } from '../../../stores/events';
import { useVault } from '../../../stores/vault';
import { setBaseUrl } from '../../../services/api';
import { colors } from '../../../theme';

export default function MemoryGraphScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const config = useConnection((s) => s.config);
  const { graph, loading, loadNotes, loadGraph } = useVault();

  useEffect(() => {
    if (config) {
      if (config.sidecarPort) setBaseUrl('127.0.0.1', config.sidecarPort);
      loadNotes();
      loadGraph();
    }
  }, [config]);

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

  // Vault-history action in the nav header's right slot (was a custom
  // in-content bar). Back/title come from the navigator (title 'Memory').
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <HeaderAction icon="clock" label="History" onPress={openHistory} />,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  return (
    <ResponsiveSidebar sidebar={<VaultSidebar selectedPath={null} onSelectNote={openNote} />}>
      <View style={styles.mainArea}>
        {graph && graph.nodes.length > 0 ? (
          <GraphView data={graph} onSelectNode={openNote} />
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

const styles = StyleSheet.create({
  mainArea: { flex: 1 },
  graphEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 12, padding: 14 },
});
