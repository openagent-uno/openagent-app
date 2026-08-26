import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchNavigationIntent } from '../search-navigation.ts';

test('maps every canonical SearchTarget to one existing route', () => {
  const cases = [
    [{ kind: 'chat', session_id: 's' }, '/(tabs)/chat'],
    [{ kind: 'chat_message', session_id: 's', message_id: 'm' }, '/(tabs)/chat'],
    [{ kind: 'chat_tool', session_id: 's', message_id: 'm', tool_invocation_id: 't' }, '/(tabs)/chat'],
    [{ kind: 'workflow_definition', workflow_id: 'w', node_id: 'n', field: 'prompt' }, '/(tabs)/workflows/[id]'],
    [{ kind: 'workflow_run', workflow_id: 'w', run_id: 'r', trace_step_id: 'step' }, '/(tabs)/runs/[id]'],
    [{ kind: 'scheduled_definition', task_id: 'task', field: 'schedule' }, '/(tabs)/tasks/[id]'],
    [{ kind: 'scheduled_run', task_id: 'task', run_id: 'r', message_id: 'm' }, '/(tabs)/runs/[id]'],
    [{ kind: 'event_definition', event_id: 'e', field: 'name' }, '/(tabs)/events/[id]'],
    [{ kind: 'event_delivery', event_id: 'e', delivery_id: 'd', tool_invocation_id: 't' }, '/(tabs)/runs/[id]'],
  ];
  for (const [target, pathname] of cases) {
    assert.equal(searchNavigationIntent(target).pathname, pathname, target.kind);
  }
});

test('keeps canonical ids and converts only route parameter names', () => {
  const intent = searchNavigationIntent({
    kind: 'workflow_run',
    workflow_id: 'workflow/one',
    run_id: 'run?two',
    trace_step_id: 'step-three',
    tool_invocation_id: 'tool-four',
  }, {
    kind: 'event_delivery',
    event_id: 'event-five',
    delivery_id: 'delivery-six',
    title: 'Inbound event',
  });
  assert.deepEqual(intent.params, {
    id: 'run?two',
    kind: 'workflow',
    parentId: 'workflow/one',
    traceStep: 'step-three',
    toolInvocation: 'tool-four',
    causedByEvent: 'event-five',
    causedByDelivery: 'delivery-six',
    causedByTitle: 'Inbound event',
  });
});
