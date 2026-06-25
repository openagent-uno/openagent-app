/**
 * Single-run detail screen — /runs/{id}?kind=…&parentId=…
 *
 * Opened from the sidebar's Recent feed when the user taps one specific
 * firing. Unlike /tasks/runs/{id} and /workflows/runs/{id} (which list a
 * parent's *whole* execution history), this shows just the one run the
 * row referred to.
 *
 * ``kind`` selects the body (workflow trace vs. task firing) and
 * ``parentId`` is the owning workflow / task id the run belongs to. Each
 * window is its own renderer, so the API base URL is set from the resumed
 * connection before the content fetches.
 */

import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '../../../theme';
import { RunDetailView } from '../../../components/RunDetailView';
import { useHeaderInset } from '../../../components/screenHeader';
import { useConnection } from '../../../stores/connection';
import { setBaseUrl } from '../../../services/api';

export default function RunDetailScreen() {
  const { id, kind, parentId, name } = useLocalSearchParams<{
    id: string;
    kind: string;
    parentId: string;
    name?: string;
  }>();
  const navigation = useNavigation();
  const headerInset = useHeaderInset();
  const connConfig = useConnection((s) => s.config);

  useEffect(() => {
    if (!connConfig) return;
    if (connConfig.sidecarPort) setBaseUrl('127.0.0.1', connConfig.sidecarPort);
  }, [connConfig]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: name || 'Run detail' });
  }, [navigation, name]);

  const ready = connConfig && id && parentId;

  return (
    <View style={[styles.screen, { paddingTop: headerInset }]}>
      {/* Wait for the connection to resume before mounting the content:
          a fresh window's REST base URL isn't set until ``_openWebsocket``
          runs (it calls setBaseUrl right before populating ``config``), and
          the content fetches on mount. */}
      {ready ? (
        <RunDetailView
          kind={kind === 'workflow' ? 'workflow' : 'task'}
          parentId={parentId}
          runId={id}
          name={name}
        />
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
