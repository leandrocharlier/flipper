// Exercises the same bootstrap and shutdown path as the distributed application.
const {app} = require('electron');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {launch} = require('../main.cjs');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'work', 'electron-smoke');
fs.mkdirSync(output, {recursive: true});
app.setPath('userData', path.join(output, 'profile'));
app.setAppLogsPath(path.join(output, 'logs'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let desktop;
const result = {};
async function enableAndOpenPlugin(name) {
  const literal = JSON.stringify(name);
  await desktop.window.webContents.executeJavaScript(`(() => {
    const label = Array.from(document.querySelectorAll('.ant-menu-item .ant-typography')).find(item => item.textContent === ${literal});
    if (!label) Array.from(document.querySelectorAll('.ant-menu-submenu-title')).find(item => item.textContent.includes('Disabled') && item.getAttribute('aria-expanded') === 'false')?.click();
  })()`);
  await delay(250);
  await desktop.window.webContents.executeJavaScript(`(() => {
    const label = Array.from(document.querySelectorAll('.ant-menu-item .ant-typography')).find(item => item.textContent === ${literal});
    label?.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
  })()`);
  await delay(250);
  await desktop.window.webContents.executeJavaScript(`(() => {
    const item = Array.from(document.querySelectorAll('.ant-menu-item')).find(item => item.textContent.trim() === ${literal});
    item?.querySelector('button[title="Enable plugin"]')?.click();
    item?.click();
  })()`);
  await delay(1000);
}
app.on('will-quit', () => {
  result.serverExitCode = desktop?.server.child.exitCode;
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify(result, null, 2),
  );
  if (result.serverExitCode !== 0 || result.error) app.exit(1);
});

(async () => {
  desktop = await launch({
    show: true,
    onFailure: (error) => {
      throw error;
    },
  });
  assert.ok(desktop, 'Desktop started');
  result.serverPid = desktop.server.child.pid;
  const preferences = desktop.window.webContents.getLastWebPreferences();
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  // Flipper defines its own browser module loader. It must not expose Node APIs.
  assert.equal(
    await desktop.window.webContents.executeJavaScript(`(() => {
    try { return typeof window.require('node:fs').readFileSync === 'function'; } catch { return false; }
  })()`),
    false,
  );
  result.rendererSandbox = true;
  if (process.env.FLIPPER_ANDROID_E2E === '1') {
    await new Promise((resolve, reject) => {
      const child = spawn(
        path.join(root, 'dist/flipper-server-windows/flipper-runtime.exe'),
        [path.join(__dirname, 'android-e2e.cjs')],
        {cwd: root, stdio: 'inherit', windowsHide: true},
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Android integration failed: ${code}`)),
      );
    });
    result.androidNetworkAndLogs = true;
  }
  // Wait for the React interface, beyond the initial HTML document.
  let body;
  for (let i = 0; i < 90; i++) {
    body = await desktop.window.webContents.executeJavaScript(
      'document.body.innerText',
    );
    if (body.includes('Skip Setup Wizard')) {
      await desktop.window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Skip Setup Wizard'))?.click()`,
      );
    }
    if (!body.includes('Network')) {
      await desktop.window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.ant-menu-submenu-title')).find(item => item.textContent.includes('Disabled') && item.getAttribute('aria-expanded') === 'false')?.click()`,
      );
    }
    if (
      body.includes('Logs') &&
      (!process.env.FLIPPER_ANDROID_E2E || body.includes('Network'))
    )
      break;
    await delay(1000);
  }
  fs.writeFileSync(path.join(output, 'ui.txt'), body);
  fs.writeFileSync(
    path.join(output, 'desktop.png'),
    (await desktop.window.webContents.capturePage()).toPNG(),
  );
  assert.ok(body.includes('Logs'), 'Logs appears in the desktop interface');
  if (process.env.FLIPPER_ANDROID_E2E === '1')
    assert.ok(
      body.includes('Network'),
      'Network appears with the sample app connected',
    );
  result.pluginsVisible = true;
  if (process.env.FLIPPER_ANDROID_E2E === '1') {
    await enableAndOpenPlugin('Network');
    const networkBody = await desktop.window.webContents.executeJavaScript(
      'document.body.innerText',
    );
    fs.writeFileSync(path.join(output, 'network-ui.txt'), networkBody);
    assert.ok(
      networkBody.includes('Method') && networkBody.includes('Status'),
      'Network table renders in Electron',
    );
    result.networkTableRendered = true;
    const {tapSampleAction} = require('./android-actions.cjs');
    tapSampleAction(0);
    tapSampleAction(1);
    let rows;
    for (let i = 0; i < 30; i++) {
      rows = await desktop.window.webContents.executeJavaScript(
        'document.body.innerText',
      );
      if (
        rows.includes('api.github.com') &&
        rows.includes('httpbin.org') &&
        rows.includes('200')
      )
        break;
      await delay(500);
    }
    assert.ok(
      rows.includes('api.github.com') &&
        rows.includes('httpbin.org') &&
        rows.includes('200'),
      'Live requests appear in the Network table',
    );
    result.networkRowsRendered = true;
    fs.writeFileSync(
      path.join(output, 'network.png'),
      (await desktop.window.webContents.capturePage()).toPNG(),
    );
    await enableAndOpenPlugin('Example Plugin');
    tapSampleAction(2);
    await delay(1000);
    await desktop.window.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('*')).find(item => item.children.length === 0 && item.textContent === 'Alerts')?.click()`,
    );
    await delay(500);
    await desktop.window.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('*')).find(item => item.children.length === 0 && item.textContent === 'View detail')?.click()`,
    );
    await delay(250);
    const alerts = await desktop.window.webContents.executeJavaScript(
      'document.body.innerText',
    );
    fs.writeFileSync(path.join(output, 'alerts-ui.txt'), alerts);
    assert.ok(
      alerts.includes('Example Notification') &&
        alerts.includes('Notification: 0'),
      'Android Trigger notification appears in desktop Alerts',
    );
    result.exampleNotification = true;
    fs.writeFileSync(
      path.join(output, 'notification.png'),
      (await desktop.window.webContents.capturePage()).toPNG(),
    );
  }
  fs.writeFileSync(
    path.join(output, 'desktop.png'),
    (await desktop.window.webContents.capturePage()).toPNG(),
  );
  // Closing the last window must also terminate the backend without a forced kill.
  desktop.window.close();
})().catch((error) => {
  result.error = error.stack;
  console.error(error);
  app.quit();
});
