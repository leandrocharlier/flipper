/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @jest-environment node
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {gzipSync} from 'zlib';
import {Header} from 'tar';
import {extractPluginArchive} from '../extractPluginArchive';

function archive(
  name: string,
  type: 'File' | 'SymbolicLink' | 'Link' = 'File',
) {
  const body = Buffer.from('{"name":"test-plugin"}');
  const header = new Header({
    path: name,
    mode: 0o644,
    size: type === 'File' ? body.length : 0,
    type,
    linkpath: type === 'File' ? '' : '../../outside',
  });
  const block = Buffer.alloc(512);
  header.encode(block);
  return gzipSync(
    Buffer.concat([
      block,
      type === 'File'
        ? Buffer.concat([body, Buffer.alloc(512 - body.length)])
        : Buffer.alloc(0),
      Buffer.alloc(1024),
    ]),
  );
}

let root: string;
let destination: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'flipper-archive-'));
  destination = path.join(root, 'extract');
  await fs.ensureDir(destination);
});
afterEach(async () => {
  await fs.remove(root);
});

test.each(['buffer', 'file'])(
  'extracts an npm tarball from a %s',
  async (kind) => {
    const data = archive('package/package.json');
    const source = path.join(root, 'plugin.tgz');
    await fs.writeFile(source, data);
    await extractPluginArchive(kind === 'buffer' ? data : source, destination);
    expect(
      await fs.readJson(path.join(destination, 'package/package.json')),
    ).toEqual({name: 'test-plugin'});
  },
);

test.each([
  '../escaped',
  '/absolute',
  'C:/escaped',
  'package/../../escaped',
  'package\\..\\escaped',
])('rejects unsafe tar path %s before extraction', async (name) => {
  await expect(
    extractPluginArchive(archive(name), destination),
  ).rejects.toThrow('Unsafe plugin archive path');
  expect(await fs.readdir(destination)).toEqual([]);
  expect(await fs.pathExists(path.join(root, 'escaped'))).toBe(false);
});

test.each(['SymbolicLink', 'Link'] as const)(
  'rejects %s entries',
  async (type) => {
    await expect(
      extractPluginArchive(archive('package/link', type), destination),
    ).rejects.toThrow('Unsupported plugin archive entry');
  },
);

test('rejects unrecognized and truncated archives', async () => {
  await expect(
    extractPluginArchive(Buffer.from('invalid'), destination),
  ).rejects.toThrow();
  await expect(
    extractPluginArchive(
      archive('package/package.json').subarray(0, 25),
      destination,
    ),
  ).rejects.toThrow();
});

test('extracts a VSIX ZIP', async () => {
  const fixtures = await fs.readJson(
    path.join(__dirname, 'fixtures/plugin-archives.json'),
  );
  await extractPluginArchive(
    Buffer.from(fixtures.validZip, 'base64'),
    destination,
  );
  expect(
    await fs.readJson(path.join(destination, 'extension/package.json')),
  ).toEqual({name: 'test-plugin'});
});

test('rejects ZIP traversal', async () => {
  const fixtures = await fs.readJson(
    path.join(__dirname, 'fixtures/plugin-archives.json'),
  );
  await expect(
    extractPluginArchive(
      Buffer.from(fixtures.traversalZip, 'base64'),
      destination,
    ),
  ).rejects.toThrow();
  expect(await fs.pathExists(path.join(root, 'escaped'))).toBe(false);
});
