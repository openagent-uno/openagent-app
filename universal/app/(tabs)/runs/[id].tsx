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
import { colors, radius } from '../../../theme';
import { RunDetailView } from '../../../components/RunDetailView';
import { useHeaderInset, HeaderRight } from '../../../components/screenHeader';
import PopupMenu from '../../../components/PopupMenu';
import { NO_DRAG } from '../../../components/DragRegion';
import { useConnection } from '../../../stores/connection';
import { useUI } from '../../../stores/ui';
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
  const contextPanelVisible = useUI((s) => s.contextPanelVisible);
  const toggleContextPanel = useUI((s) => s.toggleContextPanel);

  useEffect(() => {
    if (!connConfig) return;
    if (connConfig.sidecarPort) setBaseUrl('127.0.0.1', connConfig.sidecarPort);
  }, [connConfig]);

  useLayoutEffect(() => {
    // Screen-name title by run kind (homogeneous; not the parent's name).
    navigation.setOptions({
      title:
        kind === 'workflow' ? 'Workflow run'
          : kind === 'event' ? 'Event delivery'
            : 'Scheduled run',
      // A scheduled firing renders its session's context panel (RunDetailView
      // → TaskBody); expose the same show/hide toggle as the chat header so it
      // can be dismissed here too. Workflow runs surface the panel only once a
      // node's session is opened (on the chat screen, which has its own toggle).
      headerRight:
        kind === 'workflow'
          ? undefined
          : () => (
              <HeaderRight>
                <PopupMenu
                  triggerIcon="more-vertical"
                  triggerSize={18}
                  triggerColor={colors.textSecondary}
                  // NO_DRAG is required: the desktop header is a window-drag
                  // region that otherwise swallows the click (why the button
                  // wasn't tappable). Mirrors the chat screen's trigger.
                  triggerStyle={[styles.headerMenuBtn, NO_DRAG]}
                  accessibilityLabel="Run options"
                  items={[
                    {
                      label: contextPanelVisible ? 'Hide context panel' : 'Show context panel',
                      icon: 'pie-chart',
                      onPress: toggleContextPanel,
                    },
                  ]}
                />
              </HeaderRight>
            ),
    });
  }, [navigation, kind, contextPanelVisible, toggleContextPanel]);

  const ready = connConfig && id && parentId;

  return (
    <View style={[styles.screen, { paddingTop: headerInset }]}>
      {/* Wait for the connection to resume before mounting the content:
          a fresh window's REST base URL isn't set until ``_openWebsocket``
          runs (it calls setBaseUrl right before populating ``config``), and
          the content fetches on mount. */}
      {ready ? (
        <RunDetailView
          kind={kind === 'workflow' ? 'workflow' : kind === 'event' ? 'event' : 'task'}
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
  headerMenuBtn: {
    width: 34, height: 34,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md,
  },
});
