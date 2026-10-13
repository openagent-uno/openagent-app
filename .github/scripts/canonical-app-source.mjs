#!/usr/bin/env node
/** Exact canonical source admission for the historical updater executor. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `Canonical Git admission failed: ${args[0]}`);
  return result.stdout.trim();
}

export function verifyCanonicalApp(root, sourceSha, version) {
  assert.match(sourceSha, /^[0-9a-f]{40}$/, 'Use a complete immutable canonical commit');
  assert.match(version, /^[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[0-9]+)?$/, 'Use an exact supported App version');
  assert.equal(git(root, 'rev-parse', 'HEAD'), sourceSha, 'Canonical checkout does not match source SHA');
  assert.match(git(root, 'remote', 'get-url', 'origin'), /^https:\/\/github\.com\/openagent-uno\/openagent(?:\.git)?$/, 'Only the canonical source repository is admitted');
  git(root, 'merge-base', '--is-ancestor', sourceSha, 'origin/main');
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=all', '--', 'apps/app'), '', 'Canonical App source changed after checkout');
  const app = path.join(root, 'apps/app');
  const read = (name) => JSON.parse(fs.readFileSync(path.join(app, name), 'utf8'));
  const desktop = read('desktop/package.json');
  const universal = read('universal/package.json');
  for (const pkg of [desktop, universal]) assert.equal(pkg.version, version, 'App package version differs');
  for (const name of ['desktop/package-lock.json', 'universal/package-lock.json']) {
    const lock = read(name);
    assert.equal(lock.version, version, 'App lockfile version differs');
    assert.equal(lock.packages[''].version, version, 'App root lock entry differs');
  }
  assert.equal(desktop.build.appId, 'ai.openagent.desktop', 'Installed identity must be preserved');
  assert.equal(desktop.build.productName, 'OpenAgent');
  for (const key of ['forceCodeSigning', 'hardenedRuntime', 'notarize']) {
    assert.equal(desktop.build.mac[key], true, `macOS ${key} must remain enabled`);
  }
  assert.deepEqual(desktop.build.publish, { provider: 'github', owner: 'openagent-uno', repo: 'openagent-app' }, 'Historical updater feed must be preserved');
  const raw = fs.readFileSync(path.join(app, 'desktop/host-tools.lock.json'));
  const host = JSON.parse(raw);
  assert.equal(host.schema, 1);
  assert.match(host.source_commit, /^[0-9a-f]{40}$/);
  assert.equal(host.source_ref, `v${host.version}`);
  assert.equal(host.source_repository, 'openagent-uno/openagent');
  const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'];
  assert.deepEqual(Object.keys(host.platforms).sort(), platforms, 'Require every pinned host-tools platform');
  for (const [platform, entry] of Object.entries(host.platforms)) {
    assert.match(entry.archive_sha256, /^[0-9a-f]{64}$/);
    assert.match(entry.bundle_manifest_sha256, /^[0-9a-f]{64}$/);
    assert.equal(entry.asset, `openagent-host-tools-${platform}.tar.gz`);
  }
  return { schema: 1, source_repository: 'openagent-uno/openagent', source_commit: sourceSha,
    version, tag: `v${version}`, channel: version.includes('-beta.') ? 'beta' : 'latest',
    app_id: desktop.build.appId, updater_repository: 'openagent-uno/openagent-app',
    host_tools_lock_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    host_tools_source_commit: host.source_commit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const proof = verifyCanonicalApp(process.argv[2], process.argv[3], process.argv[4]);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    `source_sha=${proof.source_commit}\nversion=${proof.version}\ntag=${proof.tag}\nchannel=${proof.channel}\n`);
  if (process.argv[5]) fs.writeFileSync(process.argv[5], `${JSON.stringify(proof, null, 2)}\n`);
  console.log(`Canonical App source verified: ${proof.source_commit} ${proof.version}`);
}
