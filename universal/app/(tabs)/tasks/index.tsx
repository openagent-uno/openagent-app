/**
 * Scheduled tasks — dashboard grid.
 *
 * Tasks live in the backend SQLite database, served over
 * /api/scheduled-tasks. Changes take effect within ~30 seconds (the
 * scheduler's next tick) — no restart required.
 *
 * Laid out as a tile grid that mirrors Connectors (``mcps/index.tsx``):
 * a fixed header band with the hint, then a measured-column grid of
 * ``TaskTile``s. Column count derives from the *container's* measured
 * width (via ``onLayout``) so it stays correct when the sidebar / window
 * chrome reduces content width below the window width.
 *
 * Creating, editing, and viewing a task's run history each open a
 * *detached* view (``openDetached``): a separate window on the desktop
 * app, a pushed full-screen route on web / native. The list itself only
 * handles enable/disable and delete inline, and refetches when the
 * gateway broadcasts a ``scheduled_task`` change (including saves made
 * from a detached editor window).
 */

import Feather from '@expo/vector-icons/Feather';
import { useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { colors, radius } from '../../../theme';
import { useConnection } from '../../../stores/connection';
import { useEvents } from '../../../stores/events';
import { useTasks } from '../../../stores/tasks';
import { setBaseUrl } from '../../../services/api';
import { openDetached } from '../../../services/windows';
import { useConfirm } from '../../../components/ConfirmDialog';
import EmptyState from '../../../components/EmptyState';
import { HeaderAction, useHeaderInset } from '../../../components/screenHeader';
import TaskTile from '../../../components/tasks/TaskTile';
import { Skeleton } from '../../../components/Skeleton';
import type { ScheduledTask } from '../../../../common/types';

const CONTENT_MAX_WIDTH = 1120;
const TILE_MIN_WIDTH = 300;
const TILE_MAX_COLS = 4;
const GRID_GAP = 14;

/** Column count from the container's measured width (see mcps/index.tsx). */
function columnsForWidth(width: number, gap: number): number {
  if (width <= 0) return 1;
  const n = Math.floor((width + gap) / (TILE_MIN_WIDTH + gap));
  return Math.max(1, Math.min(TILE_MAX_COLS, n));
}

export default function TasksScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const headerInset = useHeaderInset();
  const connConfig = useConnection((s) => s.config);
  const { tasks, loaded, error, loadTasks, deleteTask, toggleTask, runTask, stopTask } = useTasks();
  const confirm = useConfirm();

  const handleAdd = useCallback(() => {
    // ``new`` is the create sentinel — caught by tasks/[id].tsx since
    // task ids are uuids and never literally "new".
    openDetached(router, 'tasks/new');
  }, [router]);

  // The "create" control lives in the navigator header (same position as
  // Workflows / Connectors).
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <HeaderAction icon="plus" label="New task" onPress={handleAdd} />,
    });
  }, [navigation, handleAdd]);

  useEffect(() => {
    if (connConfig) {
      if (connConfig.sidecarPort) setBaseUrl('127.0.0.1', connConfig.sidecarPort);
      loadTasks();
    }
  }, [connConfig]);

  // Refetch on every screen focus so re-opening the tab always shows
  // fresh data (same as Connectors). The store keeps the existing list
  // visible while the refetch is in flight — ``loaded`` never resets —
  // so no skeleton flashes after the first load.
  useFocusEffect(
    useCallback(() => {
      void loadTasks();
    }, [loadTasks]),
  );

  // Refetch on chat-driven creates, scheduler ticks, and saves from a
  // detached editor window (all arrive as ``scheduled_task`` events).
  useEffect(() => {
    return useEvents.getState().subscribe('scheduled_task', () => {
      void loadTasks();
    });
  }, [loadTasks]);

  // Container-measured width drives the column count.
  const [containerWidth, setContainerWidth] = useState(0);
  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - containerWidth) > 1) setContainerWidth(w);
  }, [containerWidth]);
  // ``bodyInner`` carries 24px horizontal padding on each side.
  const cols = useMemo(
    () => columnsForWidth(Math.max(0, containerWidth - 48), GRID_GAP),
    [containerWidth],
  );

  const handleRemove = async (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const confirmed = await confirm({
      title: 'Remove Task',
      message: `Remove task "${t.name}"?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    await deleteTask(id);
  };

  const handleEdit = (t: ScheduledTask) => {
    openDetached(router, `tasks/${t.id}`);
  };

  return (
    <View style={styles.root}>
      {error && (
        <View style={[styles.errorWrap, { paddingTop: headerInset + 16 }]}>
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={13} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        </View>
      )}

      {loaded && tasks.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No scheduled tasks yet"
          message="Schedule a recurring prompt — or ask OpenAgent to set one up for you."
          action={{ label: 'New task', icon: 'plus', onPress: handleAdd }}
        />
      ) : (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.bodyInner, { paddingTop: headerInset + 20 }]} onLayout={onContainerLayout}>
            {!loaded ? (
              <Grid cols={cols}>
                {Array.from({ length: Math.max(cols * 2, 4) }).map((_, i) => (
                  <TaskTileSkeleton key={i} />
                ))}
              </Grid>
            ) : (
              <Grid cols={cols}>
                {tasks.map((task) => (
                  <TaskTile
                    key={task.id}
                    task={task}
                    onToggle={(v) => { void toggleTask(task.id, v); }}
                    onEdit={() => handleEdit(task)}
                    onHistory={() => openDetached(router, `tasks/runs/${task.id}`)}
                    onRemove={() => { void handleRemove(task.id); }}
                    onRun={() => runTask(task.id)}
                    onStop={() => stopTask(task.id)}
                  />
                ))}
              </Grid>
            )}
            <View style={{ height: 40 }} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// Placeholder tile mirroring TaskTile's footprint — shown while the
// first /api/scheduled-tasks fetch is in flight so the screen renders
// immediately instead of flashing the empty state.
function TaskTileSkeleton() {
  return (
    <View style={skeletonStyles.tile}>
      <View style={skeletonStyles.rail} />
      <View style={skeletonStyles.body}>
        <View style={skeletonStyles.headRow}>
          <Skeleton width="55%" height={14} />
          <Skeleton width={34} height={18} rounded={radius.lg} />
        </View>
        <Skeleton width="100%" height={11} />
        <Skeleton width="80%" height={11} />
        <View style={skeletonStyles.badgesRow}>
          <Skeleton width={72} height={16} rounded={radius.sm} />
        </View>
      </View>
    </View>
  );
}

// Row-chunked grid: each row is an independent flexbox of N equal cells, the
// short last row padded with spacers so columns stay aligned (see mcps Grid).
function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  const nodes = Array.isArray(children) ? children : [children];
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < nodes.length; i += cols) {
    rows.push(nodes.slice(i, i + cols));
  }
  return (
    <View style={{ gap: GRID_GAP }}>
      {rows.map((row, ri) => (
        <View key={ri} style={[gridStyles.row, { gap: GRID_GAP }]}>
          {row.map((child, ci) => (
            <View key={ci} style={gridStyles.cell}>{child}</View>
          ))}
          {row.length < cols &&
            Array.from({ length: cols - row.length }).map((_, pi) => (
              <View key={`pad-${pi}`} style={gridStyles.cell} />
            ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  errorWrap: {
    maxWidth: CONTENT_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.errorSoft,
    borderWidth: 1, borderColor: colors.errorBorder,
    borderRadius: radius.md,
  },
  errorText: { color: colors.error, fontSize: 12, flex: 1 },

  scroll: { flex: 1 },
  bodyInner: {
    maxWidth: CONTENT_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
  },
});

const gridStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { flex: 1, minWidth: 0 },
});

const skeletonStyles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    minHeight: 138,
  },
  rail: { width: 3, backgroundColor: colors.borderStrong },
  body: { flex: 1, padding: 14, gap: 8 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  badgesRow: { flexDirection: 'row', gap: 4, marginTop: 2 },
});
