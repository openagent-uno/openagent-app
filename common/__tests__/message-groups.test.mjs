import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { messageHeaderVisibility } from '../message-groups.ts';

const message = (role, author) => ({ role, author });

test('assistant headers appear once across text and tool activity', () => {
  assert.deepEqual(messageHeaderVisibility([
    message('assistant'),
    message('tool'),
    message('assistant'),
    message('compaction'),
    message('assistant'),
  ]), [true, false, false, false, true]);
});

test('an agent group beginning with tools labels its first assistant message', () => {
  assert.deepEqual(messageHeaderVisibility([
    message('user', { kind: 'human', handle: 'alex' }),
    message('tool'),
    message('tool'),
    message('assistant'),
    message('assistant'),
  ]), [true, false, false, true, false]);
  assert.deepEqual(messageHeaderVisibility([
    message('tool'),
    message('assistant'),
  ]), [false, true]);
});

test('human messages group by durable identity and reset after agent activity', () => {
  assert.deepEqual(messageHeaderVisibility([
    message('user', { kind: 'human', handle: 'alex', display: 'Alessandro' }),
    message('user', { kind: 'human', handle: 'alex', display: 'Alex' }),
    message('user', { kind: 'human', handle: 'bea' }),
    message('tool'),
    message('user', { kind: 'human', handle: 'bea' }),
  ]), [true, false, true, false, true]);
  assert.deepEqual(messageHeaderVisibility([
    message('user', { kind: 'human', handle: 'alex', display: 'Shared name' }),
    message('user', { kind: 'human', handle: 'bea', display: 'Shared name' }),
  ]), [true, true]);
});

test('agent-authored mission seeds do not consume the reply header', () => {
  assert.deepEqual(messageHeaderVisibility([
    message('user', { kind: 'agent', display: 'Mission' }),
    message('assistant', { kind: 'agent', display: 'Friday' }),
    message('assistant', { kind: 'agent', display: 'Friday' }),
  ]), [false, true, false]);
});

test('the first rendered message always identifies its speaker', () => {
  assert.deepEqual(messageHeaderVisibility([
    message('assistant'),
    message('assistant'),
  ]), [true, false]);
  assert.deepEqual(messageHeaderVisibility([
    message('user'),
    message('user'),
  ]), [true, false]);
});

test('streaming state changes do not split an assistant group', () => {
  assert.deepEqual(messageHeaderVisibility([
    { ...message('assistant'), streaming: true },
    message('tool'),
    { ...message('assistant'), streaming: false },
  ]), [true, false, false]);
});

test('the shared transcript renderer applies grouped headers and the user surface', () => {
  const source = readFileSync(
    new URL('../../universal/components/MessageList.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /messageHeaderVisibility\(visible\)/);
  assert.match(source, /testID="oa-agent-message-header"/);
  assert.match(source, /testID="oa-agent-message-label"/);
  assert.match(source, /testID="oa-human-message-header"/);
  assert.doesNotMatch(source, /assistantDot/);
  assert.match(source, /!showHeader && styles\.continuationActions/);
  assert.match(source, /!showHeader && styles\.continuationBody/);
  assert.doesNotMatch(source, /styles\.userRule/);
  const userBlock = source.match(
    /userBlock:\s*\{([\s\S]*?)\n\s*\},\n\s*userContinuation:/,
  )?.[1] || '';
  assert.match(userBlock, /backgroundColor: colors\.hover/);
  assert.match(userBlock, /borderRadius: radius\.md/);
  const assistantLabelBlock = source.match(
    /assistantLabel:\s*\{([\s\S]*?)\n\s*\},\n\s*modelText:/,
  )?.[1] || '';
  assert.match(assistantLabelBlock, /color: colors\.primary/);
});
