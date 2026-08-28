import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCredentialVault,
  isSafeStorageBackendUsable,
  isCredentialRejection,
} from '../../../dist/services/credentials-core.js';

function fixture({ available = true } = {}) {
  const values = new Map();
  const backend = {
    get: (id) => values.get(id) ?? null,
    set: (id, value) => values.set(id, value),
    delete: (id) => values.delete(id),
  };
  const cipher = {
    isAvailable: () => available,
    encrypt: (value) => Buffer.from(`sealed:${value}`, 'utf8'),
    decrypt: (value) => {
      const decoded = Buffer.from(value).toString('utf8');
      if (!decoded.startsWith('sealed:')) throw new Error('corrupt');
      return decoded.slice('sealed:'.length);
    },
  };
  return { values, vault: createCredentialVault(backend, cipher) };
}

test('credential vault persists ciphertext and round-trips through the cipher', () => {
  const { values, vault } = fixture();
  assert.equal(vault.save('account-1', 'correct horse battery staple'), true);
  const persisted = values.get('account-1');
  assert.ok(persisted);
  assert.doesNotMatch(persisted, /correct horse battery staple/);
  assert.equal(vault.has('account-1'), true);
  assert.equal(vault.load('account-1'), 'correct horse battery staple');
  vault.remove('account-1');
  assert.equal(vault.has('account-1'), false);
});

test('credential vault has no plaintext fallback when secure storage is unavailable', () => {
  const { values, vault } = fixture({ available: false });
  assert.equal(vault.isAvailable(), false);
  assert.equal(vault.save('account-1', 'do-not-store'), false);
  assert.equal(values.size, 0);
  assert.equal(vault.load('account-1'), null);
});

test('Linux basic_text and unknown safeStorage backends are rejected', () => {
  assert.equal(isSafeStorageBackendUsable('linux', true, 'basic_text'), false);
  assert.equal(isSafeStorageBackendUsable('linux', true, 'unknown'), false);
  assert.equal(isSafeStorageBackendUsable('linux', true, undefined), false);
  assert.equal(isSafeStorageBackendUsable('linux', true, 'gnome_libsecret'), true);
  assert.equal(isSafeStorageBackendUsable('darwin', true), true);
  assert.equal(isSafeStorageBackendUsable('win32', false), false);
});

test('credential vault removes corrupt entries and validates IPC identifiers', () => {
  const { values, vault } = fixture();
  values.set('account-1', Buffer.from('not-a-sealed-value').toString('base64'));
  assert.equal(vault.load('account-1'), null);
  assert.equal(values.has('account-1'), false);
  assert.throws(() => vault.save('../escape', 'secret'), /accountId is invalid/);
  assert.throws(() => vault.save('account-1', ''), /password must be between/);
});

test('only authentication rejection invalidates a remembered credential', () => {
  assert.equal(isCredentialRejection(new Error('login_finish failed: unauthorized')), true);
  assert.equal(isCredentialRejection(new Error('invalid_credentials')), true);
  assert.equal(isCredentialRejection(new Error('coordinator unreachable: timed out')), false);
  assert.equal(isCredentialRejection(new Error('connection refused')), false);
});
