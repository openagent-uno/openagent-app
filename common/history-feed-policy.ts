import type { ActivityItem, ActivityKind } from './unified-history';

// Keep the wire order stable for request fingerprints. This mirrors the
// frozen ACTIVITY_KINDS contract without a runtime import, so the repository's
// zero-build node test runner can execute this policy module directly.
const ORDERED_ACTIVITY_KINDS: readonly ActivityKind[] = [
  'chat', 'delegated_session', 'workflow_run', 'scheduled_run', 'event_delivery',
];

/** The sidebar filters are presentation names; the gateway accepts canonical
 * activity kinds. Delegated sessions are intentionally absent: they navigate
 * from their parent transcript and would consume page slots without ever
 * rendering a top-level row. Global search pages them independently. */
export interface HistoryFeedFilters {
  chat: boolean;
  workflow: boolean;
  task: boolean;
  event: boolean;
}

/** Ten gateway pages is enough for fast local navigation without letting a
 * long-lived renderer retain an unbounded account history. Older activity is
 * still reachable through the independently paged global search endpoint. */
export const MAX_RETAINED_HISTORY_ITEMS = 600;
export const MAX_RETAINED_SEARCH_RESULTS = 400;

export function historyKindsForFilters(filters: HistoryFeedFilters): ActivityKind[] {
  const kinds: ActivityKind[] = [];
  if (filters.chat) kinds.push('chat');
  if (filters.workflow) kinds.push('workflow_run');
  if (filters.task) kinds.push('scheduled_run');
  if (filters.event) kinds.push('event_delivery');
  return kinds;
}

export function normalizeHistoryKinds(kinds: readonly ActivityKind[]): ActivityKind[] {
  const selected = new Set(kinds);
  return ORDERED_ACTIVITY_KINDS.filter((kind) => selected.has(kind));
}

export function historyKindsKey(kinds: readonly ActivityKind[]): string {
  return normalizeHistoryKinds(kinds).join(',');
}

export function historyCoversAllKinds(kinds: readonly ActivityKind[]): boolean {
  return historyKindsKey(kinds) === ORDERED_ACTIVITY_KINDS.join(',');
}

/** A response may only mutate the store that issued it. Account switches,
 * reconnect refreshes and filter changes all advance the generation/key. */
export function historyRequestKey(
  accountId: string | null,
  kinds: readonly ActivityKind[],
  generation: number,
): string {
  return `${accountId ?? ''}|${historyKindsKey(kinds)}|${generation}`;
}

export function mergeBoundedHistory(
  previous: readonly ActivityItem[],
  incoming: readonly ActivityItem[],
  reset: boolean,
  maxItems = MAX_RETAINED_HISTORY_ITEMS,
): ActivityItem[] {
  const byId = new Map<string, ActivityItem>();
  if (!reset) {
    for (const item of previous) byId.set(item.id, item);
  }
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, Math.max(0, maxItems));
}

/** V2 owns session discovery. Legacy servers still need the old flat list. */
export function sessionDiscoveryStrategy(historyVersion?: number): 'history_page' | 'legacy_sessions' {
  return historyVersion === 2 ? 'history_page' : 'legacy_sessions';
}
