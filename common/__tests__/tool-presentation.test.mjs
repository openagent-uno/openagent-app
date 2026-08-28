import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toolPhase } from '../types.ts';
import {
  compactToolFallback,
  legacyToolInfoFromText,
  toolInfoFromInvocationDetail,
  toolInfoFromSummary,
} from '../tool-presentation.ts';

test('compact transcript summary becomes a completed collapsed-card model without result JSON', () => {
  const info = toolInfoFromSummary({
    id: 'tool-1',
    tool_call_id: 'call-1',
    tool_server: 'builtin',
    tool_name: 'shell_execute',
    status: 'success',
    child_run_id: null,
    child_session_id: null,
    completeness: 'complete',
  });

  assert.ok(info);
  assert.equal(toolPhase(info), 'completed');
  assert.equal(info.result, '');
  assert.deepEqual(info.tool_args, {});
  assert.equal(info.tool_invocation_id, 'tool-1');
  assert.equal(info.tool_call_id, 'call-1');
  assert.equal(info.tool_server, 'builtin');
  assert.equal(info.server, 'builtin');
});

test('summary preserves child run and session links used by specialized cards', () => {
  const info = toolInfoFromSummary({
    id: 'tool-child',
    tool_name: 'delegate_task',
    status: 'running',
    child_run_id: 'run-child',
    child_session_id: 'session-child',
  });

  assert.ok(info);
  assert.equal(info.child_run_id, 'run-child');
  assert.equal(info.child_session_id, 'session-child');
});

test('summary lifecycle maps running and failed tools without using message text', () => {
  const running = toolInfoFromSummary({
    id: 'tool-running',
    tool_name: 'fetch_data',
    status: 'running',
  });
  const failed = toolInfoFromSummary({
    id: 'tool-failed',
    tool_name: 'fetch_data',
    status: 'error',
  });

  assert.ok(running);
  assert.ok(failed);
  assert.equal(toolPhase(running), 'running');
  assert.equal(toolPhase(failed), 'error');
  assert.equal(failed.result, 'Tool execution failed');
});

test('authorized detail uses the same card adapter and bounds a large result preview', () => {
  const detail = toolInfoFromInvocationDetail({
    id: 'tool-detail',
    tool_call_id: 'call-detail',
    root_kind: 'chat',
    root_id: 'session-1',
    tool_server: 'files',
    tool_name: 'read_file',
    status: 'success',
    args_safe: { path: '/tmp/example' },
    result_safe: 'x'.repeat(20_000),
    error_safe: null,
    child_session_id: null,
    sensitivity: 'safe',
    completeness: 'complete',
    artifacts: [],
    created_at: '2026-08-28T10:00:00Z',
  });

  assert.ok(detail);
  assert.equal(toolPhase(detail), 'completed');
  assert.deepEqual(detail.tool_args, { path: '/tmp/example' });
  assert.match(detail.result, /result truncated in chat/);
  assert.ok(detail.result.length < 13_000);
});

test('legacy compatibility parses only bounded ToolExecution envelopes', () => {
  assert.equal(legacyToolInfoFromText('{"tool_name":"shell_execute","result":"ok"}')?.tool_name, 'shell_execute');
  assert.equal(legacyToolInfoFromText(`{"payload":"${'x'.repeat(70_000)}"}`), undefined);
});

test('raw normalized tool output is replaced by a safe compact fallback title', () => {
  const hugeJson = JSON.stringify({ records: ['sensitive'.repeat(30_000)] });
  assert.equal(compactToolFallback(hugeJson), 'Tool result');
  assert.equal(compactToolFallback('Using shell_execute…'), 'Using shell_execute…');
  assert.ok(compactToolFallback(`Using ${'x'.repeat(300)}`).length <= 120);
});
