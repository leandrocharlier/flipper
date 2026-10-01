// End-to-end test of the published Android consumer with a real desktop server bundle.
// Use a free desktop port and the generated debug consumer installed on a 16 KB emulator.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));
const WS = requireDesktop('ws');
const {createFlipperServerWithSocket} = requireDesktop('flipper-server-client');
const {ServerProcess} = require('../desktop/electron/server-process.cjs');
const {serverDirectory} = require('../desktop/electron/platform.cjs');
const output = path.join(root, 'work/maven-desktop-test');
const serial = process.env.ANDROID_SERIAL || 'emulator-5554';
const adb = process.env.ADB || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe') : 'adb');
const packageId = 'com.example.flipper.mavenvalidation.integration';
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], {encoding: 'utf8', windowsHide: true});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = async (promise, ms = 45000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Synthetic desktop test timed out')), ms); })]); }
  finally { clearTimeout(timer); }
};

(async () => {
  // Do not stop or reuse a desktop instance the user already has open.
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(Error('Port 52342 is in use; close Flipper before running this test')));
    probe.listen(52342, '127.0.0.1', () => probe.close(resolve));
  });
  fs.mkdirSync(output, {recursive: true});
  const desktop = new ServerProcess({directory: process.argv[2] ? path.resolve(process.argv[2]) : serverDirectory(),
    logFile: path.join(output, 'server.log')});
  const mock = http.createServer((_request, response) => {
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end('{"synthetic":"published-maven"}');
  });
  let socket, mockPort;
  try {
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
    mockPort = mock.address().port;
    command('reverse', `tcp:${mockPort}`, `tcp:${mockPort}`);
    await desktop.start();
    const html = await (await fetch('http://localhost:52342')).text();
    const token = html.match(/authToken: '([^']+)'/)?.[1];
    assert.ok(token, 'Local desktop session initialized');
    socket = new WS('ws://localhost:52342?token=' + encodeURIComponent(token));
    const server = await timeout(createFlipperServerWithSocket(socket, 52342, () => {}));
    await server.exec('device-list');
    const requests = [], responses = [], logs = [];
    let client;
    server.on('client-message', data => {
      if (data.id !== client?.id) return;
      const message = JSON.parse(data.message);
      if (message.params?.api !== 'Network') return;
      if (message.params.method === 'newRequest') requests.push(message.params.params);
      if (message.params.method === 'newResponse') responses.push(message.params.params);
    });
    server.on('device-log', data => {
      if (data.serial === serial && data.entry.tag === 'MavenPublishedTest') logs.push(data.entry);
    });
    command('shell', 'am', 'force-stop', packageId);
    command('shell', 'am', 'start', '-W', '-n', `${packageId}/com.example.flipper.mavenvalidation.PluginFixtureActivity`, '--ez', 'desktopTest', 'true');
    for (let i = 0; i < 90 && !client; i++) {
      const clients = await server.exec('client-list');
      client = clients.find(c => c.query.app_id === packageId);
      if (!client) await delay(500);
    }
    assert.ok(client, 'Published Maven SDK connected to the desktop');
    const plugins = await timeout(server.exec('client-request-response', client.id, {id: 7600, method: 'getPlugins'}));
    assert.ok(JSON.stringify(plugins).includes('Network'));
    assert.ok(JSON.stringify(plugins).includes('MavenValidation'));
    for (const plugin of ['Network', 'MavenValidation']) {
      await server.exec('client-request', client.id, {method: 'init', params: {plugin}});
    }
    await delay(300);
    const url = `http://127.0.0.1:${mockPort}/synthetic-maven`;
    const reply = await timeout(server.exec('client-request-response', client.id, {
      id: 7601, method: 'execute', params: {api: 'MavenValidation', method: 'execute', params: {url}},
    }));
    assert.ok(JSON.stringify(reply).includes('published-maven'), 'Plugin RPC returns the synthetic body');
    for (let i = 0; i < 40 && !(responses.length && logs.length); i++) await delay(250);
    const request = requests.find(r => r.url === url);
    assert.ok(request, 'Desktop received the Network request');
    const response = responses.find(r => r.id === request.id);
    assert.equal(response?.status, 200);
    assert.deepEqual(JSON.parse(Buffer.from(response.data, 'base64').toString()), {synthetic: 'published-maven'});
    assert.ok(logs.length > 0, 'Desktop received the synthetic Android log');
    const report = {pass: true, packageId, plugins: ['Network', 'MavenValidation'],
      networkStatus: response.status, responseBodyVerified: true, syntheticLogs: logs.length,
      internalServerPackageVersion: JSON.parse(fs.readFileSync(path.join(desktop.directory, 'package.json'))).version};
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    socket?.close();
    try {
      await new Promise(resolve => mock.close(resolve));
      command('shell', 'am', 'force-stop', packageId);
      if (mockPort) command('reverse', '--remove', `tcp:${mockPort}`);
    } finally { await desktop.stop(); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
