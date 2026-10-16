#!/usr/bin/env node
/** One bounded retry for Apple's observed transient ticket-delivery failure. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function transientAppleStapleFailure(log) {
  const otherFailure = /(?:invalid credentials|authentication failed|HTTP (?:401|403)|status code (?:401|403)|failed to sign|no (?:valid )?signing (?:identity|certificate)|code object is not signed|invalid signature|CSSMERR_|errSecAuthFailed|errSecInternalComponent|release secret is missing)/i;
  return /Failed to staple your application with code:\s*68\b/.test(log)
    && /Error Domain=NSURLErrorDomain Code=-1005\b/.test(log)
    && /The network connection was lost\./.test(log)
    && !otherFailure.test(log);
}

async function attempt(command, args, file) {
  const log = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
  const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', (chunk) => { log.write(chunk); output.write(chunk); });
  }
  const code = await new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('close', (status) => resolve(status ?? 1));
  });
  await new Promise((resolve, reject) => {
    log.once('error', reject);
    log.end(resolve);
  });
  return code;
}

async function main() {
  assert.equal(process.platform, 'darwin', 'Only the macOS build uses this wrapper');
  const [command, ...args] = process.argv.slice(2);
  assert.equal(command, 'npm');
  const directory = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'canonical-app-build-'));
  const firstLog = path.join(directory, 'attempt-1.log');
  const first = await attempt(command, args, firstLog);
  if (first === 0) return 0;
  // Keep the first failure intact. Unexpected/large output fails closed.
  console.error(`First macOS build failed; original log retained at ${firstLog}`);
  if (fs.statSync(firstLog).size > 16 * 1024 * 1024
      || !transientAppleStapleFailure(fs.readFileSync(firstLog, 'utf8'))) return first;
  console.error('Apple stapler68 / NSURLError -1005: retrying the identical command once after 20 seconds.');
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  return attempt(command, args, path.join(directory, 'attempt-2.log'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.error('macOS build failed; signing and notarization remain required.');
    process.exitCode = 1;
  });
}
