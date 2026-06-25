/**
 * Scheduled-task editor — /tasks/{id}.
 *
 * Opened detached from the list: a separate desktop window, or a pushed
 * full-screen route on web / native. ``id === 'new'`` is the create
 * sentinel (task ids are uuids, so they never collide with the literal
 * "new"); any other id loads that task for editing.
 *
 * Each desktop window is its own renderer with a fresh store, so the
 * task is fetched here over REST rather than read from the list's
 * store. Saving routes through the tasks store (which calls the API and
 * the gateway broadcasts a ``scheduled_task`` event), then the screen
 * dismisses — the list window refetches off that broadcast.
 */

import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { colors, font, radius } from '../../../theme';
import { useConnection } from '../../../stores/connection';
import { useTasks } from '../../../stores/tasks';
import { setBaseUrl, getScheduledTask } from '../../../services/api';
import CronPicker from '../../../components/CronPicker';
import { HeaderAction } from '../../../components/screenHeader';

interface TaskForm {
  name: string;
  cron_expression: string;
  prompt: string;
}

const EMPTY_FORM: TaskForm = { name: '', cron_expression: '', prompt: '' };

export default function TaskEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const isNew = id === 'new';
  const connConfig = useConnection((s) => s.config);
  const { createTask, updateTask, error: storeError } = useTasks();

  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!connConfig) return;
    if (connConfig.sidecarPort) setBaseUrl('127.0.0.1', connConfig.sidecarPort);
    if (isNew || !id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const t = await getScheduledTask(id);
        if (!cancelled) {
          setForm({
            name: t.name,
            cron_expression: t.cron_expression,
            prompt: t.prompt,
          });
        }
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connConfig, id, isNew]);

  const close = () => { if (navigation.canGoBack()) navigation.goBack(); };

  const handleSave = async () => {
    setLocalError(null);
    const name = form.name.trim();
    const cron = form.cron_expression.trim();
    const prompt = form.prompt.trim();
    if (!name || !cron || !prompt) {
      setLocalError('Name, schedule, and prompt are all required.');
      return;
    }
    setSaving(true);
    const ok = isNew
      ? !!(await createTask({ name, cron_expression: cron, prompt }))
      : await updateTask(id, { name, cron_expression: cron, prompt });
    setSaving(false);
    if (ok) close();
  };

  // Title + Save action in the nav header (back is provided by the stack).
  useLayoutEffect(() => {
    navigation.setOptions({
      title: isNew ? 'New Task' : (form.name || 'Edit Task'),
      headerRight: () => (
        <HeaderAction
          icon="check"
          label={saving ? 'Saving…' : isNew ? 'Add' : 'Save'}
          onPress={handleSave}
          disabled={saving || loading}
        />
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isNew, form, saving, loading]);

  return (
    <View style={styles.screen}>
      {loading ? (
        <View style={styles.statusPane}>
          <ActivityIndicator size="small" color={colors.textMuted} />
        </View>
      ) : loadError ? (
        <View style={styles.statusPane}>
          <Text style={styles.errorMsg}>Failed to load task: {loadError}</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={(v) => setForm({ ...form, name: v })}
            placeholder="Name (e.g. health-check)"
            placeholderTextColor={colors.textMuted}
          />

          <View style={styles.cronSlot}>
            <CronPicker
              label="Schedule"
              value={form.cron_expression}
              onChange={(v) => setForm({ ...form, cron_expression: v })}
            />
          </View>

          <Text style={styles.label}>Prompt</Text>
          {Platform.OS === 'web' ? (
            <textarea
              value={form.prompt}
              onChange={(e: any) => setForm({ ...form, prompt: e.target.value })}
              placeholder="Prompt — what should the agent do?"
              rows={6}
              style={{
                backgroundColor: colors.inputBg, borderRadius: 8, border: `1px solid ${colors.border}`,
                padding: 10, color: colors.text, fontSize: 13, fontFamily: 'inherit',
                resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box',
              } as any}
            />
          ) : (
            <TextInput
              style={[styles.input, { height: 120, textAlignVertical: 'top' }]}
              value={form.prompt}
              onChangeText={(v) => setForm({ ...form, prompt: v })}
              placeholder="Prompt"
              placeholderTextColor={colors.textMuted}
              multiline
            />
          )}

          {(localError || storeError) && (
            <Text style={styles.errorMsg}>{localError || storeError}</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  statusPane: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  body: { flex: 1 },
  bodyContent: { padding: 20, maxWidth: 640, width: '100%', alignSelf: 'center' },
  label: {
    fontSize: 11, fontWeight: '600', color: colors.textSecondary,
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 11, paddingVertical: 9,
    color: colors.text, fontSize: 12, marginBottom: 14, fontFamily: font.mono,
  },
  cronSlot: { marginBottom: 14 },
  errorMsg: { marginTop: 12, fontSize: 12, color: colors.error },
});
