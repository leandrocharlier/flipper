const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const {ServerProcess} = require('../server-process.cjs');
const root = path.resolve(__dirname, '../../..');
const {serverDirectory} = require('../platform.cjs');
const directory = serverDirectory();

test('desktop startup leaves an existing HTTP service untouched', async (t) => {
  let requests = 0;
  const existing = http.createServer((_request, response) => {
    requests++;
    response.end('existing service');
  });
  await new Promise((resolve) => existing.listen(0, '127.0.0.1', resolve));
  const port = existing.address().port;
  const server = new ServerProcess({
    directory,
    port,
    logFile: path.join(root, 'work/port-conflict.log'),
  });
  t.after(async () => {
    await server.stop();
    await new Promise((resolve) => existing.close(resolve));
  });
  await assert.rejects(server.start(), /stopped/);
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}`)).text(),
    'existing service',
  );
  assert.ok(requests > 0);
});

test('backend exits gracefully when the Electron parent disconnects', async (t) => {
  const server = new ServerProcess({
    directory,
    logFile: path.join(root, 'work/parent-disconnect.log'),
  });
  t.after(() => server.stop());
  await server.start();
  server.child.disconnect();
  let timer;
  await Promise.race([
    server.exited,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Backend survived parent disconnection')),
        10000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(server.child.exitCode, 0);
});
