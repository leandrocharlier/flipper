/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import fs from 'fs-extra';
import path from 'path';
import {Readable} from 'stream';
import {pipeline} from 'stream/promises';
import * as tar from 'tar';
import * as yauzl from 'yauzl';

function entryPath(root: string, name: string): string {
  if (
    !name ||
    name.startsWith('/') ||
    /[\\:\0]/.test(name) ||
    name.split('/').includes('..')
  ) {
    throw new Error(`Unsafe plugin archive path: ${name}`);
  }
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe plugin archive path: ${name}`);
  }
  return target;
}

// The caller supplies a fresh temporary directory. Only regular files and
// directories are accepted, so archive links cannot redirect later writes.
export async function extractPluginArchive(
  source: string | Buffer,
  destination: string,
): Promise<void> {
  const data = Buffer.isBuffer(source) ? source : await fs.readFile(source);
  const root = path.resolve(destination);
  let files = 0;
  if (data[0] === 0x1f && data[1] === 0x8b) {
    let invalid: Error | undefined;
    // Validate the immutable buffer before writing any entries.
    await pipeline(
      Readable.from(data),
      tar.t({
        strict: true,
        onReadEntry(entry) {
          try {
            entryPath(root, entry.path);
            if (entry.type !== 'File' && entry.type !== 'Directory') {
              throw new Error(
                `Unsupported plugin archive entry: ${entry.type}`,
              );
            }
            if (entry.type === 'File') files++;
          } catch (error) {
            invalid = error as Error;
          }
        },
      }),
    );
    if (invalid) throw invalid;
    if (files) {
      await pipeline(Readable.from(data), tar.x({cwd: root, strict: true}));
    }
  } else if (data[0] === 0x50 && data[1] === 0x4b) {
    await new Promise<void>((resolve, reject) => {
      yauzl.fromBuffer(
        data,
        {lazyEntries: true, strictFileNames: true},
        (error, zip) => {
          if (error || !zip) {
            reject(error || new Error('Invalid ZIP archive'));
            return;
          }
          const fail = (error: Error) => {
            zip.close();
            reject(error);
          };
          zip.on('error', fail);
          zip.on('end', resolve);
          // yauzl advances lazily only after the asynchronous file write finishes.
          zip.on('entry', (entry: yauzl.Entry) => {
            // eslint-disable-next-line promise/no-promise-in-callback
            (async () => {
              const target = entryPath(root, entry.fileName);
              const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
              if (mode && mode !== 0x8000 && mode !== 0x4000) {
                throw new Error(
                  'Unsupported plugin archive entry: link or special file',
                );
              }
              if (entry.fileName.endsWith('/')) {
                await fs.ensureDir(target);
              } else {
                await fs.ensureDir(path.dirname(target));
                const input = await new Promise<Readable>((resolve, reject) => {
                  zip.openReadStream(entry, (error, stream) => {
                    if (error || !stream)
                      reject(error || new Error('Invalid ZIP entry'));
                    else resolve(stream);
                  });
                });
                await pipeline(
                  input,
                  fs.createWriteStream(target, {flags: 'wx'}),
                );
                files++;
              }
              zip.readEntry();
            })().catch(fail);
          });
          zip.readEntry();
        },
      );
    });
  }
  if (!files)
    throw new Error('The package is not a tar.gz or ZIP archive, or is empty');
}
