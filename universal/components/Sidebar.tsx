/**
 * Sidebar — the primary navigation surface.
 *
 * Permanent column on tablet / desktop; on phones it rides inside the
 * slide-in drawer (see app/(tabs)/_layout.tsx). Modelled on the Claude /
 * Virgil desktop shell in the JARVIS skin:
 *
 *   ┌──────────────┐
 *   │ ⌖ OPENAGENT  │  bird logo + wordmark
 *   │ ▸ jarvis  ▾  │  connected agent (tap → switch / add modal)
 *   │ + New session│  styled like a nav row
 *   │ ▸ Memory     │  workspace nav — a cyan rail glides to the active row
 *   │   Connectors │
 *   │   Scheduled  │
 *   │   Workflows  │
 *   │ Recent    ⛃  │  unified, recency-sorted feed; the funnel opens a
 *   │  · row …     │  dropdown to toggle which kinds show
 *   │  · row …     │
 *   │       ⚙  ◢   │  footer: Settings + System (icons only)
 *   └──────────────┘
 *
 * Single density: a 244px full column with labels + the recent feed. It is a
 * permanent column on tablet+ and rides the toggleable drawer on phones —
 * there is no collapsed icon-only stage.
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  ScrollView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Feather from '@expo/vector-icons/Feather';
import { useRouter, useSegments, useGlobalSearchParams } from 'expo-router';
import { useChat } from '../stores/chat';
import { isHiddenChildSession } from '../../common/types';
import { useActivity, type ActivityRun } from '../stores/activity';
import { useConnection } from '../stores/connection';
import { useConfirm } from './ConfirmDialog';
import PopupMenu from './PopupMenu';
import { useEvents } from '../stores/events';
import AgentSwitcher from './AgentSwitcher';
import BrandLogo from './BrandLogo';
import WindowControls from './WindowControls';
import DragRegion from './DragRegion';
import { colors, font, radius, spacing, tracking } from '../theme';

type IconName = keyof typeof Feather.glyphMap;

interface NavItem {
  href: string;
  match: string;
  label: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { href: '/memory', match: 'memory', label: 'Memory', icon: 'book-open' },
  { href: '/mcps', match: 'mcps', label: 'Connectors', icon: 'grid' },
  { href: '/tasks', match: 'tasks', label: 'Scheduled', icon: 'clock' },
  { href: '/workflows', match: 'workflows', label: 'Workflows', icon: 'git-branch' },
  { href: '/events', match: 'events', label: 'Events', icon: 'zap' },
];

// Fixed nav-row geometry so the gliding rail can resolve a row's Y.
const ROW_H = 38;
const ROW_GAP = 2;
const FEED_MAX = 60;

type FilterKey = 'chat' | 'workflow' | 'task' | 'event';
const FILTERS: { key: FilterKey; label: string; icon: IconName }[] = [
  { key: 'chat', label: 'Sessions', icon: 'message-circle' },
  { key: 'workflow', label: 'Workflows', icon: 'share-2' },
  { key: 'task', label: 'Scheduled', icon: 'clock' },
  { key: 'event', label: 'Events', icon: 'zap' },
];

interface FeedItem {
  key: string;
  icon: IconName;
  label: string;
  ts: number;
  active?: boolean;
  dotColor?: string | null;
  onPress: () => void;
  // Set only on manual chat rows — deleting (with confirmation) a chat and
  // the sub-agent sessions it spawned. Runs (workflow / scheduled) leave it
  // undefined, so no delete affordance renders for them.
  onDelete?: () => void;
}

export default function Sidebar({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const segments = useSegments();
  // Post-auth WS drop — surfaced right above the agent name so the connection
  // state lives next to the agent identity (moved here from the chat screen).
  const isReconnecting = useConnection((s) => s.isReconnecting);
  // macOS shows native traffic lights over the sidebar's top-left, so the
  // brand pads down to clear them and that strip drags the window.
  const isMac = typeof window !== 'undefined' && (window as any).desktop?.platform === 'darwin';

  const activeSeg = useMemo(() => {
    const known = ['memory', 'mcps', 'tasks', 'workflows', 'events', 'settings', 'system', 'chat'];
    for (let i = segments.length - 1; i >= 0; i--) {
      if (known.includes(segments[i])) return segments[i];
    }
    return 'chat';
  }, [segments]);

  const navIndex = NAV.findIndex((n) => n.match === activeSeg);

  // ── Gliding cyan rail ──
  const railY = useSharedValue(navIndex < 0 ? 0 : navIndex * (ROW_H + ROW_GAP));
  const railOpacity = useSharedValue(navIndex < 0 ? 0 : 1);
  useEffect(() => {
    railOpacity.value = withTiming(navIndex < 0 ? 0 : 1, { duration: 180 });
    if (navIndex >= 0) {
      railY.value = withTiming(navIndex * (ROW_H + ROW_GAP), {
        duration: 280,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [navIndex, railOpacity, railY]);
  const railStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: railY.value }],
    opacity: railOpacity.value,
  }));

  const go = (href: string) => {
    router.push(href as any);
    onNavigate?.();
  };

  const startSession = () => {
    useChat.getState().createSession();
    router.push('/chat' as any);
    onNavigate?.();
  };

  return (
    <View style={[styles.root, styles.rootFull, isMac && styles.rootMac]}>
      {/* ── macOS window-control strip (custom traffic lights + drag) ── */}
      {isMac && (
        <View
          style={[
            styles.macControls,
            { marginLeft: -spacing.md, marginRight: -spacing.md },
          ]}
        >
          {/* Drag layer behind the controls (sibling, never their parent). */}
          <DragRegion />
          <WindowControls />
        </View>
      )}

      {/* ── Brand (agent lives in the footer) ── */}
      <View
        // @ts-ignore web drag region
        style={[
          styles.brand,
          styles.brandFull,
          isMac && Platform.OS === 'web' ? ({ WebkitAppRegion: 'drag' } as any) : null,
        ]}
      >
        <BrandLogo size={22} wordmark />
      </View>

      {/* ── New session (styled like a nav row) ── */}
      <Pressable
        onPress={startSession}
        // @ts-ignore web hover
        {...(Platform.OS === 'web' ? { className: 'oa-side-row' } : {})}
        style={[styles.newRow, styles.newRowFull]}
        accessibilityRole="button"
        accessibilityLabel="New session"
      >
        <Feather name="edit-3" size={16} color={colors.accent} />
        <Text style={styles.newRowText}>New session</Text>
      </Pressable>

      {/* ── Workspace nav ── */}
      <View style={styles.nav}>
        <Animated.View pointerEvents="none" style={[styles.rail, { height: ROW_H }, railStyle]}>
          <View style={styles.railFill} />
        </Animated.View>
        {NAV.map((item) => {
          const isActive = navIndex >= 0 && item.match === activeSeg;
          return (
            <Pressable
              key={item.href}
              onPress={() => go(item.href)}
              // @ts-ignore web hover
              {...(Platform.OS === 'web' ? { className: 'oa-side-row' } : {})}
              style={[
                styles.row,
                { height: ROW_H, marginBottom: ROW_GAP },
                styles.rowFull,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={item.label}
            >
              <Feather
                name={item.icon}
                size={16}
                color={isActive ? colors.accent : colors.textSecondary}
              />
              <Text
                style={[styles.rowLabel, isActive && styles.rowLabelActive]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Recent feed ── */}
      <RecentFeed activeSeg={activeSeg} onNavigate={onNavigate} />

      {/* ── Footer: agent (left) + Settings/System (right) ── */}
      <View style={[styles.footer, styles.footerFull]}>
        <View style={styles.footerRule} />
        {isReconnecting && (
          <View style={styles.reconnectRow}>
            <View
              style={styles.reconnectDot}
              {...(Platform.OS === 'web' ? { className: 'oa-pulse' } : {})}
            />
            <Text style={styles.reconnectText} numberOfLines={1}>Reconnecting…</Text>
          </View>
        )}
        <View style={styles.footerRow}>
          <AgentSwitcher variant="compact" />
          <FooterIcon icon="settings" label="Settings" active={activeSeg === 'settings'} onPress={() => go('/settings')} />
          <FooterIcon icon="activity" label="System" active={activeSeg === 'system'} onPress={() => go('/system')} />
        </View>
      </View>
    </View>
  );
}

function FooterIcon({
  icon,
  label,
  active,
  onPress,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      // @ts-ignore web hover
      {...(Platform.OS === 'web' ? { className: 'oa-side-row' } : {})}
      style={[styles.footerBtn, active && styles.footerBtnActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Feather name={icon} size={18} color={active ? colors.accent : colors.textSecondary} />
    </Pressable>
  );
}

// ── Recent activities ──

function RecentFeed({ activeSeg, onNavigate }: { activeSeg: string; onNavigate?: () => void }) {
  const router = useRouter();
  const segments = useSegments();
  const params = useGlobalSearchParams<{ id?: string }>();
  const isConnected = useConnection((s) => s.isConnected);

  // A single run detail (``/runs/{id}``) is open: highlight its feed row
  // (and suppress the chat row's selection, since the active session isn't
  // what's on screen). ``runs`` isn't a known nav segment, so the rail
  // stays hidden — selection lives entirely on the row.
  const onRunsRoute = segments.some((s) => s === 'runs');
  const activeRunId =
    onRunsRoute && typeof params.id === 'string' ? params.id : null;

  const sessions = useChat((s) => s.sessions);
  const activeSessionId = useChat((s) => s.activeSessionId);
  const removeSession = useChat((s) => s.removeSession);
  const confirm = useConfirm();

  // Delete a chat (and the sub-agent sessions it spawned) from the Recent
  // feed, behind a confirmation dialog. This is the primary, always-visible
  // surface, so the affordance lives here rather than only in the chat-screen
  // session switcher.
  const confirmAndRemove = useCallback(async (id: string, title: string) => {
    const ok = await confirm({
      title: 'Delete chat',
      message:
        `Delete "${title || 'this chat'}"? This permanently removes the ` +
        'conversation and any sub-agent sessions it spawned. This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      confirmVariant: 'danger',
    });
    if (ok) removeSession(id);
  }, [confirm, removeSession]);

  const workflowRuns = useActivity((s) => s.workflowRuns);
  const taskRuns = useActivity((s) => s.taskRuns);
  const eventRuns = useActivity((s) => s.eventRuns);
  const filters = useActivity((s) => s.filters);
  const setFilter = useActivity((s) => s.setFilter);
  const loadActivity = useActivity((s) => s.loadActivity);

  useEffect(() => {
    if (!isConnected) return;
    void loadActivity();
    const off1 = useEvents.getState().subscribe('workflow', () => void loadActivity());
    const off2 = useEvents.getState().subscribe('scheduled_task', () => void loadActivity());
    // Every event delivery (received → running → success/failed) broadcasts an
    // 'event' resource event, so a webhook trigger refreshes the feed live.
    const off3 = useEvents.getState().subscribe('event', () => void loadActivity());
    return () => { off1(); off2(); off3(); };
  }, [isConnected, loadActivity]);

  const onChat = activeSeg === 'chat' && !onRunsRoute;
  const allOn = filters.chat && filters.workflow && filters.task && filters.event;

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    if (filters.chat) {
      for (const s of sessions) {
        // Sub-agent (delegation) sessions are navigable only from their
        // parent's transcript card — never the recent feed.
        if (isHiddenChildSession(s)) continue;
        items.push({
          key: `c-${s.id}`,
          icon: 'message-circle',
          label: s.title || 'New Chat',
          ts: toMs(s.lastActiveAt ?? lastMsgTs(s.messages)),
          active: onChat && s.id === activeSessionId,
          dotColor: s.isProcessing ? colors.warning : s.hasUnread ? colors.accent : null,
          onPress: () => {
            useChat.getState().setActiveSession(s.id);
            router.push('/chat' as any);
            onNavigate?.();
          },
          onDelete: () => confirmAndRemove(s.id, s.title || 'New Chat'),
        });
      }
    }
    if (filters.workflow) {
      // Same glyph as the top-nav "Workflows" button (NAV) so a workflow reads
      // identically wherever it appears in the sidebar.
      for (const r of workflowRuns) items.push(runItem(r, 'w', 'git-branch', 'workflows', router, activeRunId, onNavigate));
    }
    if (filters.task) {
      for (const r of taskRuns) items.push(runItem(r, 't', 'clock', 'tasks', router, activeRunId, onNavigate));
    }
    if (filters.event) {
      // Bound prompt events can produce multiple deliveries for the same
      // session. Recent should show that live run once, while the event's
      // dedicated history keeps every inbound delivery.
      for (const r of compactBoundEventRuns(eventRuns)) {
        items.push(runItem(r, 'e', 'zap', 'events', router, activeRunId, onNavigate));
      }
    }
    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, FEED_MAX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, workflowRuns, taskRuns, eventRuns, filters, onChat, activeSessionId, activeRunId]);

  return (
    <View style={styles.recent}>
      <View style={styles.recentDivider} />
      <View style={styles.recentHeader}>
        <Text style={styles.recentHeading}>Recent</Text>
        {/* Same shared PopupMenu as the delete actions — here hosting the
            multi-select activity filter (toggles stay open; dismiss on scrim). */}
        <PopupMenu
          triggerIcon="sliders"
          triggerSize={13}
          triggerColor={!allOn ? colors.accent : colors.textMuted}
          triggerStyle={[styles.filterBtn, !allOn && styles.filterBtnActive]}
          accessibilityLabel="Filter recent activity"
          menuWidth={176}
        >
          {() => FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key, !filters[f.key])}
              style={styles.filterItem}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: filters[f.key] }}
              // @ts-ignore web hover
              {...(Platform.OS === 'web' ? { className: 'oa-side-row' } : {})}
            >
              <Feather name={f.icon} size={13} color={colors.textSecondary} />
              <Text style={styles.filterItemText}>{f.label}</Text>
              <Feather
                name={filters[f.key] ? 'check-square' : 'square'}
                size={14}
                color={filters[f.key] ? colors.accent : colors.textMuted}
              />
            </Pressable>
          ))}
        </PopupMenu>
      </View>

      <ScrollView style={styles.recentScroll} contentContainerStyle={styles.recentContent} showsVerticalScrollIndicator={false}>
        {feed.length === 0 ? (
          <Text style={styles.recentEmpty}>Nothing here yet.</Text>
        ) : (
          feed.map((it) => (
            <Pressable
              key={it.key}
              onPress={it.onPress}
              // @ts-ignore web hover + entrance
              {...(Platform.OS === 'web' ? { className: 'oa-side-row oa-fade-in' } : {})}
              style={[styles.feedRow, it.active && styles.feedRowActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: !!it.active }}
              accessibilityLabel={it.label}
            >
              <Feather name={it.icon} size={13} color={it.active ? colors.accent : colors.textMuted} />
              <Text style={[styles.feedText, it.active && styles.feedTextActive]} numberOfLines={1}>
                {it.label}
              </Text>
              {it.ts ? <Text style={styles.feedMeta}>{relTime(it.ts)}</Text> : null}
              {it.dotColor ? <View style={[styles.feedDot, { backgroundColor: it.dotColor }]} /> : null}
              {it.onDelete ? (
                <PopupMenu
                  triggerIcon="more-horizontal"
                  triggerSize={15}
                  triggerColor={colors.textMuted}
                  triggerStyle={styles.feedMenuBtn}
                  accessibilityLabel={`Options for ${it.label}`}
                  items={[
                    { label: 'Delete', icon: 'trash-2', destructive: true, onPress: it.onDelete },
                  ]}
                />
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ── helpers ──

function compactBoundEventRuns(runs: ActivityRun[]): ActivityRun[] {
  const byKey = new Map<string, ActivityRun>();
  for (const run of runs) {
    const key = run.sessionId
      ? `session:${run.parentId}:${run.sessionId}`
      : `delivery:${run.id}`;
    const prev = byKey.get(key);
    if (!prev || toMs(run.startedAt) > toMs(prev.startedAt)) {
      byKey.set(key, run);
    }
  }
  return [...byKey.values()];
}

function runItem(
  r: ActivityRun,
  prefix: string,
  icon: IconName,
  kind: 'workflows' | 'tasks' | 'events',
  router: ReturnType<typeof useRouter>,
  activeRunId: string | null,
  onNavigate?: () => void,
): FeedItem {
  // A Recent row points at one specific firing, so open that single run
  // (``/runs/{id}``) — not the parent's whole history. This route lives at
  // the drawer root, so it neither selects the Scheduled / Workflows / Events
  // tab nor pushes a back-button onto their stacks. An event delivery is a
  // run like any other: same screen, same header, same transcript.
  const runKind =
    kind === 'workflows' ? 'workflow' : kind === 'events' ? 'event' : 'task';
  const params = new URLSearchParams({
    kind: runKind,
    parentId: r.parentId,
    name: r.parentName,
  });
  const target = `/runs/${encodeURIComponent(r.id)}?${params.toString()}`;
  return {
    key: `${prefix}-${r.id}`,
    icon,
    label: r.parentName,
    ts: toMs(r.startedAt),
    active: activeRunId === r.id,
    dotColor: runStatusColor(r.status),
    onPress: () => {
      router.push(target as any);
      onNavigate?.();
    },
  };
}

function runStatusColor(status: string): string {
  if (status === 'success') return colors.success;
  if (status === 'failed' || status === 'rejected') return colors.error;
  if (status === 'running' || status === 'received') return colors.warning;
  return colors.textMuted;
}

function lastMsgTs(messages: { timestamp: number }[]): number {
  const last = messages[messages.length - 1];
  return last ? Math.floor(last.timestamp / 1000) : 0;
}

function toMs(t?: number | null): number {
  if (!t) return 0;
  return t < 1e12 ? t * 1000 : t;
}

function relTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return `${Math.floor(d / 30)}mo`;
}

const styles = StyleSheet.create({
  root: {
    // Fill the drawer container (its width is set by the navigator), so
    // the panel never leaves a gap when the drawer is wider than a fixed
    // width. The divider lives on the content's left edge, not here.
    backgroundColor: colors.sidebar,
    paddingVertical: spacing.lg,
    height: '100%',
    width: '100%',
  },
  rootFull: { paddingHorizontal: spacing.md },
  // macOS: drop the top padding so the window-control strip sits flush at
  // the very top.
  rootMac: { paddingTop: 0 },
  // The macOS strip hosting the custom WindowControls (drag handle). Spans
  // the sidebar full-bleed (negative margins applied inline) so the
  // controls land ~14px from the window edge.
  macControls: { height: 36, position: 'relative', marginBottom: spacing.xs },

  // Brand
  brand: { marginBottom: spacing.lg },
  brandFull: { gap: spacing.sm },

  // New session row
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.primaryLight,
  },
  newRowFull: { gap: 11, paddingHorizontal: spacing.md, height: ROW_H, marginBottom: spacing.md },
  newRowText: { fontFamily: font.sans, fontSize: 14, color: colors.text, fontWeight: '600' },

  // Nav
  nav: { position: 'relative' },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  railFill: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    width: 2.5,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    ...(Platform.OS === 'web' ? ({ boxShadow: `0 0 8px ${colors.accentGlow}` } as any) : {}),
  },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md },
  rowFull: { gap: 11, paddingHorizontal: spacing.md },
  rowLabel: { fontFamily: font.sans, fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  rowLabelActive: { color: colors.text, fontWeight: '600' },

  // Recent
  recent: { flex: 1, minHeight: 0, marginTop: spacing.md, position: 'relative' },
  recentDivider: { height: 1, backgroundColor: colors.borderLight, marginBottom: spacing.sm },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs, marginBottom: spacing.xs },
  recentHeading: {
    fontFamily: font.sans,
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: tracking.wider,
  },
  filterBtn: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent' },
  filterBtnActive: { borderColor: colors.border, backgroundColor: colors.primaryLight },

  // Filter dropdown rows (hosted in the shared PopupMenu)
  filterItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.sm },
  filterItemText: { flex: 1, fontFamily: font.sans, fontSize: 12.5, color: colors.text },

  recentScroll: { flex: 1 },
  recentContent: { gap: 1, paddingBottom: spacing.sm },
  recentEmpty: { fontFamily: font.sans, fontSize: 12, color: colors.textMuted, fontStyle: 'italic', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  feedRowActive: { backgroundColor: colors.surface, borderColor: colors.border },
  feedText: { flex: 1, minWidth: 0, fontFamily: font.sans, fontSize: 12.5, color: colors.textSecondary },
  feedTextActive: { color: colors.text, fontWeight: '600' },
  feedMeta: { fontFamily: font.mono, fontSize: 9.5, color: colors.textMuted },
  feedDot: { width: 6, height: 6, borderRadius: radius.pill },
  feedMenuBtn: {
    width: 22, height: 22, marginLeft: 2,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm,
  },

  // Footer (icons only)
  footer: { marginTop: 'auto' },
  footerFull: { paddingTop: spacing.sm },
  footerRule: { height: 1, backgroundColor: colors.borderLight, marginBottom: spacing.sm },
  // Reconnecting hint — sits right above the agent row (see [[isReconnecting]]).
  reconnectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: spacing.xs, paddingBottom: spacing.sm,
  },
  reconnectDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning },
  reconnectText: {
    fontSize: 11, color: colors.textSecondary, fontFamily: font.mono, letterSpacing: 0.3,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  footerBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
  footerBtnActive: { backgroundColor: colors.surface, borderColor: colors.border },
});
