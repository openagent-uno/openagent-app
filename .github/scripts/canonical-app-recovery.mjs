#!/usr/bin/env node
/** Explicit failed-macOS recovery. Original stage/context/bytes are read-only. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { context, PLATFORMS, stage, listAssets, downloadPlatform } from './staged-app-assets.mjs';
import { transientAppleStapleFailure } from './canonical-app-build.mjs';

const REPO = 'openagent-uno/openagent-app';
const MACS = ['darwin-arm64', 'darwin-x64'];
const NATIVE_NAMES = {
  'darwin-arm64': 'desktop (macos-15, build:mac, --arm64, darwin-arm64)',
  'darwin-x64': 'desktop (macos-15-intel, build:mac, --x64, darwin-x64)',
  'win32-x64': 'desktop (windows-2025, build:win, --x64, win32-x64)',
  'win32-arm64': 'desktop (windows-11-arm, build:win, --arm64, win32-arm64)',
  'linux-x64': 'desktop (ubuntu-24.04, build:linux, --x64, linux-x64)',
  'linux-arm64': 'desktop (ubuntu-24.04-arm, build:linux, --arm64, linux-arm64)',
};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function id(value) { assert.match(String(value), /^[1-9][0-9]{0,18}$/); return String(value); }

export function recoveryInput(env = process.env) {
  const failed = JSON.parse(env.RECOVER_PLATFORMS || 'null');
  assert(Array.isArray(failed) && failed.length > 0 && failed.length <= 2);
  assert(failed.every(platform => MACS.includes(platform)) && new Set(failed).size === failed.length);
  assert.match(env.ORIGINAL_EXECUTOR_SHA || '', /^[0-9a-f]{40}$/);
  return { run_id: id(env.ORIGINAL_RUN_ID), run_attempt: id(env.ORIGINAL_RUN_ATTEMPT),
    executor_commit: env.ORIGINAL_EXECUTOR_SHA, stage_id: id(env.ORIGINAL_STAGING_RELEASE_ID),
    failed_platforms: [...failed].sort() };
}

export function originalContext(proof, input) {
  // Construct a separate historical read context, never override GITHUB_*.
  return context(proof, { GITHUB_REPOSITORY: REPO, GITHUB_SHA: input.executor_commit,
    GITHUB_RUN_ID: input.run_id, GITHUB_RUN_ATTEMPT: input.run_attempt });
}

export function validateOriginalRun(run, jobs, input) {
  assert.equal(String(run.id), input.run_id);
  assert.equal(String(run.run_attempt), input.run_attempt);
  assert.equal(run.repository.full_name, REPO);
  assert.equal(run.head_sha, input.executor_commit);
  assert.equal(run.path, '.github/workflows/release.yml');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.status, 'completed', 'Wait until the original serial native matrix is terminal');
  assert.equal(run.conclusion, 'failure');
  assert.equal(jobs.length, new Set(jobs.map(job => job.name)).size, 'Ambiguous original job names');
  for (const job of jobs) {
    assert.equal(String(job.run_id), input.run_id); assert.equal(job.head_sha, input.executor_commit);
    assert.equal(job.status, 'completed');
    if (!Object.values(NATIVE_NAMES).includes(job.name) && !['verify canonical source and installed identity', 'lint, types, and unit tests'].includes(job.name)) {
      assert.equal(job.conclusion, 'skipped', 'Only aggregate-dependent original gates may be skipped');
      assert(['macos-intel-smoke', 'release'].includes(job.name), 'Unexpected original gate');
    }
  }
  for (const name of ['verify canonical source and installed identity', 'lint, types, and unit tests']) {
    assert.equal(jobs.find(job => job.name === name)?.conclusion, 'success', 'Original source/test gates must pass');
  }
  const natives = PLATFORMS.map(platform => {
    const job = jobs.find(candidate => candidate.name === NATIVE_NAMES[platform]);
    assert(job, 'Missing original platform job');
    assert(['success', 'failure'].includes(job.conclusion), 'Cancelled/skipped platforms cannot be reused');
    if (job.conclusion === 'failure') {
      assert(MACS.includes(platform), 'Non-macOS failures require a different reviewed recovery');
      const failedSteps = job.steps.filter(step => step.conclusion === 'failure');
      assert.equal(failedSteps.length, 1); assert.equal(failedSteps[0].name, 'Build Electron app');
    }
    return { platform, job_id: id(job.id), conclusion: job.conclusion };
  });
  assert.deepEqual(natives.filter(row => row.conclusion === 'failure').map(row => row.platform).sort(), input.failed_platforms,
    'Requested recovery must equal failed macOS subset; never rebuild a successful platform');
  return natives;
}

export function assetInventoryDigest(assets) {
  const rows = assets.map(asset => {
    assert.equal(asset.state, 'uploaded'); id(asset.id);
    assert.match(asset.digest, /^sha256:[0-9a-f]{64}$/);
    assert(Number.isSafeInteger(asset.size) && asset.size > 0);
    return { id: String(asset.id), name: asset.name, size: asset.size, digest: asset.digest };
  }).sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(rows.length, new Set(rows.map(row => row.name)).size);
  return sha(JSON.stringify(rows));
}

export function validateOriginalAssets(assets, natives) {
  for (const { platform, conclusion } of natives) {
    const present = assets.some(asset => asset.name === `transfer-${platform}.json`);
    if (conclusion === 'success') assert(present, 'Successful native job has no verified transfer');
    else assert(!assets.some(asset => asset.name.startsWith(`${platform}--`) || asset.name === `transfer-${platform}.json`),
      'Failed platform has partial transfer; preserve it and request a separate review');
  }
  assert(assets.every(asset => natives.some(row => row.conclusion === 'success'
    && (asset.name === `transfer-${row.platform}.json` || asset.name.startsWith(`${row.platform}--`)))));
  return assetInventoryDigest(assets);
}

export function validateRecoveryAssets(assets, failedPlatforms) {
  for (const platform of failedPlatforms) assert(assets.some(asset => asset.name === `transfer-${platform}.json`));
  assert(assets.every(asset => failedPlatforms.some(platform =>
    asset.name === `transfer-${platform}.json` || asset.name.startsWith(`${platform}--`))),
  'Recovery stage may contain only newly repaired platforms');
  return assetInventoryDigest(assets);
}

export function validateRecoveryGates(jobs, current, failedPlatforms) {
  assert.equal(jobs.length, new Set(jobs.map(job => job.name)).size);
  return ['test recovery guards', 'admit original failed run and stage', 'launch recovered macOS Intel installers',
    ...failedPlatforms.map(platform => `recover native (${platform})`)].map(name => {
    const job = jobs.find(row => row.name === name); assert(job);
    assert.equal(String(job.run_id), current.run_id); assert.equal(job.head_sha, current.executor_commit);
    assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'success', 'Recovery gates must actually pass');
    return { name, job_id: id(job.id), conclusion: 'success' };
  });
}

export function validateNativeProvenance(manifest, proof, platform, selectedContext, windowsLockSHA) {
  assert.equal(manifest.schema, 1); assert.equal(manifest.runner, platform);
  assert.equal(manifest.version, proof.version); assert.equal(manifest.channel, proof.channel);
  const expected = { ...proof, executor_repository: REPO, executor_commit: selectedContext.executor_commit };
  // Windows checkout conversion was already qualified in the original run.
  // Accept only the exact LF->CRLF raw hash derived from the frozen lock bytes.
  if (platform.startsWith('win32-') && manifest.canonical_source?.host_tools_lock_sha256 === windowsLockSHA) {
    expected.host_tools_lock_sha256 = windowsLockSHA;
  }
  assert.deepEqual(manifest.canonical_source, expected, 'Native source/executor/identity provenance differs');
}

export async function readActionsBytes(endpoint, maximum = 4 << 20, fetcher = fetch) {
  assert(endpoint.startsWith(`/repos/${REPO}/actions/`));
  // Live API evidence rejected anonymous job-log reads (403), despite public
  // repository documentation. Use only the existing job token with actions:read.
  assert(process.env.GH_TOKEN);
  let response = await fetcher(`https://api.github.com${endpoint}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenAgent-App-Recovery',
      Authorization: `Bearer ${process.env.GH_TOKEN}` },
    redirect: 'manual', signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 302) {
    assert(endpoint.endsWith('/logs'));
    const location = new URL(response.headers.get('Location'));
    assert.equal(location.protocol, 'https:');
    assert(location.hostname.endsWith('.blob.core.windows.net') || location.hostname.endsWith('.actions.githubusercontent.com'));
    // Never forward the GitHub token to the signed blob URL.
    response = await fetcher(location, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  }
  assert.equal(response.status, 200, 'Public original run evidence unavailable');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; assert(size <= maximum); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const publicJSON = async endpoint => JSON.parse(await readActionsBytes(endpoint));
async function jobsFor(run, attempt) {
  const result = await publicJSON(`/repos/${REPO}/actions/runs/${id(run)}/attempts/${id(attempt)}/jobs?per_page=100`);
  assert.equal(result.total_count, result.jobs.length); assert(result.jobs.length <= 100);
  return result.jobs;
}

async function failureLogs(natives) {
  const failures = [];
  for (const row of natives.filter(row => row.conclusion === 'failure')) {
    const log = await readActionsBytes(`/repos/${REPO}/actions/jobs/${row.job_id}/logs`, 16 << 20);
    assert(transientAppleStapleFailure(log.toString('utf8')), 'Original failure is not the reviewed transient Apple stapler failure');
    failures.push({ platform: row.platform, job_id: row.job_id, log_sha256: sha(log),
      classification: 'stapler68/NSURLErrorDomain-1005/network-connection-lost; other signing/authentication failures rejected' });
  }
  return failures;
}

async function validateLogAccess(input) {
  // This read-only preflight is allowed while other original native jobs finish.
  const jobs = await jobsFor(input.run_id, input.run_attempt);
  const failed = input.failed_platforms.map(platform => {
    const selected = jobs.filter(job => job.name === NATIVE_NAMES[platform]); assert.equal(selected.length, 1);
    const job = selected[0];
    assert.equal(String(job.run_id), input.run_id); assert.equal(job.head_sha, input.executor_commit);
    assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'failure');
    const failedSteps = job.steps.filter(step => step.conclusion === 'failure');
    assert.equal(failedSteps.length, 1); assert.equal(failedSteps[0].name, 'Build Electron app');
    return { platform, job_id: id(job.id), conclusion: 'failure' };
  });
  // Only fixed classifications, IDs and hashes are emitted; never log contents.
  const failures = await failureLogs(failed);
  console.log(JSON.stringify({ original_failure_log_access: 'passed', failures }));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    failures.map(row => `Original failure log SHA256: ${row.log_sha256}; classification: ${row.classification}.\n`).join(''));
}

async function admit(proof, input, current) {
  assert.notEqual(input.run_id, current.run_id, 'Recovery must be a new explicitly reviewed run');
  const original = originalContext(proof, input);
  const run = await publicJSON(`/repos/${REPO}/actions/runs/${input.run_id}/attempts/${input.run_attempt}`);
  const natives = validateOriginalRun(run, await jobsFor(input.run_id, input.run_attempt), input);
  const failures = await failureLogs(natives);
  const artifacts = await publicJSON(`/repos/${REPO}/actions/runs/${input.run_id}/artifacts?per_page=100`);
  assert.equal(artifacts.total_count, 0, 'Recovery expects no Actions artifacts');
  stage(original, input.stage_id);
  return { schema: 1, purpose: 'canonical-app-recovery-v1', original_context: original,
    recovery_context: current, original_stage_id: input.stage_id, natives, failures,
    original_asset_inventory_sha256: validateOriginalAssets(listAssets(original, input.stage_id), natives) };
}

function savePlan(file, plan) {
  const bytes = `${JSON.stringify(plan)}\n`;
  if (process.env.RECOVERY_PLAN_SHA256) assert.equal(sha(bytes), process.env.RECOVERY_PLAN_SHA256, 'Original recovery evidence changed');
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  return sha(bytes);
}
function windowsLockSHA(proof) {
  const root = process.env.CANONICAL_ROOT; assert(root);
  const raw = fs.readFileSync(path.join(root, 'apps/app/desktop/host-tools.lock.json'));
  assert.equal(sha(raw), proof.host_tools_lock_sha256);
  return sha(Buffer.from(raw.toString('utf8').replace(/\r?\n/g, '\r\n')));
}
async function fetchSelected(plan, proof, platform, directory) {
  assert(PLATFORMS.includes(platform));
  const repaired = plan.failures.some(row => row.platform === platform);
  const ctx = repaired ? plan.recovery_context : plan.original_context;
  const releaseID = repaired ? id(process.env.STAGING_RELEASE_ID) : plan.original_stage_id;
  await downloadPlatform(ctx, releaseID, platform, directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, `release-manifest-${platform}.json`)));
  validateNativeProvenance(manifest, proof, platform, ctx, windowsLockSHA(proof));
  return { platform, origin: repaired ? 'recovered-native' : 'original-successful-native',
    run_id: ctx.run_id, run_attempt: ctx.run_attempt, executor_commit: ctx.executor_commit,
    stage_id: releaseID, native_manifest_sha256: sha(fs.readFileSync(path.join(directory, `release-manifest-${platform}.json`))) };
}

async function main() {
  const [command, proofFile, planFile, platform, directory] = process.argv.slice(2);
  if (command === 'verify-log-access') { await validateLogAccess(recoveryInput()); return; }
  const proof = JSON.parse(fs.readFileSync(proofFile)); const current = context(proof);
  assert(process.env.GH_TOKEN, 'Use only the existing contents-write job token for draft transfers');
  const plan = await admit(proof, recoveryInput(), current);
  const planSHA = savePlan(planFile, plan);
  if (command === 'admit') {
    const matrix = plan.failures.map(row => ({ platform_key: row.platform,
      os: row.platform === 'darwin-arm64' ? 'macos-15' : 'macos-15-intel',
      arch_flag: row.platform === 'darwin-arm64' ? '--arm64' : '--x64' }));
    assert(process.env.GITHUB_OUTPUT);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `plan_sha256=${planSHA}\nmatrix=${JSON.stringify({ include: matrix })}\n`);
  } else if (command === 'download') {
    await fetchSelected(plan, proof, platform, directory);
  } else if (command === 'download-all') {
    const recoveryStageID = id(process.env.STAGING_RELEASE_ID);
    stage(current, recoveryStageID);
    const recoveryAssetsSHA = validateRecoveryAssets(listAssets(current, recoveryStageID), plan.failures.map(row => row.platform));
    const provenance = [];
    for (const target of PLATFORMS) provenance.push(await fetchSelected(plan, proof, target, path.join(directory, `desktop-${target}`)));
    const jobs = await jobsFor(current.run_id, current.run_attempt);
    const gates = validateRecoveryGates(jobs, current, plan.failures.map(row => row.platform));
    for (const row of provenance) row.native_job_id = row.origin === 'recovered-native'
      ? gates.find(gate => gate.name === `recover native (${row.platform})`).job_id
      : plan.natives.find(native => native.platform === row.platform).job_id;
    assert.equal(validateRecoveryAssets(listAssets(current, recoveryStageID), plan.failures.map(row => row.platform)), recoveryAssetsSHA);
    assert.equal(validateOriginalAssets(listAssets(plan.original_context, plan.original_stage_id), plan.natives), plan.original_asset_inventory_sha256);
    const receipt = { ...plan, platform_provenance: provenance, original_run_conclusion: 'failure',
      original_all_jobs_passed: false, recovery_native_and_intel_gates: 'passed',
      recovery_gates: gates, recovery_asset_inventory_sha256: recoveryAssetsSHA,
      final_asset_gate: 'Unchanged six-manifest/exact36asset/digest verification and attestation required before draft acceptance', publication: false };
    fs.writeFileSync(path.join(path.dirname(planFile), 'recovery-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(path.dirname(planFile), 'recovery-body.md'),
      `Canonical App payload: openagent-uno/openagent@${proof.source_commit} (apps/app).\nRecovery executor: ${REPO}@${current.executor_commit}.\nOriginal run ${plan.original_context.run_id} failed; successful platform bytes were reused, not rebuilt.\nDraft only. Review exact36assets and the explicit original/recovered provenance before publication.\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`, { mode: 0o600 });
  } else throw new Error('Unsupported recovery command');
  console.log(`Recovery ${command} complete; original stage remains untouched.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Recovery rejected; preserve both unpublished stages for review.'); process.exitCode = 1; });
}
