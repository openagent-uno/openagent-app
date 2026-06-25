/**
 * RunHistoryContent — the workflow run-history body.
 *
 * Fetches a workflow's last runs from ``/api/workflows/{id}/runs`` +
 * ``/stats`` (via the workflows store), merges any in-flight live run on
 * top, and renders a summary line plus an expandable per-run trace list
 * (one row per block with status dot, input, output, error).
 *
 * Carries no chrome of its own so it drops straight into the run-history
 * *screen* (``app/(tabs)/workflows/runs/[id].tsx``) under that screen's
 * react-navigation header. Run history used to be an in-editor slide-over
 * drawer; it now opens as its own window/screen everywhere (the list
 * rows and the editor's History button both ``openDetached`` to that
 * route), so the drawer shell was retired and only this body remains.
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
import { colors, font, radius } from '../../theme';
import { getWorkflowRuns } from '../../services/api';
import { useWorkflows } from '../../stores/workflows';
import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowTraceEntry,
} from '../../../common/types';

const STATUS_COLOR: Record<WorkflowRunStatus, string> = {
  running: '#CC8020',
  success: '#15885E',
  failed: '#C94A43',
  cancelled: '#55524B',
};

export function RunHistoryContent({ workflowId }: { workflowId: string }) {
  const stats = useWorkflows((s) => s.stats[workflowId]);
  const liveRun = useWorkflows((s) => s.runs[workflowId]);
  const loadStats = useWorkflows((s) => s.loadStats);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [fetched] = await Promise.all([
          getWorkflowRuns(workflowId, { limit: 20 }),
          loadStats(workflowId, 10),
        ]);
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
  }, [workflowId, loadStats]);

  // Merge the live run (if any) into the fetched list so in-flight
  // runs appear at the top — even before the first stats refresh.
  const displayRuns = useMemo(() => {
    if (!liveRun) return runs;
    const others = runs.filter((r) => r.id !== liveRun.id);
    return [liveRun, ...others];
  }, [liveRun, runs]);

  return (
    <View style={styles.content}>
      {stats ? (
        <Text style={styles.summary}>
          {stats.total_runs} run{stats.total_runs === 1 ? '' : 's'} ·{' '}
          {(stats.success_rate * 100).toFixed(0)}% success
          {stats.avg_duration_s != null
            ? ` · avg ${stats.avg_duration_s.toFixed(1)}s`
            : ''}
        </Text>
      ) : null}
      <ScrollView style={styles.scroll}>
        {loading ? (
          <View style={styles.loadingPane}>
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : displayRuns.length === 0 ? (
          <Text style={styles.emptyText}>
            No runs yet. Hit Run to create the first one.
          </Text>
        ) : (
          displayRuns.map((run) => (
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
  run: WorkflowRun;
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
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.textMuted}
        />
      </TouchableOpacity>
      {run.error ? (
        <Text style={styles.cardError} numberOfLines={expanded ? undefined : 2}>
          {run.error}
        </Text>
      ) : null}
      {expanded ? (
        <View style={styles.traceWrap}>
          {(run.trace || []).length === 0 ? (
            <Text style={styles.emptyText}>No trace entries yet.</Text>
          ) : (
            (run.trace || []).map((entry, i) => (
              <TraceRow key={`${entry.node_id}-${i}`} entry={entry} />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function TraceRow({ entry }: { entry: WorkflowTraceEntry }) {
  const [showDetails, setShowDetails] = useState(false);
  const color =
    entry.status === 'success'
      ? '#15885E'
      : entry.status === 'failed'
      ? '#C94A43'
      : entry.status === 'running'
      ? '#CC8020'
      : colors.textMuted;
  const duration =
    entry.finished_at != null && entry.started_at
      ? (entry.finished_at - entry.started_at).toFixed(2) + 's'
      : entry.status === 'running'
      ? '…'
      : '—';
  return (
    <View style={styles.traceRow}>
      <TouchableOpacity
        onPress={() => setShowDetails((v) => !v)}
        style={styles.traceHeader}
      >
        <View style={[styles.traceDot, { backgroundColor: color }]} />
        <Text style={styles.traceNode}>{entry.node_id}</Text>
        <Text style={styles.traceType}>{entry.type}</Text>
        <Text style={styles.traceStatus}>{entry.status}</Text>
        <Text style={styles.traceDuration}>{duration}</Text>
      </TouchableOpacity>
      {showDetails && (
        <View style={styles.traceDetails}>
          {entry.input != null && (
            <>
              <Text style={styles.traceLabel}>input</Text>
              <Text style={styles.traceValue}>{safeJson(entry.input)}</Text>
            </>
          )}
          {entry.output != null && (
            <>
              <Text style={styles.traceLabel}>output</Text>
              <Text style={styles.traceValue}>{safeJson(entry.output)}</Text>
            </>
          )}
          {entry.error && (
            <>
              <Text style={[styles.traceLabel, { color: colors.error }]}>
                error
              </Text>
              <Text style={[styles.traceValue, { color: colors.error }]}>
                {entry.error}
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const styles = StyleSheet.create({
  // Fills its parent (the run-history screen's flex column).
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
  traceWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    padding: 4,
  },
  traceRow: {
    borderRadius: radius.sm,
  },
  traceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 6,
    gap: 6,
  },
  traceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  traceNode: {
    fontSize: 10,
    color: colors.text,
    fontFamily: font.mono,
    fontWeight: '600',
    minWidth: 24,
  },
  traceType: {
    fontSize: 10,
    color: colors.primary,
    flex: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  traceStatus: {
    fontSize: 9,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  traceDuration: {
    fontSize: 9,
    color: colors.textMuted,
    fontFamily: font.mono,
    marginLeft: 6,
    minWidth: 30,
    textAlign: 'right',
  },
  traceDetails: {
    paddingLeft: 20,
    paddingRight: 8,
    paddingBottom: 8,
    gap: 3,
  },
  traceLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 4,
  },
  traceValue: {
    fontSize: 10,
    color: colors.textSecondary,
    fontFamily: font.mono,
    lineHeight: 14,
  },
});
