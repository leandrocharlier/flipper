/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @jest-environment node
 */

import http from 'http';
import {promises as fs} from 'fs';
import os from 'os';
import path from 'path';
import {commandDownloadFileStartFactory} from '../DownloadFile';

test('streams a real HTTP download through the Axios Node adapter', async () => {
  const body = 'Flipper download integration test';
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flipper-download-'),
  );
  const destination = path.join(directory, 'download.txt');
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(body),
    });
    response.end(body);
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address() as {port: number};
    let complete: () => void;
    let fail: (error: Error) => void;
    const finished = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    const download = commandDownloadFileStartFactory((_event, payload) => {
      if (payload.status === 'success') complete();
      if (payload.status === 'error') fail(new Error(payload.message));
    });
    const result = await download(
      `http://127.0.0.1:${address.port}/file`,
      destination,
      {timeout: 3000},
    );
    await finished;
    expect(result.status).toBe(200);
    expect(result.headers['content-length']).toBe(
      String(Buffer.byteLength(body)),
    );
    expect(await fs.readFile(destination, 'utf8')).toBe(body);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(directory, {recursive: true, force: true});
  }
});
