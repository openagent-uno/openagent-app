// Hand-rolled tiny test harness — no jest in this electron app.
// Run with: node src/network/__tests__/session-dialer.test.mjs (after `npx tsc`).
//
// Covers the pool's recovery from a connection that died without telling us —
// the agent restarting is the everyday cause. Before this, the pool handed out
// the dead connection forever and the app sat on "Reconnecting…" until it was
// relaunched.
import assert from 'node:assert/strict';
import { SessionDialer } from '../../../dist/network/session-dialer.js';

const NODE_ID = 'b'.repeat(64);
const CERT = new Uint8Array([9, 9, 9, 9]);

function makeStream() {
  return {
    send: { writeAll: async () => {}, finish: async () => {} },
    recv: {},
  };
}

/** A connection that works, or one that has silently died: iroh only tells
 *  us when the connection is next used, which is ``openBi``. */
function makeConnection({ dead = false } = {}) {
  return {
    dead,
    openBiCalls: 0,
    closed: false,
    async openBi() {
      this.openBiCalls += 1;
      if (this.dead) throw new Error('connection closed by peer');
      return makeStream();
    },
    close() {
      this.closed = true;
    },
  };
}

function makeEndpoint(connections) {
  const queue = [...connections];
  const endpoint = {
    dials: 0,
    async connect() {
      endpoint.dials += 1;
      const next = queue.shift();
      if (!next) throw new Error('no more fake connections');
      return next;
    },
    nodeId: () => 'self',
  };
  return endpoint;
}

// 1. A healthy connection is pooled — a second stream must not redial.
{
  const live = makeConnection();
  const endpoint = makeEndpoint([live]);
  const dialer = new SessionDialer(endpoint, CERT);

  await dialer.openGatewayStream(NODE_ID);
  await dialer.openGatewayStream(NODE_ID);

  assert.equal(endpoint.dials, 1, 'a healthy connection must be reused, not redialled');
  assert.equal(live.openBiCalls, 2);
}

// 2. A pooled connection that has died is evicted, closed, and redialled once.
{
  const dead = makeConnection({ dead: true });
  const fresh = makeConnection();
  const endpoint = makeEndpoint([dead, fresh]);
  const dialer = new SessionDialer(endpoint, CERT);

  // First call dials the (already doomed) connection and fails: nothing
  // pooled yet, so there is no stale entry to blame.
  await assert.rejects(() => dialer.openGatewayStream(NODE_ID), /connection closed by peer/);
  assert.equal(endpoint.dials, 1, 'a fresh dial must not be retried — that failure is real');

  // It was pooled by that attempt. The next caller finds the corpse, evicts
  // it, redials, and succeeds — this is the recovery that was missing.
  const stream = await dialer.openGatewayStream(NODE_ID);
  assert.equal(stream.targetNodeId, NODE_ID);
  assert.equal(endpoint.dials, 2, 'the dead pooled connection must be redialled');
  assert.equal(dead.closed, true, 'the dead connection must be closed on eviction');
  assert.equal(fresh.openBiCalls, 1);
}

// 3. When the redial is also dead, the caller hears about it — one retry,
//    never a loop.
{
  const dead = makeConnection({ dead: true });
  const alsoDead = makeConnection({ dead: true });
  const endpoint = makeEndpoint([dead, alsoDead]);
  const dialer = new SessionDialer(endpoint, CERT);

  await assert.rejects(() => dialer.openGatewayStream(NODE_ID));
  await assert.rejects(() => dialer.openGatewayStream(NODE_ID), /connection closed by peer/);
  assert.equal(endpoint.dials, 2, 'exactly one redial per call, no retry storm');
}

// 4. Concurrent callers on the same corpse share one redial rather than each
//    opening a connection of their own.
{
  const dead = makeConnection({ dead: true });
  const fresh = makeConnection();
  const endpoint = makeEndpoint([dead, fresh]);
  const dialer = new SessionDialer(endpoint, CERT);

  await assert.rejects(() => dialer.openGatewayStream(NODE_ID));
  const [a, b] = await Promise.all([
    dialer.openGatewayStream(NODE_ID),
    dialer.openGatewayStream(NODE_ID),
  ]);

  assert.equal(a.targetNodeId, NODE_ID);
  assert.equal(b.targetNodeId, NODE_ID);
  assert.equal(endpoint.dials, 2, 'two concurrent callers must not dial twice over');
}

// 5. The cert prefix still rides on the stream after a redial.
{
  const dead = makeConnection({ dead: true });
  const fresh = makeConnection();
  const written = [];
  fresh.openBi = async () => ({
    send: { writeAll: async (buf) => { written.push(buf); }, finish: async () => {} },
    recv: {},
  });
  const endpoint = makeEndpoint([dead, fresh]);
  const dialer = new SessionDialer(endpoint, CERT);

  await assert.rejects(() => dialer.openGatewayStream(NODE_ID));
  await dialer.openGatewayStream(NODE_ID);

  assert.equal(written.length, 1);
  const prefix = written[0];
  assert.equal(prefix.length, 4 + CERT.length);
  assert.equal(new DataView(prefix.buffer, prefix.byteOffset).getUint32(0, false), CERT.length);
  assert.deepEqual(Array.from(prefix.slice(4)), Array.from(CERT));
}

console.log('session-dialer: all tests passed');
