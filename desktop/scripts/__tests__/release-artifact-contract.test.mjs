import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

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
});
