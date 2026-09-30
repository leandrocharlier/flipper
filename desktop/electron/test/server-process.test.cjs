const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ServerProcess} = require('../server-process.cjs');

function fixture(t, source, options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'flipper-shell-test-'),
  );
  fs.copyFileSync(
    process.execPath,
    path.join(
      directory,
      process.platform === 'win32' ? 'flipper-runtime.exe' : 'flipper-runtime',
    ),
  );
  fs.writeFileSync(path.join(directory, 'server.js'), source);
  const server = new ServerProcess({
    directory,
    logFile: path.join(directory, 'server.log'),
    ...options,
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  return server;
}

test('waits for IPC readiness, then shuts the child down gracefully', async (t) => {
  const server = fixture(
    t,
    `
    process.send({type: 'desktop-ready', port: 52342});
    process.on('message', message => {
      if (message.type === 'desktop-shutdown') {
        require('fs').writeFileSync('shutdown.txt', 'graceful');
        process.exit(0);
      }
    });
  `,
  );
  await server.start();
  assert.equal(server.child.exitCode, null);
  await server.stop();
  assert.equal(server.child.exitCode, 0);
  assert.equal(
    fs.readFileSync(path.join(server.directory, 'shutdown.txt'), 'utf8'),
    'graceful',
  );
});

test('reports an unexpected backend exit after readiness', async (t) => {
  let exited;
  const notification = new Promise((resolve) => {
    exited = resolve;
  });
  const server = fixture(
    t,
    `process.send({type: 'desktop-ready', port: 52342}); setTimeout(() => process.exit(7), 100);`,
    {onUnexpectedExit: exited},
  );
  await server.start();
  assert.match((await notification).message, /stopped \(7\)/);
});

test('rejects startup failures without leaving a child running', async (t) => {
  const server = fixture(t, 'process.exit(3);');
  await assert.rejects(server.start(), /stopped \(3\)/);
  await server.stop();
  assert.equal(server.child.exitCode, 3);
});

test('times out if a child never signals readiness and can still stop it', async (t) => {
  const server = fixture(t, `process.on('message', () => process.exit(0));`, {
    timeout: 200,
  });
  await assert.rejects(server.start(), /did not become ready/);
  await server.stop();
  assert.equal(server.child.exitCode, 0);
});

test('reports missing server resources before spawning a process', async () => {
  const server = new ServerProcess({
    directory: path.join(os.tmpdir(), 'missing-flipper-bundle'),
    logFile: 'unused.log',
  });
  await assert.rejects(server.start(), /bundle is missing/);
  assert.equal(server.child, undefined);
});
