/**
 * Scheduled-task run-history screen — /tasks/runs/{id}.
 *
 * The detached run-history view for a scheduled task: opened in its own
 * desktop window or pushed full-screen on web / native. Renders the
 * shared ``TaskRunHistoryContent`` under a ``DetachedHeader`` whose
 * back control closes the window (desktop) or pops the stack.
 *
 * Each desktop window is its own renderer, so the API base URL is set
 * from the resumed connection and the task name fetched for the header
 * subtitle.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '../../../../theme';
import DetachedHeader from '../../../../components/DetachedHeader';
import { TaskRunHistoryContent } from '../../../../components/TaskRunHistoryContent';
import { useConnection } from '../../../../stores/connection';
import { setBaseUrl, getScheduledTask } from '../../../../services/api';
import { closeDetached } from '../../../../services/windows';

export default function TaskRunsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const connConfig = useConnection((s) => s.config);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!connConfig) return;
    if (connConfig.sidecarPort) setBaseUrl('127.0.0.1', connConfig.sidecarPort);
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await getScheduledTask(id);
        if (!cancelled) setName(t?.name ?? null);
      } catch {
        /* the subtitle is optional — leave it blank on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connConfig, id]);

  return (
    <View style={styles.screen}>
      <DetachedHeader
        title="Run history"
        subtitle={name ?? undefined}
        onClose={() => closeDetached(router)}
      />
      {/* Wait for the connection to resume before mounting the content:
          a fresh desktop window's REST base URL isn't set until
          ``_openWebsocket`` runs (it calls setBaseUrl right before
          populating ``config``), and the content fetches on mount. */}
      {connConfig && id ? (
        <TaskRunHistoryContent taskId={id} />
      ) : (
        <View style={styles.statusPane}>
          <ActivityIndicator size="small" color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  statusPane: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
