#!/usr/bin/env node
/** Transfer native release files through one unpublished, run-owned release.
 * No Actions artifact/cache storage, archive extraction, or extra credentials.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'];
const MAX_ASSET_BYTES = 2 ** 31 - 1;
const metadata = /^(latest|beta)(-mac|-linux|-linux-arm64)?\.yml$/;
const payload = /\.(dmg|zip|exe|AppImage|deb|blockmap|sha256)$/;

export function fileName(name) {
  assert.equal(typeof name, 'string');
  assert.match(name, /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/);
  assert.ok(!name.includes('..'), 'Ambiguous filename');
  return name;
}

export function context(proof, env = process.env) {
  assert.equal(env.GITHUB_REPOSITORY, 'openagent-uno/openagent-app');
  assert.equal(proof.schema, 1);
  assert.equal(proof.source_repository, 'openagent-uno/openagent');
  assert.equal(proof.updater_repository, env.GITHUB_REPOSITORY);
  assert.match(proof.source_commit, /^[0-9a-f]{40}$/);
  assert.match(proof.version, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/);
  assert.match(env.GITHUB_SHA, /^[0-9a-f]{40}$/);
  assert.match(env.GITHUB_RUN_ID, /^\d+$/);
  assert.match(env.GITHUB_RUN_ATTEMPT, /^\d+$/);
  return { purpose: 'canonical-app-transfer-v1', repository: env.GITHUB_REPOSITORY,
    source_commit: proof.source_commit, version: proof.version, executor_commit: env.GITHUB_SHA,
    run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT };
}

function tag(ctx) { return `app-staging-${ctx.version}-${ctx.run_id}-${ctx.run_attempt}`; }
function assetName(platform, name) { return `${platform}--${fileName(name)}`; }
function manifestName(platform) { return `transfer-${platform}.json`; }
function selected(name) { return payload.test(name) || metadata.test(name) || /^release-manifest-[a-z0-9-]+\.json$/.test(name); }

export function validateStage(release, ctx) {
  assert.equal(release.draft, true, 'Staging must remain unpublished');
  assert.equal(release.published_at, null);
  assert.equal(release.prerelease, true);
  assert.equal(release.tag_name, tag(ctx));
  assert.equal(release.name, tag(ctx));
  assert.equal(release.target_commitish, ctx.executor_commit);
  assert.deepEqual(JSON.parse(release.body), ctx, 'Staging belongs to another source or run');
}

export function validateManifest(manifest, platform, ctx) {
  assert.ok(PLATFORMS.includes(platform));
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.platform, platform);
  assert.deepEqual(manifest.context, ctx);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 100);
  const names = new Set();
  for (const entry of manifest.files) {
    fileName(entry.name);
    assert.ok(selected(entry.name), 'Unrecognised transfer file');
    assert.ok(!names.has(entry.name), 'Duplicate transfer file');
    names.add(entry.name);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= MAX_ASSET_BYTES);
  }
  assert.ok(names.has(`release-manifest-${platform}.json`), 'Missing native verification manifest');
  for (const name of names) {
    if (name.startsWith('release-manifest-')) assert.equal(name, `release-manifest-${platform}.json`);
  }
}

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function gh(args, outputFile) {
  const fd = outputFile ? fs.openSync(outputFile, 'wx', 0o600) : undefined;
  let result;
  try {
    // Current gh guards raw binary/escape output even on non-terminal streams.
    // Opt out only when stdout is an exclusively created file descriptor.
    result = spawnSync(process.platform === 'win32' ? 'gh.exe' : 'gh',
      ['api', ...(outputFile ? ['--allow-escape-sequences'] : []), ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      stdio: outputFile ? ['ignore', fd, 'pipe'] : ['ignore', 'pipe', 'pipe'] });
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  // Do not echo API responses, credentials, request bodies, or arbitrary stderr.
  assert.equal(result.status, 0, 'GitHub release API request failed; no automatic upload retry');
  return outputFile || !result.stdout.trim() ? undefined : JSON.parse(result.stdout);
}

function releasePath(ctx, id) {
  assert.match(String(id), /^\d+$/);
  return `repos/${ctx.repository}/releases/${id}`;
}
export function stage(ctx, id) {
  const release = gh([releasePath(ctx, id)]);
  validateStage(release, ctx);
  return release;
}
export function listAssets(ctx, id) {
  return gh(['--paginate', '--slurp', `${releasePath(ctx, id)}/assets?per_page=100`]).flat();
}
function upload(ctx, id, name, file) {
  stage(ctx, id);
  const asset = gh(['--method', 'POST',
    `https://uploads.github.com/repos/${ctx.repository}/releases/${id}/assets?name=${encodeURIComponent(name)}`,
    '-H', 'Content-Type: application/octet-stream', '--input', file]);
  assert.equal(asset.name, name);
  return asset;
}
export async function verifyAsset(file, asset, expected) {
  assert.equal(asset.state, 'uploaded');
  assert.equal(asset.size, expected.size);
  assert.equal(asset.digest, `sha256:${expected.sha256}`);
  assert.equal(fs.statSync(file).size, expected.size);
  assert.equal(await digest(file), expected.sha256);
}
async function fetchAsset(ctx, asset, file, expected) {
  assert.match(String(asset.id), /^\d+$/);
  gh([`repos/${ctx.repository}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'], file);
  await verifyAsset(file, asset, expected);
}

export async function releaseFiles(directory) {
  const names = fs.readdirSync(directory).filter(selected).sort();
  const files = [];
  for (const name of names) {
    fileName(name);
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Only regular release files may be transferred');
    files.push({ name, size: stat.size, sha256: await digest(file) });
  }
  return files;
}

async function publishPlatform(ctx, id, platform, directory) {
  assert.ok(PLATFORMS.includes(platform));
  stage(ctx, id);
  const files = await releaseFiles(directory);
  const manifest = { schema: 1, context: ctx, platform, files };
  validateManifest(manifest, platform, ctx);
  const existing = listAssets(ctx, id);
  assert.ok(!existing.some((asset) => asset.name.startsWith(`${platform}--`) || asset.name === manifestName(platform)),
    'Platform already staged; refusing replacement');
  for (const entry of files) {
    const file = path.join(directory, entry.name);
    await verifyAsset(file, upload(ctx, id, assetName(platform, entry.name), file), entry);
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-transfer-'));
  try {
    const file = path.join(temp, manifestName(platform));
    fs.writeFileSync(file, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    const expected = { size: fs.statSync(file).size, sha256: await digest(file) };
    await verifyAsset(file, upload(ctx, id, manifestName(platform), file), expected);
  } finally { fs.rmSync(temp, { recursive: true }); }
  stage(ctx, id);
}

export async function downloadPlatform(ctx, id, platform, directory) {
  assert.ok(PLATFORMS.includes(platform));
  stage(ctx, id);
  const assets = listAssets(ctx, id);
  const named = (name) => {
    const found = assets.filter((asset) => asset.name === name);
    assert.equal(found.length, 1, 'Missing or duplicate staged asset');
    return found[0];
  };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-transfer-'));
  try {
    const asset = named(manifestName(platform));
    assert.ok(asset.size > 0 && asset.size <= 1024 * 1024);
    assert.match(asset.digest, /^sha256:[0-9a-f]{64}$/);
    const file = path.join(temp, 'manifest.json');
    await fetchAsset(ctx, asset, file, { size: asset.size, sha256: asset.digest.slice(7) });
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateManifest(manifest, platform, ctx);
    const expectedNames = manifest.files.map((entry) => assetName(platform, entry.name)).sort();
    assert.deepEqual(assets.filter((entry) => entry.name.startsWith(`${platform}--`)).map((entry) => entry.name).sort(), expectedNames);
    fs.mkdirSync(directory, { recursive: true });
    assert.equal(fs.readdirSync(directory).length, 0, 'Destination must be empty');
    for (const entry of manifest.files) {
      await fetchAsset(ctx, named(assetName(platform, entry.name)), path.join(directory, entry.name), entry);
    }
  } finally { fs.rmSync(temp, { recursive: true }); }
  stage(ctx, id);
}

async function main() {
  const [command, proofFile, platform, directory] = process.argv.slice(2);
  const ctx = context(JSON.parse(fs.readFileSync(proofFile, 'utf8')));
  assert.ok(process.env.GH_TOKEN, 'Use the existing job token');
  const id = process.env.STAGING_RELEASE_ID;
  if (command === 'create') {
    const release = gh(['--method', 'POST', `repos/${ctx.repository}/releases`,
      '-f', `tag_name=${tag(ctx)}`, '-f', `name=${tag(ctx)}`, '-f', `target_commitish=${ctx.executor_commit}`,
      '-f', `body=${JSON.stringify(ctx)}`, '-F', 'draft=true', '-F', 'prerelease=true', '-f', 'make_latest=false']);
    validateStage(release, ctx);
    assert.match(String(release.id), /^\d+$/);
    assert.ok(process.env.GITHUB_OUTPUT);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_id=${release.id}\n`);
  } else if (command === 'upload') {
    await publishPlatform(ctx, id, platform, directory);
  } else if (command === 'download') {
    await downloadPlatform(ctx, id, platform, directory);
  } else if (command === 'download-all') {
    for (const target of PLATFORMS) await downloadPlatform(ctx, id, target, path.join(directory, `desktop-${target}`));
  } else if (command === 'cleanup') {
    stage(ctx, id);
    gh(['--method', 'DELETE', releasePath(ctx, id)]);
  } else throw new Error('Unknown staging command');
  console.log(`Staging operation complete: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('App staging transfer failed; draft remains unpublished for review.'); process.exitCode = 1; });
}
