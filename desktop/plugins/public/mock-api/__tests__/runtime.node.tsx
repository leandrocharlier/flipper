/**
 * Copyright (c) Flipper Community contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @jest-environment node
 * @format
 */
import {promises as fs} from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import net from 'net';
import {
  BodyTypes,
  BuildEnvironment,
  BuildResponseRule,
  BuildRouteResponse,
  HighestMigrationId,
} from '@mockoon/commons';
import {MockApiRuntime} from '../runtime';
import type {Environment} from '@mockoon/commons';

jest.setTimeout(20000);
let directory: string;
let runtime: MockApiRuntime;
beforeEach(async () => {
  directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flipper-mock-api-test-'),
  );
  runtime = new MockApiRuntime(directory);
});
afterEach(async () => {
  await runtime.close();
  await fs.rm(directory, {recursive: true, force: true});
});

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
function request(port: number, endpoint = '/hello', tls = false) {
  return new Promise<{status: number; body: string}>((resolve, reject) => {
    const req = (tls ? https : http).get(
      {
        hostname: '127.0.0.1',
        port,
        path: endpoint,
        rejectUnauthorized: false,
        agent: false,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk.toString()));
        res.on('end', () => resolve({status: res.statusCode!, body}));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Request timeout')));
  });
}
async function environment() {
  const env: Environment = JSON.parse(
    JSON.stringify(
      BuildEnvironment({
        hasDefaultRoute: true,
        hasContentTypeHeader: false,
        hasCorsHeaders: false,
        port: await freePort(),
      }),
    ),
  );
  env.hostname = '127.0.0.1';
  env.routes[0].endpoint = 'hello';
  env.routes[0].responses[0].body = 'original';
  return env;
}
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 7000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('State did not change');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('new environments default to port 3000 and never start automatically', async () => {
  const id = await runtime.create();
  expect(runtime.snapshot().records[0].environment.port).toBe(3000);
  expect(runtime.snapshot().statuses[id]?.running).toBeFalsy();
});

test('runs HTTP, retains the running configuration until reload, and releases the port', async () => {
  const env = await environment();
  const [id] = await runtime.import(JSON.stringify(env), 'mockoon');
  await runtime.start(id);
  expect(await request(env.port)).toEqual({status: 200, body: 'original'});
  const edited = runtime.snapshot().records[0];
  edited.environment.routes[0].responses[0].body = 'changed';
  await runtime.save(edited);
  expect(runtime.snapshot().statuses[id].reloadRequired).toBe(true);
  expect((await request(env.port)).body).toBe('original');
  await runtime.restart(id);
  expect((await request(env.port)).body).toBe('changed');
  expect(runtime.snapshot().statuses[id].reloadRequired).toBeFalsy();
  expect(runtime.logs(id).length).toBeGreaterThan(0);
  runtime.clearLogs(id);
  expect(runtime.logs(id)).toEqual([]);
  await runtime.stop(id);
  await expect(request(env.port)).rejects.toThrow();
});

test('serves real HTTPS with the engine development certificate', async () => {
  const env = await environment();
  env.tlsOptions.enabled = true;
  const [id] = await runtime.import(JSON.stringify(env), 'mockoon');
  await runtime.start(id);
  expect((await request(env.port, '/hello', true)).body).toBe('original');
});

test('uses response rules and request templates from the Mockoon engine', async () => {
  const env = await environment();
  const selected = BuildRouteResponse();
  selected.body = 'hello {{queryParam "name"}}';
  selected.statusCode = 201;
  selected.rules = [
    {
      ...BuildResponseRule(),
      target: 'query',
      modifier: 'name',
      value: 'Synthetic',
      operator: 'equals',
    },
  ];
  env.routes[0].responses = [
    selected,
    {...env.routes[0].responses[0], default: true},
  ];
  const [id] = await runtime.import(JSON.stringify(env), 'mockoon');
  await runtime.start(id);
  expect(await request(env.port, '/hello?name=Synthetic')).toEqual({
    status: 201,
    body: 'hello Synthetic',
  });
  expect((await request(env.port)).body).toBe('original');
});

test('imports multiple environments, detects port conflicts and recovers after Stop', async () => {
  const env = await environment();
  const ids = await runtime.import(JSON.stringify([env, env]), 'mockoon');
  expect(new Set(ids).size).toBe(2);
  await runtime.start(ids[0]);
  await expect(runtime.start(ids[1])).rejects.toThrow();
  expect(runtime.snapshot().statuses[ids[1]].running).toBe(false);
  expect((await request(env.port)).body).toBe('original');
  await runtime.stop(ids[0]);
  await runtime.start(ids[1]);
  expect((await request(env.port)).body).toBe('original');
});

test('watches external JSON edits, retains invalid files and applies valid changes only on reload', async () => {
  const env = await environment();
  const source = path.join(directory, 'synthetic-source.json');
  await fs.writeFile(source, JSON.stringify(env));
  const [id] = await runtime.import(JSON.stringify(env), 'mockoon', source);
  await runtime.start(id);
  env.routes[0].responses[0].body = 'external change';
  await fs.writeFile(source, JSON.stringify(env));
  await waitFor(() => !!runtime.snapshot().statuses[id].reloadRequired);
  expect((await request(env.port)).body).toBe('original');
  await runtime.restart(id);
  expect((await request(env.port)).body).toBe('external change');
  await fs.writeFile(source, '{invalid');
  await waitFor(() => !!runtime.snapshot().statuses[id].error);
  expect((await request(env.port)).body).toBe('external change');
  expect(
    runtime.snapshot().records[0].environment.routes[0].responses[0].body,
  ).toBe('external change');
});

test('persists environments but strips TLS and admin passwords from disk and exports', async () => {
  const id = await runtime.create();
  const record = runtime.snapshot().records[0];
  record.environment.tlsOptions.passphrase = 'synthetic-test-only-passphrase';
  record.options.adminApiAuthToken = 'synthetic-test-only-admin-token';
  await runtime.save(record);
  const saved = await fs.readFile(runtime.storagePath, 'utf8');
  const exported = await runtime.export(id, 'mockoon');
  expect(saved).not.toContain('synthetic-test-only');
  expect(exported).not.toContain('synthetic-test-only');
  await runtime.close();
  runtime = new MockApiRuntime(directory);
  const workspace = await runtime.load();
  expect(workspace.records[0].environment.uuid).toBe(id);
  expect(workspace.statuses[id]?.running).toBeFalsy();
});

test('rejects unknown future schemas and invalid batches without partial imports', async () => {
  const env = await environment();
  await expect(
    runtime.import(
      JSON.stringify([env, {...env, lastMigration: HighestMigrationId + 1}]),
      'mockoon',
    ),
  ).rejects.toThrow('newer');
  expect(runtime.snapshot().records).toEqual([]);
  await expect(
    runtime.import(JSON.stringify({...env, port: 70000}), 'mockoon'),
  ).rejects.toThrow();
});

test('imports and exports OpenAPI', async () => {
  const [id] = await runtime.import(
    JSON.stringify({
      openapi: '3.0.0',
      info: {title: 'Synthetic API', version: '1.0'},
      paths: {
        '/hello': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {'application/json': {example: {ok: true}}},
              },
            },
          },
        },
      },
    }),
    'openapi',
  );
  expect(runtime.snapshot().records[0].environment.port).toBe(3000);
  const exported = JSON.parse(await runtime.export(id, 'openapi'));
  expect(exported.paths['/hello']).toBeDefined();
});

test('automatically detects Mockoon JSON and keeps its format for source watching', async () => {
  const env = await environment();
  const source = path.join(directory, 'synthetic-detected.json');
  const text = JSON.stringify([env, env]);
  await fs.writeFile(source, text);
  const ids = await runtime.import(text, undefined, source);
  expect(ids).toHaveLength(2);
  expect(
    runtime.snapshot().records.map((record) => record.source?.format),
  ).toEqual(['mockoon', 'mockoon']);
});

test.each([
  JSON.stringify({
    openapi: '3.0.0',
    info: {title: 'Synthetic detected API', version: '1.0'},
    paths: {},
  }),
  'openapi: 3.0.0\ninfo:\n  title: Synthetic detected API\n  version: "1.0"\npaths: {}\n',
])('automatically detects an OpenAPI document', async (text) => {
  const ids = await runtime.import(text);
  expect(ids).toHaveLength(1);
  expect(runtime.snapshot().records[0].environment.name).toBe(
    'Synthetic detected API',
  );
});

test('rejects unrelated JSON without adding environments', async () => {
  await expect(
    runtime.import('{"message":"not an environment"}'),
  ).rejects.toThrow('Expected a Mockoon');
  expect(runtime.snapshot().records).toEqual([]);
});

test('reopening preserves local edits when an imported source has not changed', async () => {
  const env = await environment();
  const source = path.join(directory, 'synthetic-original.json');
  const original = JSON.stringify(env);
  await fs.writeFile(source, original);
  await runtime.import(original, 'mockoon', source);
  const record = runtime.snapshot().records[0];
  record.environment.routes[0].responses[0].body = 'saved local edit';
  await runtime.save(record);
  await runtime.close();
  runtime = new MockApiRuntime(directory);
  const workspace = await runtime.load();
  expect(workspace.records[0].environment.routes[0].responses[0].body).toBe(
    'saved local edit',
  );
  expect(await fs.readFile(source, 'utf8')).toBe(original);
});

test('serves HTTPS using relative PEM and encrypted PFX files', async () => {
  // Generate a disposable synthetic certificate. No user keys or committed keys.
  const forge = require('node-forge');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60000);
  cert.validity.notAfter = new Date(Date.now() + 3600000);
  cert.setSubject([{name: 'commonName', value: 'localhost'}]);
  cert.setIssuer(cert.subject.attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  await fs.writeFile(
    path.join(directory, 'synthetic-cert.pem'),
    forge.pki.certificateToPem(cert),
  );
  await fs.writeFile(
    path.join(directory, 'synthetic-key.pem'),
    forge.pki.privateKeyToPem(keys.privateKey),
  );
  const password = 'disposable-test-password';
  const pfx = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
  });
  await fs.writeFile(
    path.join(directory, 'synthetic.pfx'),
    Buffer.from(forge.asn1.toDer(pfx).getBytes(), 'binary'),
  );
  const env = await environment();
  env.tlsOptions = {
    ...env.tlsOptions,
    enabled: true,
    certPath: 'synthetic-cert.pem',
    keyPath: 'synthetic-key.pem',
    caPath: 'synthetic-cert.pem',
  };
  const [id] = await runtime.import(JSON.stringify(env), 'mockoon');
  await runtime.start(id);
  expect((await request(env.port, '/hello', true)).body).toBe('original');
  await runtime.stop(id);
  const record = runtime.snapshot().records[0];
  record.environment.tlsOptions = {
    ...record.environment.tlsOptions,
    type: 'PFX',
    pfxPath: 'synthetic.pfx',
    passphrase: password,
    certPath: '',
    keyPath: '',
    caPath: '',
  };
  await runtime.save(record);
  await runtime.start(id);
  expect((await request(env.port, '/hello', true)).body).toBe('original');
  expect(await fs.readFile(runtime.storagePath, 'utf8')).not.toContain(
    password,
  );
});

test('proxies unmatched requests and supports relative response files', async () => {
  const upstream = http.createServer((_req, res) =>
    res.end('synthetic upstream'),
  );
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', resolve),
  );
  try {
    const env = await environment();
    env.proxyMode = true;
    env.proxyHost = `http://127.0.0.1:${(upstream.address() as net.AddressInfo).port}`;
    env.routes[0].responses[0].bodyType = BodyTypes.FILE;
    env.routes[0].responses[0].filePath = 'synthetic-response.txt';
    env.routes[0].responses[0].sendFileAsBody = true;
    await fs.writeFile(
      path.join(directory, 'synthetic-response.txt'),
      'synthetic file',
    );
    const [id] = await runtime.import(JSON.stringify(env), 'mockoon');
    await runtime.start(id);
    expect((await request(env.port)).body).toBe('synthetic file');
    expect((await request(env.port, '/unmatched')).body).toBe(
      'synthetic upstream',
    );
  } finally {
    await runtime.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
