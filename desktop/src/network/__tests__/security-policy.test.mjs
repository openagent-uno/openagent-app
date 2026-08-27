import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAllowedExternalUrl,
  isAllowedRendererNavigation,
  PRODUCTION_CSP,
} from '../../../dist/security-policy.js';

test('renderer navigation stays on the app origin', () => {
  const origin = 'http://127.0.0.1:43123';
  assert.equal(isAllowedRendererNavigation(`${origin}/views/abc?x=1`, origin), true);
  assert.equal(isAllowedRendererNavigation('https://example.com/phish', origin), false);
  assert.equal(isAllowedRendererNavigation('javascript:alert(1)', origin), false);
});

test('external URL allowlist rejects executable and privileged schemes', () => {
  assert.equal(isAllowedExternalUrl('https://openagent.uno/docs'), true);
  assert.equal(isAllowedExternalUrl('mailto:hello@openagent.uno'), true);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedExternalUrl('openagent://ticket'), false);
  assert.equal(isAllowedExternalUrl('https://user:secret@example.com/private'), false);
  assert.equal(isAllowedExternalUrl('https://example.com/\u0000bad'), false);
});

test('production CSP disables eval, objects and framing', () => {
  assert.match(PRODUCTION_CSP, /object-src 'none'/);
  assert.match(PRODUCTION_CSP, /frame-ancestors 'none'/);
  assert.doesNotMatch(PRODUCTION_CSP, /unsafe-eval/);
  assert.doesNotMatch(PRODUCTION_CSP, /img-src[^;]*https:/);
});
