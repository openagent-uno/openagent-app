import assert from 'node:assert/strict';
import test from 'node:test';
import { transientAppleStapleFailure } from './canonical-app-build.mjs';

const observed = `Failed to staple your application with code: 68
Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."
The staple and validate action failed! Error 68.`;

test('recognises only the observed Apple ticket-delivery network failure', () => {
  assert.equal(transientAppleStapleFailure(observed), true);
  for (const log of [
    '', 'Failed to staple your application with code: 68',
    'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
    observed.replace('code: 68', 'code: 65'),
    observed.replace('Code=-1005', 'Code=-1009'),
    observed.replace('The network connection was lost.', 'The request timed out.'),
    'Failed to sign: no signing certificate',
    'Invalid credentials: HTTP 401',
    'electron-builder failed: missing input file',
  ]) assert.equal(transientAppleStapleFailure(log), false, log);
});

test('conflicting signing or credential errors prevent retry even beside the network error', () => {
  for (const failure of [
    'Failed to sign the application', 'No valid signing identity', 'Invalid credentials',
    'Authentication failed', 'HTTP 403', 'code object is not signed',
    'CSSMERR_TP_CERT_EXPIRED', 'errSecInternalComponent', 'Required macOS release secret is missing',
  ]) assert.equal(transientAppleStapleFailure(`${observed}\n${failure}`), false, failure);
});
