#!/usr/bin/env node
/** Add canonical payload provenance without changing the validated asset union. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const [proofPath, root] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
assert.equal(proof.source_repository, 'openagent-uno/openagent');
assert.match(proof.source_commit, /^[0-9a-f]{40}$/);
assert.match(process.env.GITHUB_SHA || '', /^[0-9a-f]{40}$/);
const manifests = fs.readdirSync(root).filter((name) => /^release-manifest-(darwin|linux|win32)-(arm64|x64)\.json$/.test(name));
assert.equal(manifests.length, 1, 'Each native build must have exactly one platform manifest');
for (const name of manifests) {
  const file = path.join(root, name);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(manifest.schema, 1);
  assert.equal(name, `release-manifest-${manifest.runner}.json`);
  assert.equal(manifest.version, proof.version);
  assert.equal(manifest.channel, proof.channel);
  const origin = { ...proof, executor_repository: 'openagent-uno/openagent-app', executor_commit: process.env.GITHUB_SHA };
  if (manifest.canonical_source) assert.deepEqual(manifest.canonical_source, origin, 'Conflicting payload source provenance');
  manifest.canonical_source = origin;
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}
