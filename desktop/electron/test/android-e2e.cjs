const fs = require('fs');
const {createRequire} = require('module');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));
const WS = requireDesktop('ws');
const {createFlipperServerWithSocket} = requireDesktop('flipper-server-client');
const {execFileSync} = require('child_process');
const adb = process.env.LOCALAPPDATA + '/Android/Sdk/platform-tools/adb.exe';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const html = await (await fetch('http://localhost:52342')).text();
  const token = html.match(/authToken: '([^']+)'/)?.[1];
  if (!token) throw Error('Missing normal server authentication token');
  const socket = new WS(
    'ws://localhost:52342?token=' + encodeURIComponent(token),
  );
  const server = await createFlipperServerWithSocket(socket, 52342, () => {});
  const devices = await server.exec('device-list');
  execFileSync(adb, [
    'shell',
    'am',
    'force-stop',
    'com.facebook.flipper.sample',
  ]);
  execFileSync(adb, [
    'shell',
    'am',
    'start',
    '-W',
    '-n',
    'com.facebook.flipper.sample/.MainActivity',
  ]);
  let client;
  const connectionDeadline = Date.now() + 30000;
  while (!client && Date.now() < connectionDeadline) {
    const clients = await server.exec('client-list');
    client = clients.find(
      (c) =>
        c.query.app_id === 'com.facebook.flipper.sample' ||
        c.query.app === 'Flipper',
    );
    if (!client) await delay(500);
  }
  if (!client) throw Error('Sample client is not connected');
  const plugins = await server.exec('client-request-response', client.id, {
    id: 9990,
    method: 'getPlugins',
  });
  const requests = [],
    responses = [],
    logs = [];
  server.on('client-message', (data) => {
    if (data.id !== client.id) return;
    const msg = JSON.parse(data.message);
    if (msg.params?.api !== 'Network') return;
    if (msg.params.method === 'newRequest') requests.push(msg.params.params);
    if (msg.params.method === 'newResponse') responses.push(msg.params.params);
  });
  server.on('device-log', (data) => {
    if (data.serial === 'emulator-5554' && data.entry.tag === 'Flipper')
      logs.push(data.entry);
  });
  await server.exec('client-request', client.id, {
    method: 'init',
    params: {plugin: 'Network'},
  });
  await delay(1000);
  requests.length = responses.length = logs.length = 0;
  execFileSync(adb, [
    'shell',
    'uiautomator',
    'dump',
    '/sdcard/flipper-test-ui.xml',
  ]);
  const layout = execFileSync(
    adb,
    ['shell', 'cat', '/sdcard/flipper-test-ui.xml'],
    {encoding: 'utf8'},
  );
  const clickTargets = (layout.match(/<node\b[^>]*>/g) || []).filter(
    (node) =>
      node.includes('package="com.facebook.flipper.sample"') &&
      node.includes('clickable="true"'),
  );
  for (const [index, method] of ['GET', 'POST'].entries()) {
    // Litho draws text on a canvas; its first two clickable views are GET/POST.
    const node =
      layout.match(
        new RegExp('<node[^>]*text="Send HTTP/' + method + ' request"[^>]*>'),
      )?.[0] || clickTargets[index];
    const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!bounds)
      throw Error(`Could not locate ${method} button in the sample app`);
    execFileSync(adb, [
      'shell',
      'input',
      'tap',
      String(Math.floor((+bounds[1] + +bounds[3]) / 2)),
      String(Math.floor((+bounds[2] + +bounds[4]) / 2)),
    ]);
  }
  const deadline = Date.now() + 45000;
  while (
    Date.now() < deadline &&
    !(requests.length >= 2 && responses.length >= 2 && logs.length)
  )
    await delay(500);
  const results = requests.map((r) => {
    const response = responses.find((s) => s.id === r.id);
    let body;
    try {
      body = JSON.parse(Buffer.from(response?.data || '', 'base64').toString());
    } catch {}
    return {
      method: r.method,
      url: r.url,
      status: response?.status,
      bodyVerified:
        r.method === 'POST'
          ? body?.form?.app === 'Flipper'
          : body?.name === 'yoga',
    };
  });
  const finalDevices = await server.exec('device-list');
  const report = {
    time: new Date().toISOString(),
    devices: finalDevices.map((d) => ({serial: d.serial, title: d.title})),
    client: client.id,
    plugins,
    network: results,
    logCount: logs.length,
    pass:
      results.length >= 2 &&
      results.every((r) => r.status === 200 && r.bodyVerified) &&
      logs.length > 0,
  };
  fs.writeFileSync(
    path.join(root, 'work/desktop-e2e.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await server.exec('client-request', client.id, {
    method: 'deinit',
    params: {plugin: 'Network'},
  });
  socket.close();
  process.exit(report.pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
