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

import { useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '../../../theme';
import { RunDetailView } from '../../../components/RunDetailView';
import {
  useHeaderInset,
  HeaderRight,
  HeaderSessionDetails,
} from '../../../components/screenHeader';
import { useConnection } from '../../../stores/connection';
import {
  useSessionDetailsDrawer,
  type SessionDetailsRunKind,
} from '../../../stores/sessionDetailsDrawer';
import { setBaseUrl } from '../../../services/api';

export default function RunDetailScreen() {
  const { id, kind, parentId, name, traceStep, message, toolInvocation, session } = useLocalSearchParams<{
    id: string;
    kind: string;
    parentId: string;
    name?: string;
    traceStep?: string;
    message?: string;
    toolInvocation?: string;
    session?: string;
  }>();
  const navigation = useNavigation();
  const headerInset = useHeaderInset();
  const connConfig = useConnection((s) => s.config);
  const setRunTarget = useSessionDetailsDrawer((state) => state.setRunTarget);
  const clearRunTarget = useSessionDetailsDrawer((state) => state.clearRunTarget);
  const closeSessionDetails = useSessionDetailsDrawer((state) => state.requestClose);
  const runKind: SessionDetailsRunKind = kind === 'workflow'
    ? 'workflow'
    : kind === 'event'
      ? 'event'
      : 'task';

  useEffect(() => {
    if (!connConfig) return;
    if (connConfig.sidecarPort) setBaseUrl('127.0.0.1', connConfig.sidecarPort);
  }, [connConfig]);

  // The right drawer sits outside the expo-router tree, so publish the focused
  // run's real route identity through the tiny drawer bridge. Focus-scoping is
  // important: drawer-root stacks remain mounted/frozen when another section
  // is opened and must not leave a stale run selected behind the chat screen.
  useFocusEffect(useCallback(() => {
    if (!id) return undefined;
    setRunTarget({
      kind: runKind,
      runId: id,
      parentId: parentId || undefined,
      name: name || undefined,
      sessionId: session || undefined,
    });
    return () => {
      clearRunTarget(id);
      closeSessionDetails();
    };
  }, [clearRunTarget, closeSessionDetails, id, name, parentId, runKind, session, setRunTarget]));

  useLayoutEffect(() => {
    // Screen-name title by run kind (homogeneous; not the parent's name).
    navigation.setOptions({
      title:
        kind === 'workflow' ? 'Workflow run'
          : kind === 'event' ? 'Event delivery'
            : 'Scheduled run',
      headerRight: () => (
        <HeaderRight>
          <HeaderSessionDetails />
        </HeaderRight>
      ),
    });
  }, [navigation, kind]);

  // Every detail resolver is keyed by the opaque run id. ``parentId`` is a
  // navigation hint, not a loading prerequisite: event-downstream links and
  // older deep links may omit it, and the resolved record supplies it later.
  const ready = connConfig && id;

  return (
    <View style={[styles.screen, { paddingTop: headerInset }]}>
      {/* Wait for the connection to resume before mounting the content:
          a fresh window's REST base URL isn't set until ``_openWebsocket``
          runs (it calls setBaseUrl right before populating ``config``), and
          the content fetches on mount. */}
      {ready ? (
        <RunDetailView
          kind={kind === 'workflow' ? 'workflow' : kind === 'event' ? 'event' : 'task'}
          parentId={parentId || ''}
          runId={id}
          name={name}
          traceStepId={traceStep}
          messageId={message}
          toolInvocationId={toolInvocation}
          targetSessionId={session}
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
