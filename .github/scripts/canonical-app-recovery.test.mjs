import assert from 'node:assert/strict';
import test from 'node:test';
import { transientAppleStapleFailure } from './canonical-app-build.mjs';
import { PLATFORMS } from './staged-app-assets.mjs';
import { recoveryInput, originalContext, validateOriginalRun, validateOriginalAssets,
  assetInventoryDigest, validateNativeProvenance, validateRecoveryAssets, validateRecoveryGates, readActionsBytes, extractFailedBuildLog } from './canonical-app-recovery.mjs';

const env = { ORIGINAL_RUN_ID: '100', ORIGINAL_RUN_ATTEMPT: '1', ORIGINAL_EXECUTOR_SHA: 'a'.repeat(40),
  ORIGINAL_STAGING_RELEASE_ID: '200', RECOVER_PLATFORMS: '["darwin-arm64"]' };
const proof = { schema: 1, source_repository: 'openagent-uno/openagent', source_commit: 'b'.repeat(40),
  version: '1.1.0-beta.19', tag: 'v1.1.0-beta.19', channel: 'beta', app_id: 'ai.openagent.desktop',
  updater_repository: 'openagent-uno/openagent-app', host_tools_lock_sha256: 'c'.repeat(64),
  host_tools_source_commit: 'd'.repeat(40) };
const names = {
  'darwin-arm64': 'desktop (macos-15, build:mac, --arm64, darwin-arm64)',
  'darwin-x64': 'desktop (macos-15-intel, build:mac, --x64, darwin-x64)',
  'win32-x64': 'desktop (windows-2025, build:win, --x64, win32-x64)',
  'win32-arm64': 'desktop (windows-11-arm, build:win, --arm64, win32-arm64)',
  'linux-x64': 'desktop (ubuntu-24.04, build:linux, --x64, linux-x64)',
  'linux-arm64': 'desktop (ubuntu-24.04-arm, build:linux, --arm64, linux-arm64)',
};
function fixture(failed = ['darwin-arm64']) {
  const input = recoveryInput({ ...env, RECOVER_PLATFORMS: JSON.stringify(failed) });
  const run = { id: 100, run_attempt: 1, repository: { full_name: 'openagent-uno/openagent-app' },
    head_sha: env.ORIGINAL_EXECUTOR_SHA, path: '.github/workflows/release.yml', event: 'workflow_dispatch',
    status: 'completed', conclusion: 'failure' };
  const job = (name, index, fail = false) => ({ id: 300 + index, name, run_id: 100, head_sha: run.head_sha,
    status: 'completed', conclusion: fail ? 'failure' : 'success',
    steps: fail ? [{ name: 'Build Electron app', conclusion: 'failure' }] : [] });
  const jobs = ['verify canonical source and installed identity', 'lint, types, and unit tests'].map((name, i) => job(name, i));
  jobs.push(...PLATFORMS.map((platform, i) => job(names[platform], i + 2, failed.includes(platform))));
  jobs.push(...['launch packaged macOS Intel installers', 'release'].map((name, i) =>
    ({ ...job(name, i + 8), conclusion: 'skipped' })));
  return { input, run, jobs };
}
const check = value => validateOriginalRun(value.run, value.jobs, value.input);

test('recovery admits exactly failed Mac subset and never pretends original run passed', () => {
  for (const failed of [['darwin-arm64'], ['darwin-arm64', 'darwin-x64']]) {
    const value = fixture(failed); const natives = check(value);
    assert.deepEqual(natives.filter(row => row.conclusion === 'failure').map(row => row.platform).sort(), [...failed].sort());
    assert.equal(value.run.conclusion, 'failure');
    assert.equal(natives.length, 6);
    assert.equal(value.jobs.length, 10);
    assert.equal(value.jobs.filter(row => row.conclusion === 'skipped').length, 2);
    assert.equal(value.jobs.filter(row => row.conclusion === 'success').length, 8 - failed.length);
  }
  assert.throws(() => recoveryInput({ ...env, RECOVER_PLATFORMS: '["linux-x64"]' }));
  assert.throws(() => recoveryInput({ ...env, RECOVER_PLATFORMS: '["darwin-arm64","darwin-arm64"]' }));
  const successRebuild = fixture(); successRebuild.input.failed_platforms.push('darwin-x64'); assert.throws(() => check(successRebuild));
});

test('unfinished, different-attempt/source, failed source gate and non-native-build errors reject recovery', () => {
  for (const change of [{ status: 'in_progress' }, { conclusion: 'success' }, { run_attempt: 2 },
    { id: 101 }, { head_sha: 'f'.repeat(40) }, { path: '.github/workflows/other.yml' }]) {
    const value = fixture(); Object.assign(value.run, change); assert.throws(() => check(value));
  }
  for (const mutate of [
    jobs => { jobs[0].conclusion = 'failure'; },
    jobs => { jobs[2].steps[0].name = 'Import macOS signing certificate'; },
    jobs => { jobs[3].conclusion = 'cancelled'; },
    jobs => { jobs[4].conclusion = 'failure'; jobs[4].steps = [{ name: 'Build Electron app', conclusion: 'failure' }]; },
    jobs => { jobs[4].head_sha = 'f'.repeat(40); },
    jobs => { jobs.push({ ...jobs[0] }); },
    jobs => { jobs.pop(); },
    jobs => { jobs[8].name = 'macos-intel-smoke'; },
    jobs => { jobs[8].name = 'unexpected aggregate gate'; },
    jobs => { jobs[8].conclusion = 'failure'; },
  ]) { const value = fixture(); mutate(value.jobs); assert.throws(() => check(value)); }
});

test('original asset set stays exact and incomplete failed transfers are never overwritten', () => {
  const value = fixture(); const natives = check(value);
  const assets = natives.filter(row => row.conclusion === 'success').flatMap((row, i) => [
    { id: i * 2 + 1, name: `transfer-${row.platform}.json`, size: 20, state: 'uploaded', digest: `sha256:${'e'.repeat(64)}` },
    { id: i * 2 + 2, name: `${row.platform}--release-manifest-${row.platform}.json`, size: 30, state: 'uploaded', digest: `sha256:${'f'.repeat(64)}` },
  ]);
  const before = JSON.stringify(assets);
  assert.match(validateOriginalAssets(assets, natives), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(assets), before, 'No rewriting original context or staged bytes');
  assert.throws(() => validateOriginalAssets(assets.slice(1), natives));
  assert.throws(() => validateOriginalAssets([...assets, { ...assets[0], id: 999, name: 'darwin-arm64--partial.zip' }], natives));
  assert.throws(() => assetInventoryDigest([...assets, assets[0]]));
  assert.notEqual(assetInventoryDigest(assets), assetInventoryDigest(assets.map((asset, i) => i ? asset : { ...asset, digest: `sha256:${'0'.repeat(64)}` })));
});

test('mixed manifest executors retain exact source/identity and reviewed Windows raw hash only', () => {
  const input = recoveryInput(env); const original = originalContext(proof, input);
  const recovered = { ...original, executor_commit: 'e'.repeat(40), run_id: '101' };
  const manifest = (platform, ctx) => ({ schema: 1, runner: platform, version: proof.version, channel: proof.channel,
    canonical_source: { ...proof, executor_repository: original.repository, executor_commit: ctx.executor_commit } });
  validateNativeProvenance(manifest('darwin-arm64', recovered), proof, 'darwin-arm64', recovered, 'f'.repeat(64));
  validateNativeProvenance(manifest('darwin-x64', original), proof, 'darwin-x64', original, 'f'.repeat(64));
  assert.throws(() => validateNativeProvenance(manifest('darwin-arm64', original), proof, 'darwin-arm64', recovered, 'f'.repeat(64)));
  const windows = manifest('win32-x64', original); windows.canonical_source.host_tools_lock_sha256 = 'f'.repeat(64);
  validateNativeProvenance(windows, proof, 'win32-x64', original, 'f'.repeat(64));
  assert.throws(() => validateNativeProvenance(windows, proof, 'win32-x64', original, '0'.repeat(64)));
  const changed = manifest('darwin-x64', original); changed.canonical_source.source_commit = '0'.repeat(40);
  assert.throws(() => validateNativeProvenance(changed, proof, 'darwin-x64', original, 'f'.repeat(64)));
  changed.canonical_source.source_commit = proof.source_commit; changed.canonical_source.app_id = 'another.app';
  assert.throws(() => validateNativeProvenance(changed, proof, 'darwin-x64', original, 'f'.repeat(64)));
});


test('recovery stage and gate provenance cannot smuggle successful original targets or another run', () => {
  const asset = { id: 901, name: 'transfer-darwin-arm64.json', size: 20, state: 'uploaded', digest: `sha256:${'e'.repeat(64)}` };
  validateRecoveryAssets([asset], ['darwin-arm64']);
  assert.throws(() => validateRecoveryAssets([], ['darwin-arm64']));
  assert.throws(() => validateRecoveryAssets([asset, { ...asset, id: 902, name: 'darwin-x64--original.zip' }], ['darwin-arm64']));
  const current = { run_id: '999', executor_commit: 'e'.repeat(40) };
  const jobs = ['test recovery guards', 'admit original failed run and stage', 'launch recovered macOS Intel installers',
    'recover native (darwin-arm64)'].map((name, i) => ({ name, id: i + 900, run_id: 999, head_sha: current.executor_commit, status: 'completed', conclusion: 'success' }));
  assert.equal(validateRecoveryGates(jobs, current, ['darwin-arm64']).length, 4);
  for (const change of [{ conclusion: 'skipped' }, { status: 'in_progress' }, { run_id: 100 }, { head_sha: 'f'.repeat(40) }]) {
    assert.throws(() => validateRecoveryGates(jobs.map((job, i) => i ? job : { ...job, ...change }), current, ['darwin-arm64']));
  }
  assert.throws(() => validateRecoveryGates([...jobs, jobs[0]], current, ['darwin-arm64']));
});


test('job token is sent only to the GitHub API and never to the signed log redirect', async () => {
  const saved = process.env.GH_TOKEN; process.env.GH_TOKEN = 'fixture-only-token';
  try {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { Location: 'https://fixture.blob.core.windows.net/job/log' } })
        : new Response('bounded fixture log', { status: 200 });
    };
    const bytes = await readActionsBytes('/repos/openagent-uno/openagent-app/actions/jobs/123/logs', 100, fetcher);
    assert.equal(bytes.toString(), 'bounded fixture log');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-only-token');
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[1].options.headers, undefined);
    assert.equal(calls[1].options.redirect, 'error');
    await assert.rejects(readActionsBytes('/repos/other/repo/actions/jobs/123/logs', 100, fetcher));
    for (const location of ['http://fixture.blob.core.windows.net/log', 'https://untrusted.example/log']) {
      await assert.rejects(readActionsBytes('/repos/openagent-uno/openagent-app/actions/jobs/123/logs', 100, async () =>
        new Response(null, { status: 302, headers: { Location: location } })));
    }
    await assert.rejects(readActionsBytes('/repos/openagent-uno/openagent-app/actions/jobs/123/logs', 2, async () => new Response('too large')));
    await assert.rejects(readActionsBytes('/repos/openagent-uno/openagent-app/actions/jobs/123/logs', 100, async () => new Response(null, { status: 403 })));
  } finally { if (saved === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = saved; }
});


test('classify exact failed build bytes, excluding echoed scripts from earlier successful steps', () => {
  const line = text => `2026-10-17T07:10:31.1234567Z ${text}\n`;
  const header = '##[group]Run node "$GITHUB_WORKSPACE/executor/.github/scripts/canonical-app-build.mjs" npm run build:mac -- --arm64 --publish never --config.publish.channel "beta"';
  const transient = ['Failed to staple your application with code: 68', 'Error Domain=NSURLErrorDomain Code=-1005', 'The network connection was lost.'];
  const selected = [header, '##[endgroup]', ...transient, '##[error]Process completed with exit code 1.'].map(line).join('');
  const prefix = '\ufeff' + [ '##[group]Run for required in CSC_LINK CSC_KEY_PASSWORD APPLE_ID; do',
    'echo "Required macOS release secret is missing: ${required}"', '##[endgroup]'].map(line).join('');
  const whole = Buffer.from(prefix + selected + line('Post job cleanup.'));
  assert.equal(transientAppleStapleFailure(whole.toString()), false, 'Whole job contains earlier echoed script');
  const result = extractFailedBuildLog(whole, 'darwin-arm64');
  assert.equal(result.toString(), selected, 'Selection preserves exact original header/output/terminal bytes');
  assert.equal(transientAppleStapleFailure(result.toString()), true);
  const actualSigningError = Buffer.from(selected.replace(line(transient[0]),line('failed to sign: invalid credentials')+line(transient[0])));
  assert.equal(transientAppleStapleFailure(extractFailedBuildLog(actualSigningError,'darwin-arm64').toString()),false);
  for (const invalid of [ selected+selected, selected.replace(' --arm64 ', ' --x64 '),
    selected.replace(line('##[error]Process completed with exit code 1.'), ''),
    selected.replace(line('##[error]Process completed with exit code 1.'), line('##[group]Run other step')+line('##[error]Process completed with exit code 1.')),
    selected.replace('exit code 1.', 'exit code 2.') ]) {
    assert.throws(() => extractFailedBuildLog(Buffer.from(invalid),'darwin-arm64'));
  }
});
