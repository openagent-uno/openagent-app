import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * Verify an electron-builder blockmap that is embedded at the end of an
 * installer. AppImage update metadata exposes its compressed byte length as
 * `blockMapSize`; unlike ZIP/DMG/NSIS blockmaps, there is deliberately no
 * sibling `.blockmap` file to upload.
 */
export function verifyEmbeddedBlockMap(file, declaredSize, label = file) {
  const blockMapSize = Number(declaredSize);
  assert(
    Number.isSafeInteger(blockMapSize) && blockMapSize > 0,
    `${label} has an invalid embedded blockmap size`,
  );

  const fileSize = fs.statSync(file).size;
  assert(fileSize > blockMapSize + 4, `${label} is too small for its embedded blockmap`);

  const descriptor = fs.openSync(file, 'r');
  try {
    const compressed = Buffer.allocUnsafe(blockMapSize);
    const trailer = Buffer.allocUnsafe(4);
    const compressedOffset = fileSize - blockMapSize - trailer.length;
    assert.equal(
      fs.readSync(descriptor, compressed, 0, compressed.length, compressedOffset),
      compressed.length,
      `${label} embedded blockmap is truncated`,
    );
    assert.equal(
      fs.readSync(descriptor, trailer, 0, trailer.length, fileSize - trailer.length),
      trailer.length,
      `${label} embedded blockmap trailer is truncated`,
    );
    assert.equal(
      trailer.readUInt32BE(0),
      blockMapSize,
      `${label} embedded blockmap trailer size mismatch`,
    );

    const blockMap = JSON.parse(zlib.inflateRawSync(compressed).toString('utf8'));
    assert.equal(blockMap.version, '2', `${label} has an unsupported embedded blockmap schema`);
    assert(Array.isArray(blockMap.files) && blockMap.files.length > 0, `${label} embedded blockmap has no files`);
    for (const mappedFile of blockMap.files) {
      assert(Array.isArray(mappedFile.checksums), `${label} embedded blockmap has no checksums`);
      assert(Array.isArray(mappedFile.sizes), `${label} embedded blockmap has no chunk sizes`);
      assert.equal(
        mappedFile.checksums.length,
        mappedFile.sizes.length,
        `${label} embedded blockmap chunk arrays differ`,
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
}
