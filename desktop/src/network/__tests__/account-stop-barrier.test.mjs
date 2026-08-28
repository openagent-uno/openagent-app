import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountStopBarrier } from '../../../dist/services/account-stop-barrier.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('A→B→A waits for A teardown while an unrelated B may start', async () => {
  const barrier = createAccountStopBarrier();
  const teardown = deferred();
  const events = [];

  const stopA = barrier.run('account-a', async () => {
    events.push('stop-a:begin');
    await teardown.promise;
    events.push('stop-a:end');
  });
  const restartA = (async () => {
    await barrier.wait('account-a');
    events.push('start-a');
  })();
  await barrier.wait('account-b');
  events.push('start-b');

  await Promise.resolve();
  assert.deepEqual(events, ['stop-a:begin', 'start-b']);

  teardown.resolve();
  await Promise.all([stopA, restartA]);
  assert.deepEqual(events, ['stop-a:begin', 'start-b', 'stop-a:end', 'start-a']);
});

test('a start waits for every stop queued for the same account', async () => {
  const barrier = createAccountStopBarrier();
  const first = deferred();
  const second = deferred();
  const events = [];

  const stopOne = barrier.run('account-a', async () => {
    await first.promise;
    events.push('stop-1');
  });
  const stopTwo = barrier.run('account-a', async () => {
    await second.promise;
    events.push('stop-2');
  });
  const start = (async () => {
    await barrier.wait('account-a');
    events.push('start');
  })();

  first.resolve();
  await stopOne;
  assert.deepEqual(events, ['stop-1']);
  second.resolve();
  await Promise.all([stopTwo, start]);
  assert.deepEqual(events, ['stop-1', 'stop-2', 'start']);
});
