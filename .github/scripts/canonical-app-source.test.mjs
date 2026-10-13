import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyCanonicalApp } from './canonical-app-source.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-bridge-admission-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (name, value) => {
    const file = path.join(root, 'apps/app', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  const version = '1.1.0-beta.16';
  const desktop = { version, build: { appId: 'ai.openagent.desktop', productName: 'OpenAgent',
    mac: { forceCodeSigning: true, hardenedRuntime: true, notarize: true },
    publish: { provider: 'github', owner: 'openagent-uno', repo: 'openagent-app' } } };
  git('init', '-q');
  git('config', 'user.name', 'Release guard fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/openagent-uno/openagent.git');
  write('desktop/package.json', desktop);
  write('universal/package.json', { version });
  for (const name of ['desktop', 'universal']) write(`${name}/package-lock.json`, { version, packages: { '': { version } } });
  write('desktop/host-tools.lock.json', { schema: 1, version: '1.0.0b4', source_ref: 'v1.0.0b4',
    source_repository: 'openagent-uno/openagent', source_commit: 'a'.repeat(40),
    platforms: Object.fromEntries(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'].map(platform => [platform,
      { asset: `openagent-host-tools-${platform}.tar.gz`, archive_sha256: 'b'.repeat(64), bundle_manifest_sha256: 'c'.repeat(64) }])) });
  const commit = (main = true) => {
    git('add', '.'); git('commit', '-qm', 'Fixture source');
    const sha = git('rev-parse', 'HEAD');
    if (main) git('update-ref', 'refs/remotes/origin/main', sha);
    return sha;
  };
  return { root, git, write, version, desktop, commit, sha: commit() };
}

test('admits an exact clean main commit and preserves installed identities', t => {
  const f = fixture(t);
  const proof = verifyCanonicalApp(f.root, f.sha, f.version);
  assert.equal(proof.source_commit, f.sha);
  assert.equal(proof.channel, 'beta');
  assert.equal(proof.updater_repository, 'openagent-uno/openagent-app');
  assert.match(proof.host_tools_lock_sha256, /^[0-9a-f]{64}$/);
});

test('rejects moving refs, wrong SHA, non-main source and dirty App code', t => {
  const f = fixture(t);
  assert.throws(() => verifyCanonicalApp(f.root, 'main', f.version));
  assert.throws(() => verifyCanonicalApp(f.root, '0'.repeat(40), f.version));
  f.write('universal/new-source.json', {});
  assert.throws(() => verifyCanonicalApp(f.root, f.sha, f.version), /source changed/);
  const unmerged = f.commit(false);
  assert.throws(() => verifyCanonicalApp(f.root, unmerged, f.version), /Git admission/);
});

test('rejects a foreign source repository', t => {
  const f = fixture(t);
  f.git('remote', 'set-url', 'origin', 'https://github.com/example/fork.git');
  assert.throws(() => verifyCanonicalApp(f.root, f.sha, f.version), /canonical source repository/);
});

for (const [name, mutate, expected] of [
  ['mismatching lock version', f => f.write('universal/package-lock.json', { version: f.version, packages: { '': { version: '1.1.0-beta.15' } } }), /lock entry/],
  ['changed application identity', f => { f.desktop.build.appId = 'new.identity'; f.write('desktop/package.json', f.desktop); }, /Installed identity/],
  ['changed updater feed', f => { f.desktop.build.publish.repo = 'fork'; f.write('desktop/package.json', f.desktop); }, /updater feed/],
  ['disabled notarization', f => { f.desktop.build.mac.notarize = false; f.write('desktop/package.json', f.desktop); }, /notarize/],
]) test(`rejects ${name} in a clean committed source`, t => {
  const f = fixture(t); mutate(f);
  assert.throws(() => verifyCanonicalApp(f.root, f.commit(), f.version), expected);
});

test('stamps provenance without changing assets and rejects absent/conflicting manifests', t => {
  const f = fixture(t);
  const proofFile = path.join(f.root, 'proof.json');
  fs.writeFileSync(proofFile, JSON.stringify(verifyCanonicalApp(f.root, f.sha, f.version)));
  const output = path.join(f.root, 'release'); fs.mkdirSync(output);
  const invoke = () => spawnSync(process.execPath, [path.join(import.meta.dirname, 'stamp-canonical-app-artifacts.mjs'), proofFile, output],
    { encoding: 'utf8', env: { ...process.env, GITHUB_SHA: 'd'.repeat(40) } });
  assert.notEqual(invoke().status, 0);
  const file = path.join(output, 'release-manifest-darwin-arm64.json');
  const original = { schema: 1, version: f.version, channel: 'beta', runner: 'darwin-arm64', assets: ['payload.zip'], primary: ['payload.zip'] };
  fs.writeFileSync(file, JSON.stringify(original));
  assert.equal(invoke().status, 0);
  const stamped = JSON.parse(fs.readFileSync(file));
  assert.deepEqual(stamped.assets, original.assets);
  assert.equal(stamped.canonical_source.source_commit, f.sha);
  assert.equal(stamped.canonical_source.executor_commit, 'd'.repeat(40));
  assert.equal(invoke().status, 0, 'same provenance is idempotent');
  stamped.canonical_source.source_commit = 'e'.repeat(40);
  fs.writeFileSync(file, JSON.stringify(stamped));
  assert.notEqual(invoke().status, 0);
});
