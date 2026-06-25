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
import { useRouter, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { colors, font, radius } from '../../../theme';
import { useConnection } from '../../../stores/connection';
import { useEvents } from '../../../stores/events';
import { useTasks } from '../../../stores/tasks';
import { setBaseUrl } from '../../../services/api';
import { openDetached } from '../../../services/windows';
import { useConfirm } from '../../../components/ConfirmDialog';
import Button from '../../../components/Button';
import { HeaderAction } from '../../../components/screenHeader';
import TaskTile from '../../../components/tasks/TaskTile';
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
  const connConfig = useConnection((s) => s.config);
  const { tasks, error, loadTasks, deleteTask, toggleTask } = useTasks();
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

  const activeCount = useMemo(() => tasks.filter((t) => t.enabled).length, [tasks]);

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
      <View style={styles.fixedHeader}>
        <View style={styles.headerInner}>
          <Text style={styles.hint}>
            Cron tasks stored in the database. {tasks.length} task{tasks.length === 1 ? '' : 's'},{' '}
            {activeCount} active. Changes take effect within ~30 seconds.
          </Text>
          {error && (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={13} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.bodyInner} onLayout={onContainerLayout}>
          {tasks.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Feather name="clock" size={20} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No scheduled tasks yet</Text>
              <Text style={styles.emptyMessage}>
                Schedule a recurring prompt — or ask OpenAgent AI to set one up for you.
              </Text>
              <View style={styles.emptyActions}>
                <Button variant="primary" size="sm" label="New task" icon="plus" onPress={handleAdd} />
              </View>
            </View>
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
                />
              ))}
            </Grid>
          )}
          <View style={{ height: 40 }} />
        </View>
      </ScrollView>
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

  fixedHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  headerInner: {
    maxWidth: CONTENT_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 14,
    gap: 12,
  },
  hint: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18, maxWidth: 640 },

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
    fontFamily: font.display, letterSpacing: -0.2, marginTop: 2,
  },
  emptyMessage: {
    fontSize: 12.5, color: colors.textMuted,
    textAlign: 'center', maxWidth: 420, lineHeight: 18,
  },
  emptyActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
});

const gridStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { flex: 1, minWidth: 0 },
});
