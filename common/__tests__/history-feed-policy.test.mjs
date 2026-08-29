import assert from 'node:assert/strict';
import test from 'node:test';

import {
  historyCoversAllKinds,
  historyKindsForFilters,
  historyRequestKey,
  mergeBoundedHistory,
  sessionDiscoveryStrategy,
} from '../history-feed-policy.ts';

function item(id, occurredAt) {
  return {
    id,
    kind: 'chat',
    resource_id: id,
    title: id,
    occurred_at: occurredAt,
    updated_at: occurredAt,
    live: false,
    completeness: 'complete',
  };
}

test('maps sidebar filters to canonical server kinds', () => {
  const all = historyKindsForFilters({ chat: true, workflow: true, task: true, event: true });
  assert.deepEqual(all, [
    'chat', 'workflow_run', 'scheduled_run', 'event_delivery',
  ]);
  assert.equal(historyCoversAllKinds(all), false);
  assert.equal(historyCoversAllKinds([
    'chat', 'delegated_session', 'workflow_run', 'scheduled_run', 'event_delivery',
  ]), true);
  assert.deepEqual(
    historyKindsForFilters({ chat: false, workflow: true, task: false, event: true }),
    ['workflow_run', 'event_delivery'],
  );
  assert.deepEqual(
    historyKindsForFilters({ chat: false, workflow: false, task: false, event: false }),
    [],
  );
});

test('pagination deduplicates, sorts and caps retained history', () => {
  const first = [item('a', '2026-01-03T00:00:00Z'), item('b', '2026-01-02T00:00:00Z')];
  const next = [item('b', '2026-01-04T00:00:00Z'), item('c', '2026-01-01T00:00:00Z')];
  assert.deepEqual(
    mergeBoundedHistory(first, next, false, 3).map((entry) => entry.id),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(
    mergeBoundedHistory(first, next, true, 2).map((entry) => entry.id),
    ['b', 'c'],
  );
});

test('filter, reconnect generation and account changes invalidate stale responses', () => {
  const initial = historyRequestKey('account-a', ['chat'], 1);
  assert.notEqual(initial, historyRequestKey('account-a', ['workflow_run'], 1));
  assert.notEqual(initial, historyRequestKey('account-a', ['chat'], 2));
  assert.notEqual(initial, historyRequestKey('account-b', ['chat'], 1));
  assert.equal(initial, historyRequestKey('account-a', ['chat', 'chat'], 1));
});

test('reconnect discovery never requests the flat session list on v2', () => {
  assert.equal(sessionDiscoveryStrategy(2), 'history_page');
  assert.equal(sessionDiscoveryStrategy(1), 'legacy_sessions');
  assert.equal(sessionDiscoveryStrategy(undefined), 'legacy_sessions');
});
