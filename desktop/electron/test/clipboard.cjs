// Copyright (c) Meta Platforms, Inc. and affiliates. MIT license.
// Uses only synthetic data; preserves the user's clipboard in memory.
const {app, BrowserWindow, clipboard, ClipboardItem} = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {configurePermissions} = require('../permissions.cjs');

const output = path.resolve(__dirname, '../../../work/clipboard-smoke');
fs.mkdirSync(output, {recursive: true});
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')));
app.setAppLogsPath(path.join(output, 'logs'));
app.on('window-all-closed', () => {});
let window;
let savedClipboard;
const server = http.createServer((_request, response) => {
  response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  response.end(
    '<!doctype html><title>Flipper clipboard test</title><button>Copy synthetic body</button>',
  );
});
const timeout = setTimeout(() => {
  console.error('Clipboard test timed out');
  app.exit(1);
}, 30000);

(async () => {
  await app.whenReady();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({
    width: 500,
    height: 200,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  const contents = window.webContents;
  const evaluate = (code) => contents.executeJavaScript(code, true);
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setPermissionRequestHandler(
    (_sender, _permission, callback) => callback(false),
  );
  await window.loadURL(origin);
  window.focus();
  await evaluate('document.querySelector("button").focus()');
  assert.equal(
    await evaluate('document.hasFocus()'),
    true,
    'Test window must be focused',
  );
  // Resolve every format before modifying the clipboard (read items may be lazy).
  savedClipboard = await Promise.all(
    (await clipboard.read()).map(
      async (item) =>
        new ClipboardItem(
          Object.fromEntries(
            await Promise.all(
              item.types.map(async (type) => [type, await item.getType(type)]),
            ),
          ),
        ),
    ),
  );
  await clipboard.writeText('synthetic clipboard sentinel');
  const body =
    '{\n  "response": "respuesta ñ 🚀",\n  "number": 9007199254740993\n}';
  // Windows' native text clipboard normalizes line endings to CRLF.
  const nativeBody =
    process.platform === 'win32' ? body.replace(/\n/g, '\r\n') : body;
  const copy = `navigator.clipboard.writeText(${JSON.stringify(body)}).then(() => 'copied', error => error.name)`;
  assert.equal(
    await evaluate(copy),
    'NotAllowedError',
    'Old permission policy reproduces the failure',
  );
  configurePermissions(window, origin);
  assert.equal(await evaluate(copy), 'copied');
  // Chromium may flush the OS clipboard after resolving the renderer promise.
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await clipboard.readText()) === nativeBody) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(
    await clipboard.readText(),
    nativeBody,
    'Native clipboard contains the exact original body',
  );
  assert.equal(
    await evaluate(
      "navigator.clipboard.readText().then(() => 'read', error => error.name)",
    ),
    'NotAllowedError',
    'Renderer clipboard reads remain denied',
  );
  console.log(
    `Clipboard test passed (${process.platform}/${process.arch}): old failure reproduced, exact body copied, reads denied`,
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (savedClipboard !== undefined) await clipboard.write(savedClipboard);
    } catch (error) {
      console.error('Could not restore clipboard:', error.name);
      process.exitCode = 1;
    }
    clearTimeout(timeout);
    window?.destroy();
    server.close();
    app.exit(process.exitCode || 0);
  });
