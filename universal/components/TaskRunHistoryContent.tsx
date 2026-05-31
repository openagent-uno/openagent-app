/**
 * TaskRunHistoryContent — the scheduled-task analogue of the workflow
 * ``RunHistoryContent``.
 *
 * Fetches a task's recent firings from
 * ``GET /api/scheduled-tasks/{id}/runs`` and renders them as a list of
 * expandable cards. A task firing is a single agent run (no block
 * graph), so each card expands to the agent's ``output`` preview and/or
 * the ``error`` that aborted it — not a per-block trace.
 *
 * Chrome-less so it drops straight into the run-history *screen*
 * (``app/(tabs)/tasks/runs/[id].tsx``) under a ``DetachedHeader``.
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, font, radius } from '../theme';
import { getScheduledTaskRuns } from '../services/api';
import type { TaskRun, TaskRunStatus } from '../../common/types';

// Shares the workflow run palette for the statuses they have in common.
const STATUS_COLOR: Record<TaskRunStatus, string> = {
  running: '#CC8020',
  success: '#15885E',
  failed: '#C94A43',
};

export function TaskRunHistoryContent({ taskId }: { taskId: string }) {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const fetched = await getScheduledTaskRuns(taskId, { limit: 20 });
        if (!cancelled) setRuns(fetched);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // No server-side stats endpoint for tasks, so summarize the fetched
  // window. Labelled "recent" so the count isn't read as an all-time
  // total.
  const summary = useMemo(() => {
    if (runs.length === 0) return null;
    const ok = runs.filter((r) => r.status === 'success').length;
    const failed = runs.filter((r) => r.status === 'failed').length;
    return { total: runs.length, ok, failed };
  }, [runs]);

  return (
    <View style={styles.content}>
      {summary ? (
        <Text style={styles.summary}>
          {summary.total} recent run{summary.total === 1 ? '' : 's'} ·{' '}
          {summary.ok} ok · {summary.failed} failed
        </Text>
      ) : null}
      <ScrollView style={styles.scroll}>
        {loading ? (
          <View style={styles.loadingPane}>
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : runs.length === 0 ? (
          <Text style={styles.emptyText}>
            No runs yet. This task hasn't fired since history tracking
            began.
          </Text>
        ) : (
          runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              onToggle={() =>
                setExpandedId(expandedId === run.id ? null : run.id)
              }
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function RunCard({
  run,
  expanded,
  onToggle,
}: {
  run: TaskRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colorBand = STATUS_COLOR[run.status] || colors.textMuted;
  const duration =
    run.finished_at != null && run.started_at
      ? (run.finished_at - run.started_at).toFixed(2) + 's'
      : run.status === 'running'
      ? '…'
      : '—';
  const hasBody = !!run.output || !!run.error;
  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={onToggle} style={styles.cardHeader}>
        <View style={[styles.statusDot, { backgroundColor: colorBand }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            {run.started_at_iso || run.id.slice(0, 8)}
          </Text>
          <Text style={styles.cardMeta}>
            {run.status} · {duration} · {run.trigger}
          </Text>
        </View>
        {hasBody ? (
          <Feather
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.textMuted}
          />
        ) : null}
      </TouchableOpacity>
      {run.error ? (
        <Text style={styles.cardError} numberOfLines={expanded ? undefined : 2}>
          {run.error}
        </Text>
      ) : null}
      {expanded && run.output ? (
        <View style={styles.bodyWrap}>
          <Text style={styles.bodyLabel}>output</Text>
          <Text style={styles.bodyValue}>{run.output}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  summary: {
    fontSize: 11,
    color: colors.textMuted,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  scroll: {
    flex: 1,
    padding: 10,
  },
  loadingPane: {
    padding: 30,
    alignItems: 'center',
  },
  errorText: {
    padding: 20,
    fontSize: 11,
    color: colors.error,
    textAlign: 'center',
  },
  emptyText: {
    padding: 20,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 16,
  },
  card: {
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardTitle: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '500',
    fontFamily: font.mono,
  },
  cardMeta: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardError: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    fontSize: 10,
    color: colors.error,
    fontFamily: font.mono,
  },
  bodyWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  bodyLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  bodyValue: {
    fontSize: 10,
    color: colors.textSecondary,
    fontFamily: font.mono,
    lineHeight: 14,
  },
});
