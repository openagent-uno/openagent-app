import assert from 'node:assert/strict';
import test from 'node:test';

import { SessionDialer } from '../../../dist/network/session-dialer.js';

const TARGET = 'a'.repeat(64);
const CERT = new Uint8Array([0x11, 0x22, 0x33]);

function workingConnection() {
  const prefixes = [];
  let openCount = 0;
  let closed = false;
  return {
    prefixes,
    get openCount() { return openCount; },
    get closed() { return closed; },
    async openBi() {
      openCount += 1;
      return {
        send: {
          async writeAll(value) { prefixes.push(new Uint8Array(value)); },
          async finish() {},
        },
        recv: { async read() { return null; } },
      };
    },
    close() { closed = true; },
  };
}

function deadConnection(message) {
  let openCount = 0;
  let closed = false;
  return {
    get openCount() { return openCount; },
    get closed() { return closed; },
    async openBi() {
      openCount += 1;
      throw new Error(message);
    },
    close() { closed = true; },
  };
}

test('evicts a dropped cached Iroh connection and redials exactly once', async () => {
  const dropped = deadConnection('connection lost');
  const replacement = workingConnection();
  const connections = [dropped, replacement];
  let dialCount = 0;
  const endpoint = {
    nodeId: () => 'self',
    async connect() {
      dialCount += 1;
      return connections.shift();
    },
  };
  const dialer = new SessionDialer(endpoint, CERT);

  const stream = await dialer.openGatewayStream(TARGET);

  assert.equal(stream.targetNodeId, TARGET);
  assert.equal(dialCount, 2, 'one failed cached stream gets one redial');
  assert.equal(dropped.openCount, 1);
  assert.equal(dropped.closed, true, 'the dead cached connection is closed');
  assert.equal(replacement.openCount, 1);
  assert.deepEqual(
    Array.from(replacement.prefixes[0]),
    [0, 0, 0, CERT.length, ...CERT],
    'the replacement stream receives the device-cert prefix',
  );

  await dialer.openGatewayStream(TARGET);
  assert.equal(dialCount, 2, 'the healthy replacement remains pooled');
  assert.equal(replacement.openCount, 2);
  await dialer.close();
});

test('a failed replacement is evicted without an unbounded redial loop', async () => {
  const first = deadConnection('first connection lost');
  const second = deadConnection('replacement also lost');
  const connections = [first, second];
  let dialCount = 0;
  const endpoint = {
    nodeId: () => 'self',
    async connect() {
      dialCount += 1;
      return connections.shift();
    },
  };
  const dialer = new SessionDialer(endpoint, CERT);

  await assert.rejects(
    dialer.openGatewayStream(TARGET),
    /replacement also lost/,
  );
  assert.equal(dialCount, 2, 'only the initial dial and one redial are attempted');
  assert.equal(first.closed, true);
  assert.equal(second.closed, true);
});
