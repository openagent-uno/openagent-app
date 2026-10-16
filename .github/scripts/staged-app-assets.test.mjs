import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { context, fileName, releaseFiles, validateManifest, validateStage, verifyAsset } from './staged-app-assets.mjs';

const env = { GITHUB_REPOSITORY: 'openagent-uno/openagent-app', GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '2' };
const proof = { schema: 1, source_repository: 'openagent-uno/openagent', source_commit: 'b'.repeat(40),
  version: '1.1.0-beta.18', updater_repository: env.GITHUB_REPOSITORY };
const ctx = context(proof, env);
const release = () => ({ draft: true, published_at: null, prerelease: true,
  tag_name: 'app-staging-1.1.0-beta.18-1234-2', name: 'app-staging-1.1.0-beta.18-1234-2',
  target_commitish: env.GITHUB_SHA, body: JSON.stringify(ctx) });
const entry = (name) => ({ name, size: 3, sha256: 'c'.repeat(64) });
const manifest = () => ({ schema: 1, context: ctx, platform: 'darwin-x64',
  files: [entry('OpenAgent-1.1.0-beta.18-x64.dmg'), entry('release-manifest-darwin-x64.json')] });

test('staging requires the exact unpublished run, source, and executor', () => {
  validateStage(release(), ctx);
  for (const change of [
    { draft: false }, { published_at: '2026-10-16T00:00:00Z' }, { prerelease: false },
    { tag_name: 'v1.1.0-beta.18' }, { name: 'other' }, { target_commitish: 'c'.repeat(40) },
    { body: JSON.stringify({ ...ctx, source_commit: 'c'.repeat(40) }) },
    { body: JSON.stringify({ ...ctx, run_attempt: '1' }) },
    { body: JSON.stringify({ ...ctx, run_id: '999' }) },
  ]) assert.throws(() => validateStage({ ...release(), ...change }, ctx));
  assert.throws(() => context(proof, { ...env, GITHUB_REPOSITORY: 'someone/another-repo' }));
});

test('transfer manifest binds the platform and source with unique safe file identities', () => {
  validateManifest(manifest(), 'darwin-x64', ctx);
  for (const change of [
    { platform: 'linux-x64' }, { context: { ...ctx, source_commit: 'd'.repeat(40) } },
    { files: [] }, { files: [entry('release-manifest-linux-x64.json')] },
    { files: [...manifest().files, manifest().files[0]] },
    { files: [...manifest().files, entry('something.tar.gz')] },
    { files: [...manifest().files, { ...entry('beta-mac.yml'), sha256: 'not-a-hash' }] },
    { files: [...manifest().files, { ...entry('beta-mac.yml'), size: 2 ** 31 }] },
  ]) assert.throws(() => validateManifest({ ...manifest(), ...change }, 'darwin-x64', ctx));
  for (const bad of ['../app.dmg', '/app.dmg', 'a\\app.dmg', '.hidden.zip', 'app\n.zip', 'a..b.zip']) {
    assert.throws(() => fileName(bad));
  }
});

test('transfer preserves file bytes and rejects corruption or inconsistent remote digest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-app-test-'));
  try {
    const file = path.join(dir, 'OpenAgent.zip');
    fs.writeFileSync(file, 'abc');
    const expected = { size: 3, sha256: crypto.createHash('sha256').update('abc').digest('hex') };
    const remote = { state: 'uploaded', size: 3, digest: `sha256:${expected.sha256}` };
    await verifyAsset(file, remote, expected);
    await assert.rejects(verifyAsset(file, { ...remote, state: 'starter' }, expected));
    await assert.rejects(verifyAsset(file, { ...remote, digest: `sha256:${'f'.repeat(64)}` }, expected));
    fs.writeFileSync(file, 'xyz');
    await assert.rejects(verifyAsset(file, remote, expected));
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('collects the previous transfer whitelist and rejects matching symlinks/directories', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-app-test-'));
  try {
    for (const name of ['OpenAgent.zip', 'beta-mac.yml', 'release-manifest-darwin-x64.json', 'ignored.txt']) {
      fs.writeFileSync(path.join(dir, name), 'abc');
    }
    assert.deepEqual((await releaseFiles(dir)).map((file) => file.name),
      ['OpenAgent.zip', 'beta-mac.yml', 'release-manifest-darwin-x64.json']);
    fs.mkdirSync(path.join(dir, 'directory.zip'));
    await assert.rejects(releaseFiles(dir));
    fs.rmdirSync(path.join(dir, 'directory.zip'));
    fs.symlinkSync(path.join(dir, 'ignored.txt'), path.join(dir, 'linked.zip'));
    await assert.rejects(releaseFiles(dir));
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('offline CLI round trip preserves files and blocks replacement, corruption and published staging', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-app-cli-'));
  try {
    // This stub implements the release/asset HTTP response boundary only.
    // It cannot contact GitHub or consume a real token.
    const gh = path.join(dir, 'gh');
    fs.writeFileSync(gh, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.env.STAGING_TEST_ROOT;
const stateFile = path.join(root, 'state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : { assets: [] };
const args = process.argv.slice(3);
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
const endpoint = args.find(a => a.startsWith('repos/') || a.startsWith('https://'));
const json = value => process.stdout.write(JSON.stringify(value));
if (method === 'POST' && endpoint.endsWith('/releases')) {
  const fields = {};
  for (let i = 0; i < args.length; i++) if (args[i] === '-f' || args[i] === '-F') {
    const type = args[i++]; const field = args[i]; const split = field.indexOf('=');
    fields[field.slice(0, split)] = type === '-F' ? JSON.parse(field.slice(split + 1)) : field.slice(split + 1);
  }
  state.release = { ...fields, id: 77, published_at: null }; json(state.release);
} else if (method === 'POST') {
  const name = new URL(endpoint).searchParams.get('name');
  if (state.assets.some(a => a.name === name)) process.exit(1);
  const bytes = fs.readFileSync(args[args.indexOf('--input') + 1]);
  const id = state.assets.length + 1;
  fs.writeFileSync(path.join(root, 'blob-' + id), bytes);
  const asset = { id, name, size: bytes.length, state: 'uploaded', digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') };
  state.assets.push(asset); json(asset);
} else if (method === 'DELETE') {
  if (endpoint !== 'repos/openagent-uno/openagent-app/releases/77') process.exit(1);
  delete state.release; state.deleted = true;
} else if (endpoint.includes('/releases/assets/')) {
  process.stdout.write(fs.readFileSync(path.join(root, 'blob-' + endpoint.split('/').at(-1))));
} else if (endpoint.includes('/assets?')) json([state.assets]);
else if (state.release) json(state.release);
else process.exit(1);
fs.writeFileSync(stateFile, JSON.stringify(state));
`, { mode: 0o700 });
    // .mjs makes the stub's ESM interpretation independent of runner defaults.
    fs.renameSync(gh, `${gh}.mjs`);
    fs.writeFileSync(gh, `#!/bin/sh\nexec "${process.execPath}" "${gh}.mjs" "$@"\n`, { mode: 0o700 });
    const proofFile = path.join(dir, 'proof.json');
    fs.writeFileSync(proofFile, JSON.stringify(proof));
    const cli = fileURLToPath(new URL('./staged-app-assets.mjs', import.meta.url));
    const run = (command, platform = '', output = '') => spawnSync(process.execPath,
      [cli, command, proofFile, platform, output], { encoding: 'utf8', env: {
        ...process.env, ...env, GH_TOKEN: 'offline-test-token', GITHUB_OUTPUT: path.join(dir, 'outputs'),
        STAGING_RELEASE_ID: '77', STAGING_TEST_ROOT: dir, PATH: `${dir}${path.delimiter}${process.env.PATH}` } });
    assert.equal(run('create').status, 0);
    assert.match(fs.readFileSync(path.join(dir, 'outputs'), 'utf8'), /^release_id=77\n$/);
    const input = path.join(dir, 'input');
    fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, 'OpenAgent.zip'), Buffer.from([0, 255, 1, 2, 27, 91, 109]));
    fs.writeFileSync(path.join(input, 'release-manifest-darwin-x64.json'), '{}\n');
    assert.equal(run('upload', 'darwin-x64', input).status, 0);
    assert.notEqual(run('upload', 'darwin-x64', input).status, 0, 'Never replace a completed platform transfer');
    const output = path.join(dir, 'output');
    assert.equal(run('download', 'darwin-x64', output).status, 0);
    assert.deepEqual(fs.readFileSync(path.join(output, 'OpenAgent.zip')), fs.readFileSync(path.join(input, 'OpenAgent.zip')));
    fs.writeFileSync(path.join(dir, 'blob-1'), 'tampered');
    assert.notEqual(run('download', 'darwin-x64', path.join(dir, 'corrupt')).status, 0);
    const stateFile = path.join(dir, 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile));
    state.release.draft = false;
    fs.writeFileSync(stateFile, JSON.stringify(state));
    assert.notEqual(run('cleanup').status, 0, 'Never delete published staging');
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).deleted, undefined);
    state.release.draft = true;
    fs.writeFileSync(stateFile, JSON.stringify(state));
    assert.equal(run('cleanup').status, 0);
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).deleted, true);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
