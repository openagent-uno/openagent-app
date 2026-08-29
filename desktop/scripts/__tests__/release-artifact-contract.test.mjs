import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import yaml from 'js-yaml';

import { verifyEmbeddedBlockMap } from '../release-artifact-contract.mjs';

function embeddedBlockMapFixture(root) {
  const payload = Buffer.from('synthetic packaged application');
  const blockMap = {
    version: '2',
    files: [{ name: 'file', offset: 0, checksums: ['checksum'], sizes: [payload.length] }],
  };
  const compressed = zlib.deflateRawSync(Buffer.from(JSON.stringify(blockMap)));
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(compressed.length, 0);
  const file = path.join(root, 'openagent.AppImage');
  fs.writeFileSync(file, Buffer.concat([payload, compressed, trailer]));
  return { file, blockMapSize: compressed.length };
}

test('accepts an electron-builder embedded AppImage blockmap without a sidecar', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openagent-blockmap-'));
  try {
    const fixture = embeddedBlockMapFixture(root);
    assert.doesNotThrow(() => verifyEmbeddedBlockMap(fixture.file, fixture.blockMapSize));
    assert.equal(fs.existsSync(`${fixture.file}.blockmap`), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an embedded blockmap whose trailer disagrees with update metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openagent-blockmap-'));
  try {
    const fixture = embeddedBlockMapFixture(root);
    const descriptor = fs.openSync(fixture.file, 'r+');
    try {
      const wrongTrailer = Buffer.alloc(4);
      wrongTrailer.writeUInt32BE(fixture.blockMapSize + 1, 0);
      fs.writeSync(descriptor, wrongTrailer, 0, wrongTrailer.length, fs.statSync(fixture.file).size - 4);
    } finally {
      fs.closeSync(descriptor);
    }
    assert.throws(
      () => verifyEmbeddedBlockMap(fixture.file, fixture.blockMapSize),
      /embedded blockmap trailer size mismatch/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release workflow uses the PowerShell-safe long config option', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /--config\.publish\.channel\s+"\$\{\{/);
  assert.doesNotMatch(workflow, /(?:^|\s)-c\.publish\.channel/);
  assert.match(workflow, /desktop\/release\/latest-linux-arm64\.yml/);
  assert.match(workflow, /desktop\/release\/beta-linux-arm64\.yml/);
});

test('Linux ARM updater channel and metadata stay separate from Linux x64', () => {
  const require = createRequire(import.meta.url);
  const { Provider } = require('electron-updater/out/providers/Provider.js');
  const originalArch = process.env.TEST_UPDATER_ARCH;
  try {
    process.env.TEST_UPDATER_ARCH = 'arm64';
    assert.equal(new Provider({ platform: 'linux' }).getCustomChannelName('latest'), 'latest-linux-arm64');
    process.env.TEST_UPDATER_ARCH = 'x64';
    assert.equal(new Provider({ platform: 'linux' }).getCustomChannelName('latest'), 'latest-linux');
  } finally {
    if (originalArch === undefined) delete process.env.TEST_UPDATER_ARCH;
    else process.env.TEST_UPDATER_ARCH = originalArch;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openagent-update-metadata-'));
  const output = path.join(root, 'merged');
  try {
    const fixtures = [
      ['linux-x64', 'latest-linux.yml', 'openagent-x86_64.AppImage'],
      ['linux-arm64', 'latest-linux-arm64.yml', 'openagent-arm64.AppImage'],
    ];
    for (const [directory, filename, url] of fixtures) {
      const fixtureRoot = path.join(root, directory);
      fs.mkdirSync(fixtureRoot, { recursive: true });
      fs.writeFileSync(path.join(fixtureRoot, filename), yaml.dump({
        version: '1.2.3',
        files: [{ url, sha512: `sha512-${url}`, size: 42 }],
        path: url,
        sha512: `sha512-${url}`,
      }));
    }

    const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
    const merger = path.join(repositoryRoot, 'desktop/scripts/merge-update-metadata.js');
    const result = spawnSync(process.execPath, [merger, root, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(fs.readdirSync(output).sort(), ['latest-linux-arm64.yml', 'latest-linux.yml']);
    for (const [, filename, url] of fixtures) {
      const metadata = yaml.load(fs.readFileSync(path.join(output, filename), 'utf8'));
      assert.deepEqual(metadata.files.map((entry) => entry.url), [url]);
      assert.equal(metadata.path, url);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release verifier accepts the complete architecture-specific updater set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openagent-release-set-'));
  try {
    const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
    const desktopRoot = path.join(repositoryRoot, 'desktop');
    const version = String(JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'))).version);
    const metadataRoot = path.join(root, 'release-metadata');
    fs.mkdirSync(metadataRoot, { recursive: true });

    const builds = new Map([
      ['darwin-arm64', [
        `openagent-app-${version}-macos-arm64.dmg`,
        `openagent-app-${version}-macos-arm64.zip`,
      ]],
      ['darwin-x64', [
        `openagent-app-${version}-macos-x64.dmg`,
        `openagent-app-${version}-macos-x64.zip`,
      ]],
      ['win32-arm64', [`openagent-app-${version}-windows-arm64.exe`]],
      ['win32-x64', [`openagent-app-${version}-windows-x64.exe`]],
      ['linux-arm64', [
        `openagent-app-${version}-linux-arm64.deb`,
        `openagent-app-${version}-linux-arm64.AppImage`,
      ]],
      ['linux-x64', [
        `openagent-app-${version}-linux-amd64.deb`,
        `openagent-app-${version}-linux-x86_64.AppImage`,
      ]],
    ]);
    const metadataForRunner = (runner) => runner.startsWith('darwin')
      ? 'latest-mac.yml'
      : runner.startsWith('win32')
        ? 'latest.yml'
        : runner === 'linux-arm64'
          ? 'latest-linux-arm64.yml'
          : 'latest-linux.yml';
    const fileRecords = new Map();

    for (const [runner, installers] of builds) {
      const directory = path.join(root, `desktop-${runner}`);
      fs.mkdirSync(directory, { recursive: true });
      const assets = [metadataForRunner(runner)];
      for (const installer of installers) {
        const contents = Buffer.from(`synthetic release bytes for ${installer}`);
        fs.writeFileSync(path.join(directory, installer), contents);
        const sha256 = createHash('sha256').update(contents).digest('hex');
        fs.writeFileSync(path.join(directory, `${installer}.sha256`), `${sha256}  ${installer}\n`);
        fileRecords.set(installer, {
          url: installer,
          sha512: createHash('sha512').update(contents).digest('base64'),
          size: contents.length,
        });
        assets.push(installer, `${installer}.sha256`);
      }
      fs.writeFileSync(path.join(directory, `release-manifest-${runner}.json`), JSON.stringify({
        schema: 1,
        version,
        runner,
        channel: 'latest',
        primary: installers,
        assets,
      }));
    }

    const metadataGroups = new Map([
      ['latest-mac.yml', [
        `openagent-app-${version}-macos-arm64.dmg`,
        `openagent-app-${version}-macos-arm64.zip`,
        `openagent-app-${version}-macos-x64.dmg`,
        `openagent-app-${version}-macos-x64.zip`,
      ]],
      ['latest.yml', [
        `openagent-app-${version}-windows-arm64.exe`,
        `openagent-app-${version}-windows-x64.exe`,
      ]],
      ['latest-linux.yml', [
        `openagent-app-${version}-linux-amd64.deb`,
        `openagent-app-${version}-linux-x86_64.AppImage`,
      ]],
      ['latest-linux-arm64.yml', [
        `openagent-app-${version}-linux-arm64.deb`,
        `openagent-app-${version}-linux-arm64.AppImage`,
      ]],
    ]);
    const legacyPaths = new Map([
      ['latest-mac.yml', `openagent-app-${version}-macos-x64.zip`],
      ['latest.yml', `openagent-app-${version}-windows-x64.exe`],
      ['latest-linux.yml', `openagent-app-${version}-linux-x86_64.AppImage`],
      ['latest-linux-arm64.yml', `openagent-app-${version}-linux-arm64.AppImage`],
    ]);
    for (const [metadataName, urls] of metadataGroups) {
      const files = urls.map((url) => fileRecords.get(url));
      const legacy = fileRecords.get(legacyPaths.get(metadataName));
      fs.writeFileSync(path.join(metadataRoot, metadataName), yaml.dump({
        version,
        files,
        path: legacy.url,
        sha512: legacy.sha512,
      }));
    }

    const verifier = path.join(desktopRoot, 'scripts/verify-release-set.mjs');
    const result = spawnSync(process.execPath, [verifier, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /release-set smoke: .* 24 assets ok/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
