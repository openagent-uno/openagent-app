/**
 * Scheduled tasks list.
 *
 * Tasks live in the backend SQLite database, served over
 * /api/scheduled-tasks. Changes take effect within ~30 seconds (the
 * scheduler's next tick) — no restart required.
 *
 * Creating, editing, and viewing a task's run history each open a
 * *detached* view (``openDetached``): a separate window on the desktop
 * app, a pushed full-screen route on web / native. The list itself
 * only handles enable/disable and delete inline, and refetches when the
 * gateway broadcasts a ``scheduled_task`` change (including saves made
 * from a detached editor window).
 */

import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { colors, font } from '../../../theme';
import { useConnection } from '../../../stores/connection';
import { useEvents } from '../../../stores/events';
import { useTasks } from '../../../stores/tasks';
import { setBaseUrl } from '../../../services/api';
import { openDetached } from '../../../services/windows';
import { useConfirm } from '../../../components/ConfirmDialog';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import ThemedSwitch from '../../../components/ThemedSwitch';
import type { ScheduledTask } from '../../../../common/types';

export default function TasksScreen() {
  const router = useRouter();
  const connConfig = useConnection((s) => s.config);
  const { tasks, error, loadTasks, deleteTask, toggleTask } = useTasks();
  const confirm = useConfirm();

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

  const handleAdd = () => {
    // ``new`` is the create sentinel — caught by tasks/[id].tsx since
    // task ids are uuids and never literally "new".
    openDetached(router, 'tasks/new');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Scheduled Tasks</Text>
      <Text style={styles.hint}>
        Cron tasks stored in the database. Changes take effect within ~30 seconds.
      </Text>

      <Card padded={false}>
        {tasks.length === 0 && (
          <Text style={styles.emptyText}>No scheduled tasks</Text>
        )}

        {tasks.map((task, i) => (
          <View key={task.id} style={[styles.taskRow, i > 0 && styles.taskRowBorder]}>
            <TouchableOpacity style={styles.taskInfo} onPress={() => handleEdit(task)}>
              <Text style={styles.taskName}>{task.name}</Text>
              <Text style={styles.taskCron}>{task.cron_expression}</Text>
              <Text style={styles.taskPrompt} numberOfLines={2}>{task.prompt}</Text>
            </TouchableOpacity>
            <View style={styles.taskActions}>
              <ThemedSwitch
                value={task.enabled}
                onValueChange={(v) => { void toggleTask(task.id, v); }}
              />
              <TouchableOpacity
                onPress={() => openDetached(router, `tasks/runs/${task.id}`)}
                style={styles.actionBtn}
                accessibilityLabel={`Run history for ${task.name}`}
              >
                <Feather name="clock" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleEdit(task)} style={styles.actionBtn}>
                <Feather name="edit-2" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { void handleRemove(task.id); }} style={styles.actionBtn}>
                <Feather name="x" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <View style={styles.addBar}>
          <Button
            variant="primary"
            label="Add Task"
            icon="plus"
            fullWidth
            onPress={handleAdd}
          />
        </View>
      </Card>

      {error && (
        <Text style={styles.errorMsg}>{error}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, maxWidth: 640, width: "100%", alignSelf: "center" },
  title: {
    fontSize: 18, fontWeight: '500', color: colors.text, marginBottom: 4,
    fontFamily: font.display, letterSpacing: -0.3,
  },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 14 },
  emptyText: { padding: 14, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  taskRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 11, paddingHorizontal: 12,
  },
  taskRowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  taskInfo: { flex: 1 },
  taskName: { fontSize: 13, fontWeight: '600', color: colors.text, letterSpacing: -0.1 },
  taskCron: { fontSize: 11, color: colors.primary, fontFamily: font.mono, marginTop: 2 },
  taskPrompt: { fontSize: 11.5, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 8 },
  actionBtn: { padding: 6 },
  addBar: { padding: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  errorMsg: { marginTop: 10, fontSize: 12, color: colors.error, textAlign: 'center' },
});
