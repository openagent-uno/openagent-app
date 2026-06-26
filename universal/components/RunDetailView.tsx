/**
 * RunDetailView — chat-styled detail for ONE execution.
 *
 * Opened from the sidebar's Recent feed (``/runs/{id}``). Where the
 * Scheduled / Workflows history screens list a parent's firings as compact
 * cards, this reads like the Chat transcript: an editorial single column
 * with a run header banner, the agent's output rendered as full-width
 * Markdown prose (``AssistantBlock``), and — for workflows — the block
 * trace as inline expandable step cards. The styling deliberately mirrors
 * ``MessageList`` so a run and a conversation feel like the same surface.
 *
 * Tasks have no single-run endpoint, so a task firing is fetched by
 * pulling the recent window and narrowing to the requested id; workflow
 * runs come straight from ``GET /api/workflow-runs/{id}``.
 */

import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, font, radius } from '../theme';
import {
  getWorkflowRun, getScheduledTaskRuns, fetchSessionRuns, runMsgToChat,
} from '../services/api';
import { runRoutePath } from '../../common/types';
import { openDetached } from '../services/windows';
import { useChat } from '../stores/chat';
import Markdown from './Markdown';
import MessageList from './MessageList';
import type {
  ChatMessage,
  TaskRun,
  WorkflowRun,
  WorkflowTraceEntry,
} from '../../common/types';

// The full transcript of a run-backed child session (a scheduled firing, an
// ai-prompt node), rendered inline with MessageList right under the run header
// — the run screen IS the session, no redirect. Nested delegations within it
// still link onward to their own child sessions in a detached chat window; a
// nested run-now opens its own run screen in a detached window.
//
// The fetch self-heals rather than showing a one-shot empty state: it keeps
// polling while the run is ``live`` (so the transcript fills in as the agent
// works), and retries a few times if the very first read comes back empty
// (covering the brief window after a firing finishes but before its runs JSON
// has flushed). A genuine fetch failure surfaces as an error with Retry — not
// silently as "no transcript".
const EMPTY_RETRY_MAX = 4;      // ~6s of retries for a just-finished flush race
const LIVE_POLL_MAX = 150;      // ~5min ceiling so a stuck run can't poll forever
const POLL_MS = 2000;

function SessionTranscript({ sessionId, live }: {
  sessionId: string;
  /** The owning run is still in flight — keep polling so the transcript grows. */
  live?: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The run IS a session: while it's in flight the server broadcasts its deltas
  // tagged with this sid, and the app's normal frame routing accumulates them
  // into the chat store — exactly like an interactive session. Prefer that live
  // copy so the transcript renders token-by-token; the polled DB read below is
  // the seed for a completed run that isn't in the store (or an older server).
  const liveSession = useChat((s) => s.sessions.find((x) => x.id === sessionId));
  const liveMessages = liveSession?.messages;
  const liveProcessing = liveSession?.isProcessing;
  const hasLive = !!liveMessages?.length;

  // Hard reset only when the session itself changes (or on an explicit Retry).
  // A ``live`` flip (running → done) must NOT blank the already-loaded
  // transcript — the poll effect below just refetches in place.
  useEffect(() => {
    setMessages(null);
    setError(null);
  }, [sessionId, reloadKey]);

  useEffect(() => {
    // Once the live store copy has content the DB poll is pure waste — the
    // broadcast stream drives the transcript. Poll only as the seed/fallback
    // (a completed run not in the store, or a server without live streaming).
    if (hasLive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const tick = async () => {
      try {
        const raw = await fetchSessionRuns(sessionId);
        if (cancelled) return;
        const mapped = raw.map(runMsgToChat);
        setMessages(mapped);
        setError(null);
        attempts += 1;
        // Keep going while the run is live (transcript still growing) or while
        // it's empty and we haven't exhausted the post-finish retry budget.
        const keepPolling = live
          ? attempts < LIVE_POLL_MAX
          : mapped.length === 0 && attempts < EMPTY_RETRY_MAX;
        if (keepPolling) timer = setTimeout(tick, POLL_MS);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? String(e));
        setMessages((m) => m ?? []);  // leave the loading state either way
        attempts += 1;
        // Same ceiling as the success path so a persistently-failing fetch on
        // a live run can't re-poll forever (LIVE_POLL_MAX ~ 5min).
        const keepRetrying = live ? attempts < LIVE_POLL_MAX : attempts < EMPTY_RETRY_MAX;
        if (keepRetrying) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [sessionId, live, reloadKey, hasLive]);

  // Prefer the live streamed copy whenever it has content; otherwise fall back
  // to the polled DB transcript. A live run with no deltas yet shows the
  // streaming indicator rather than a stale "no transcript".
  const display = hasLive ? liveMessages : messages;
  // The run-status poll (``live``) drives the streaming indicator — a detached
  // child's broadcast stub never flips the store's ``isProcessing``, and
  // keeping that false is what lets ``reconcileSession`` snap to the canonical
  // transcript on turn_complete.
  const streaming = !!live || !!liveProcessing;

  if (display == null && !error) {
    return (
      <ActivityIndicator size="small" color={colors.textMuted} style={{ marginVertical: 12 }} />
    );
  }
  if (error && (display == null || display.length === 0) && !streaming) {
    return (
      <TouchableOpacity onPress={() => setReloadKey((k) => k + 1)} style={styles.transcriptRetry}>
        <Feather name="refresh-cw" size={11} color={colors.textMuted} />
        <Text style={styles.transcriptRetryText}>Couldn't load the transcript — tap to retry</Text>
      </TouchableOpacity>
    );
  }
  if (!display || display.length === 0) {
    return streaming
      ? <EmptyNote text="Waiting for the run to produce output…" />
      : <EmptyNote text="This run produced no transcript." />;
  }
  return (
    <MessageList
      messages={display}
      isProcessing={streaming}
      onOpenChild={(id) => openDetached(router, `chat?session=${encodeURIComponent(id)}`)}
      onOpenRun={(target) => {
        const path = runRoutePath(target);
        if (path) openDetached(router, path);
      }}
    />
  );
}

type IconName = keyof typeof Feather.glyphMap;
type RunKind = 'workflow' | 'task';

const STATUS_COLOR: Record<string, string> = {
  running: colors.warning,
  success: colors.success,
  failed: colors.error,
  cancelled: colors.textMuted,
  skipped: colors.textMuted,
};

const webFade = Platform.OS === 'web' ? { className: 'oa-fade-in' } : {};

export function RunDetailView({
  kind,
  parentId,
  runId,
  name,
}: {
  kind: RunKind;
  parentId: string;
  runId: string;
  /** Parent workflow / task name, shown in the header banner. */
  name?: string;
}) {
  const [wfRun, setWfRun] = useState<WorkflowRun | null>(null);
  const [taskRun, setTaskRun] = useState<TaskRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Open the owning workflow / scheduled task — same destination (and
  // detached-window behaviour) as tapping its tile in the list screens.
  const openParent = () =>
    openDetached(router, `${kind === 'workflow' ? 'workflows' : 'tasks'}/${parentId}`);

  // Re-poll the run summary while the firing is still in flight, so the header
  // status pill settles, the duration finalises, and — for workflows — steps
  // that start after mount (and their inline per-step transcripts) appear. The
  // SessionTranscript bodies key their own ``live`` flag off the status this
  // refreshes, so without it a run opened mid-flight would stay frozen.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    let gotData = false;
    setLoading(true);
    setError(null);
    setWfRun(null);
    setTaskRun(null);
    const load = async () => {
      try {
        let status: string | undefined;
        if (kind === 'workflow') {
          const run = await getWorkflowRun(runId);
          if (cancelled) return;
          setWfRun(run);
          gotData = !!run;
          status = run?.status;
        } else {
          // No single-firing endpoint for tasks — pull the recent window
          // and narrow to the requested run.
          const runs = await getScheduledTaskRuns(parentId, { limit: 50 });
          if (cancelled) return;
          const found = runs.find((r) => r.id === runId) ?? null;
          setTaskRun(found);
          gotData = !!found;
          if (!found) { setError('This run could not be found.'); return; }
          status = found.status;
        }
        setError(null);
        polls += 1;
        if (status === 'running' && polls < LIVE_POLL_MAX && !cancelled) {
          timer = setTimeout(load, POLL_MS);
        }
      } catch (e: any) {
        if (cancelled) return;
        // Fail hard only before the first successful read; a transient failure
        // mid-poll keeps the last good snapshot and retries.
        if (!gotData) setError(e?.message ?? String(e));
        else if (polls < LIVE_POLL_MAX) timer = setTimeout(load, POLL_MS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [kind, parentId, runId]);

  if (loading) {
    return (
      <View style={styles.statusPane}>
        <ActivityIndicator size="small" color={colors.textMuted} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.statusPane}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const run = wfRun ?? taskRun;
  if (!run) return null;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.column}>
      <RunHeader
        name={name}
        kindIcon={kind === 'workflow' ? 'git-branch' : 'clock'}
        kindLabel={kind === 'workflow' ? 'Workflow' : 'Scheduled task'}
        status={run.status}
        trigger={run.trigger}
        startedIso={run.started_at_iso}
        startedAt={run.started_at}
        finishedAt={run.finished_at}
        onPress={openParent}
      />
      {wfRun ? <WorkflowBody run={wfRun} /> : taskRun ? <TaskBody run={taskRun} /> : null}
    </ScrollView>
  );
}

// ── Header banner ────────────────────────────────────────────────────

function RunHeader({
  name,
  kindIcon,
  kindLabel,
  status,
  trigger,
  startedIso,
  startedAt,
  finishedAt,
  onPress,
}: {
  name?: string;
  kindIcon: IconName;
  kindLabel: string;
  status: string;
  trigger: string;
  startedIso?: string;
  startedAt: number;
  finishedAt: number | null;
  onPress: () => void;
}) {
  const color = STATUS_COLOR[status] ?? colors.textMuted;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={styles.runHeader}
      accessibilityRole="button"
      accessibilityLabel={`Open ${kindLabel.toLowerCase()} ${name || ''}`.trim()}
      // @ts-ignore web hover + entrance
      {...(Platform.OS === 'web' ? { className: 'oa-fade-in oa-row-hover' } : {})}
    >
      <View style={styles.runHeaderTop}>
        <Feather name={kindIcon} size={14} color={colors.textSecondary} />
        <Text style={styles.runTitle} numberOfLines={1}>
          {name || 'Run'}
        </Text>
        <View style={[styles.statusPill, { borderColor: color }]}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <Text style={[styles.statusPillText, { color }]}>{status}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      </View>
      <View style={styles.metaRow}>
        <MetaItem icon={kindIcon} text={kindLabel} />
        <MetaItem icon="zap" text={trigger} />
        {startedIso ? <MetaItem icon="calendar" text={formatWhen(startedIso)} /> : null}
        <MetaItem icon="clock" text={formatDuration(startedAt, finishedAt, status)} />
      </View>
    </TouchableOpacity>
  );
}

function MetaItem({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.metaItem}>
      <Feather name={icon} size={11} color={colors.textMuted} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

// ── Task firing body ─────────────────────────────────────────────────

function TaskBody({ run }: { run: TaskRun }) {
  // A durable firing renders as its full child-session transcript (same
  // surface as a chat). Legacy firings (no session) keep the output preview.
  if (run.session_id) {
    return (
      <>
        <SessionTranscript sessionId={run.session_id} live={run.status === 'running'} />
        {run.error ? <ErrorBlock text={run.error} /> : null}
      </>
    );
  }
  return (
    <>
      {run.output ? (
        <AssistantBlock label="Output" text={run.output} />
      ) : !run.error ? (
        <EmptyNote text="This run produced no output." />
      ) : null}
      {run.error ? <ErrorBlock text={run.error} /> : null}
    </>
  );
}

// ── Workflow run body ────────────────────────────────────────────────

function WorkflowBody({ run }: { run: WorkflowRun }) {
  const result = useMemo(() => {
    if (!run.outputs || Object.keys(run.outputs).length === 0) return null;
    return safeJson(run.outputs);
  }, [run.outputs]);

  return (
    <>
      <Text style={styles.sectionLabel}>Steps</Text>
      {run.trace.length === 0 ? (
        <EmptyNote text="No steps were recorded for this run." />
      ) : (
        // Each ai-prompt node ran as its own child session — render that
        // session's transcript inline right under its step card, so the whole
        // run reads as one page (no redirect out to the chat tab).
        run.trace.map((entry, i) => (
          <View key={`${entry.node_id}-${i}`}>
            <StepCard entry={entry} />
            {entry.child_session_id ? (
              <SessionTranscript
                sessionId={entry.child_session_id}
                live={entry.status === 'running'}
              />
            ) : null}
          </View>
        ))
      )}
      {run.error ? <ErrorBlock text={run.error} /> : null}
      {result ? (
        <AssistantBlock label="Result" text={'```json\n' + result + '\n```'} />
      ) : null}
    </>
  );
}

function StepCard({ entry }: { entry: WorkflowTraceEntry }) {
  const [expanded, setExpanded] = useState(false);
  const color = STATUS_COLOR[entry.status] ?? colors.textMuted;
  const hasBody = entry.input != null || entry.output != null || !!entry.error;
  return (
    <TouchableOpacity
      activeOpacity={hasBody ? 0.85 : 1}
      onPress={() => hasBody && setExpanded((v) => !v)}
      style={[styles.stepCard, entry.status === 'failed' && styles.stepCardError]}
      {...(webFade as any)}
    >
      <View style={styles.stepHeader}>
        <View style={[styles.stepDot, { backgroundColor: color }]} />
        <Text style={styles.stepNode}>{entry.node_id}</Text>
        <Text style={styles.stepType}>{entry.type}</Text>
        <Text style={[styles.stepStatus, { color }]}>{entry.status}</Text>
        <Text style={styles.stepDuration}>
          {formatDuration(entry.started_at, entry.finished_at, entry.status)}
        </Text>
        {hasBody ? (
          <Feather
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={12}
            color={colors.textMuted}
          />
        ) : null}
      </View>
      {expanded ? (
        <View style={styles.stepBody}>
          {entry.input != null ? (
            <CodeSection label="input" value={safeJson(entry.input)} />
          ) : null}
          {entry.output != null ? (
            <CodeSection label="output" value={safeJson(entry.output)} />
          ) : null}
          {entry.error ? (
            <CodeSection label="error" value={entry.error} tone="error" />
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function CodeSection({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'error';
}) {
  return (
    <>
      <Text
        style={[styles.sectionTitle, tone === 'error' && { color: colors.error }]}
      >
        {label}
      </Text>
      <View
        style={[styles.codeBlock, tone === 'error' && { borderColor: colors.errorBorder }]}
      >
        <Text
          style={[styles.codeText, tone === 'error' && { color: colors.error }]}
        >
          {value}
        </Text>
      </View>
    </>
  );
}

// ── Chat-like atoms ──────────────────────────────────────────────────

function AssistantBlock({ label, text }: { label: string; text: string }) {
  return (
    <View style={styles.assistantBlock} {...(webFade as any)}>
      <View style={styles.assistantHead}>
        <View style={styles.assistantDot} />
        <Text style={styles.assistantLabel}>{label}</Text>
        <CopyButton text={text} />
      </View>
      <View style={styles.assistantBody}>
        <Markdown text={text} />
      </View>
    </View>
  );
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <View style={styles.errorBlock} {...(webFade as any)}>
      <View style={styles.assistantHead}>
        <Feather name="alert-triangle" size={12} color={colors.error} />
        <Text style={[styles.assistantLabel, { color: colors.error }]}>Error</Text>
        <CopyButton text={text} />
      </View>
      <Text style={styles.errorBody} selectable>
        {text}
      </Text>
    </View>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <Text style={styles.emptyNote}>{text}</Text>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };
  return (
    <TouchableOpacity
      style={styles.copyBtn}
      onPress={doCopy}
      accessibilityLabel={copied ? 'Copied' : 'Copy'}
    >
      <Feather
        name={copied ? 'check' : 'copy'}
        size={11}
        color={copied ? colors.success : colors.textMuted}
      />
    </TouchableOpacity>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function formatDuration(
  startedAt: number,
  finishedAt: number | null,
  status: string,
): string {
  if (finishedAt != null && startedAt) {
    return (finishedAt - startedAt).toFixed(2) + 's';
  }
  return status === 'running' ? '…' : '—';
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function safeJson(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  // Editorial single column, matching the Chat transcript's reading width.
  column: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  statusPane: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  errorText: { fontSize: 12, color: colors.error, textAlign: 'center' },

  // Header banner
  runHeader: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 18,
  },
  runHeaderTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  runTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    fontFamily: font.sans,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: font.mono,
  },

  // Section label ("Steps")
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  // Workflow step card
  stepCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: 6,
    overflow: 'hidden',
  },
  stepCardError: { borderColor: colors.errorBorder },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  stepDot: { width: 7, height: 7, borderRadius: 4 },
  stepNode: {
    fontSize: 12,
    color: colors.text,
    fontFamily: font.mono,
    fontWeight: '600',
  },
  stepType: {
    flex: 1,
    fontSize: 10,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stepStatus: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stepDuration: {
    fontSize: 9,
    color: colors.textMuted,
    fontFamily: font.mono,
    minWidth: 32,
    textAlign: 'right',
  },
  stepBody: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 2,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  codeBlock: {
    backgroundColor: colors.codeBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.codeBorder,
    padding: 8,
  },
  codeText: {
    fontSize: 11,
    color: colors.codeText,
    fontFamily: font.mono,
    lineHeight: 16,
  },

  // Assistant-style output block (mirrors MessageList)
  assistantBlock: { paddingVertical: 10, marginTop: 6 },
  assistantHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  assistantDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    // @ts-ignore web: gradient background
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'linear-gradient(135deg, #d94841, #f3a33a)' }
      : {}),
  },
  assistantLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  assistantBody: {},
  copyBtn: {
    width: 22,
    height: 22,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },

  // Error block
  errorBlock: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: 12,
  },
  errorBody: {
    fontSize: 11,
    color: colors.error,
    fontFamily: font.mono,
    lineHeight: 16,
  },

  emptyNote: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  transcriptRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  transcriptRetryText: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: font.mono,
  },
});
