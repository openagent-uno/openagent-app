import assert from 'node:assert/strict';
import test from 'node:test';

import { selectAgentForConnection } from '../../../dist/network/agent-selection.js';

const agents = [
  { handle: 'first', nodeId: 'node-1' },
  { handle: 'Friday', nodeId: 'node-2' },
];

test('onboarding without a target selects the first registered agent', () => {
  assert.equal(selectAgentForConnection(agents), agents[0]);
});

test('explicit reconnect is exact and never falls back to another agent', () => {
  assert.equal(selectAgentForConnection(agents, 'friday'), agents[1]);
  assert.equal(selectAgentForConnection(agents, 'renamed-or-removed'), undefined);
});
