/** Copyright (c) Meta Platforms, Inc. and affiliates. MIT license. */
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {createHash} from 'crypto';
import fetch from '@adobe/node-fetch-retry';
import * as tar from 'tar';

const NODE_VERSION = 'v24.21.0';

// The desktop shell uses an ordinary Node runtime on every OS. The legacy
// browser/server distributions retain their separate packaging path.
export async function prepareDesktopBundle(source: string, dist: string) {
  const platform = process.platform;
  const arch = process.arch;
  if (!['win32:x64', 'linux:x64', 'darwin:x64', 'darwin:arm64'].includes(`${platform}:${arch}`)) {
    throw new Error(`Unsupported desktop target: ${platform}-${arch}`);
  }
  const directory = path.resolve(dist, `flipper-server-${platform === 'win32' ? 'windows' : `${platform}-${arch}`}`);
  if (path.dirname(directory) !== path.resolve(dist)) throw new Error('Invalid desktop output path');
  await fs.emptyDir(directory);
  await fs.copy(source, directory, {dereference: false});
  const name = `node-${NODE_VERSION}-${platform}-${arch}`;
  const asset = platform === 'win32' ? 'win-x64/node.exe' : `${name}.tar.gz`;
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  const [binary, sums, license] = await Promise.all([
    fetch(`${base}/${asset}`),
    fetch(`${base}/SHASUMS256.txt`),
    fetch(`https://raw.githubusercontent.com/nodejs/node/${NODE_VERSION}/LICENSE`),
  ]);
  if (!binary.ok || !sums.ok || !license.ok) throw new Error('Unable to download Node runtime and license');
  const bytes = await binary.buffer();
  const expected = (await sums.text()).split('\n').find((line) => line.trim().endsWith(` ${asset}`))?.trim().split(/\s+/)[0];
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`Node runtime checksum mismatch: ${asset}`);
  }
  const runtime = path.join(directory, platform === 'win32' ? 'flipper-runtime.exe' : 'flipper-runtime');
  if (platform === 'win32') {
    await fs.writeFile(runtime, bytes);
  } else {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'flipper-node-'));
    try {
      const archive = path.join(temporary, 'node.tar.gz');
      await fs.writeFile(archive, bytes);
      await tar.x({file: archive, cwd: temporary}, [`${name}/bin/node`]);
      await fs.copy(path.join(temporary, name, 'bin', 'node'), runtime);
      await fs.chmod(runtime, 0o755);
    } finally {
      await fs.remove(temporary);
    }
  }
  await fs.writeFile(path.join(directory, 'NODE-LICENSE'), await license.text());
  console.log(`Desktop server ready: ${directory}`);
}
