/**
 * Copyright (c) Flipper Community contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */
import {
  BuildEnvironment,
  BuildHTTPRoute,
  BuildRouteResponse,
  BuildResponseRule,
  BuildDatabucket,
  BuildCallback,
  Environment,
  EnvironmentSchemaNoFix,
  HighestMigrationId,
  Migrations,
  OpenApiConverter,
  repairRefs,
} from '@mockoon/commons';
import {MockoonServer} from '@mockoon/commons-server';
// This module runs only in the server add-on, never in the renderer.
/* eslint-disable no-restricted-imports */
import {promises as fs, watchFile, unwatchFile, Stats} from 'fs';
import path from 'path';
import {randomUUID, createHash} from 'crypto';
/* eslint-enable no-restricted-imports */
import {MockEnvironment, MockLog, RuntimeStatus, Workspace} from './contract';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const MAX_LOGS = 500;
const MAX_BODY = 65536;
const contentHash = (text: string) =>
  createHash('sha256').update(text).digest('hex');

export function normalizeEnvironment(input: unknown): Environment {
  if (
    !input ||
    typeof input !== 'object' ||
    !Array.isArray((input as Environment).routes)
  ) {
    throw new Error('Expected a Mockoon environment with a routes array.');
  }
  const env = clone(input as Environment);
  if (!Number.isInteger(env.lastMigration)) {
    throw new Error(
      'Missing Mockoon migration version. Export an environment from Mockoon first.',
    );
  }
  if (env.lastMigration > HighestMigrationId) {
    throw new Error(
      'This file needs a newer Mockoon engine. The original file was not changed.',
    );
  }
  for (const migration of Migrations) {
    if (migration.id > env.lastMigration) {
      migration.migrationFunction(env);
      env.lastMigration = migration.id;
    }
  }
  const result = EnvironmentSchemaNoFix.validate(env, {abortEarly: false});
  if (result.error)
    throw new Error(`Invalid Mockoon configuration: ${result.error.message}`);
  if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65535) {
    throw new Error('Port must be between 1 and 65535.');
  }
  const ids = env.routes.map((route) => route.uuid);
  if (new Set(ids).size !== ids.length)
    throw new Error('Route IDs must be unique.');
  const tls = env.tlsOptions;
  if (
    tls.enabled &&
    tls.type === 'CERT' &&
    Boolean(tls.certPath) !== Boolean(tls.keyPath)
  ) {
    throw new Error(
      'Select both the TLS certificate and private key, or leave both empty for the built-in development certificate.',
    );
  }
  return repairRefs(env);
}

export class MockApiRuntime {
  private records: MockEnvironment[] = [];
  private servers = new Map<string, MockoonServer>();
  private statuses: Record<string, RuntimeStatus> = {};
  private transactions = new Map<string, MockLog[]>();
  private queue: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private loading?: Promise<void>;
  private closed = false;
  private watched = new Map<
    string,
    (current: Stats, previous: Stats) => void
  >();
  readonly storagePath: string;

  constructor(
    readonly directory: string,
    private changed: (workspace: Workspace) => void = () => {},
    private transaction: (log: MockLog) => void = () => {},
  ) {
    this.storagePath = path.join(directory, 'environments.json');
  }

  // Serialize edits/start/stop so rapid UI actions cannot leak listening servers
  // or overwrite newer edits with an older disk write.
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (this.closed) throw new Error('Mock API has stopped.');
      await this.load();
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async load(): Promise<Workspace> {
    if (!this.loaded && !this.loading) {
      this.loading = this.loadRecords().finally(() => {
        this.loading = undefined;
      });
    }
    await this.loading;
    return this.snapshot();
  }

  private async loadRecords() {
    try {
      const saved = JSON.parse(await fs.readFile(this.storagePath, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.records))
        throw new Error('Unsupported saved Mock API workspace.');
      this.records = saved.records.map((record: MockEnvironment) =>
        this.validateRecord(record),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const sourcePath of new Set(
      this.records.flatMap((record) =>
        record.source ? [record.source.path] : [],
      ),
    )) {
      await this.refreshSource(sourcePath);
    }
    this.watchSources();
    this.loaded = true;
  }

  snapshot(): Workspace {
    return {
      records: this.records.map((record) => this.publicRecord(record)),
      statuses: clone(this.statuses),
      storagePath: this.storagePath,
      templates: {
        route: BuildHTTPRoute(),
        response: BuildRouteResponse(),
        rule: BuildResponseRule(),
        data: BuildDatabucket(),
        callback: BuildCallback(),
      },
    };
  }

  private publicRecord(record: MockEnvironment): MockEnvironment {
    const result = clone(record);
    result.environment.tlsOptions.passphrase = '';
    delete result.options.adminApiAuthToken;
    return result;
  }

  private validateRecord(record: MockEnvironment): MockEnvironment {
    const environment = normalizeEnvironment(record.environment);
    const directory = record.directory || this.directory;
    if (!path.isAbsolute(directory))
      throw new Error('The working directory must be an absolute path.');
    if (
      record.options &&
      (typeof record.options !== 'object' || Array.isArray(record.options))
    ) {
      throw new Error('Runtime options must be a JSON object.');
    }
    return {
      environment,
      directory,
      options: clone(record.options || {}),
      disabledRoutes: Array.isArray(record.disabledRoutes)
        ? record.disabledRoutes.filter((id) => typeof id === 'string')
        : [],
      ...(record.source &&
      path.isAbsolute(record.source.path) &&
      Number.isInteger(record.source.index)
        ? {source: clone(record.source)}
        : {}),
    };
  }

  private record(id: string) {
    const record = this.records.find((item) => item.environment.uuid === id);
    if (!record) throw new Error('Environment not found.');
    return record;
  }

  private async persist() {
    await fs.mkdir(this.directory, {recursive: true, mode: 0o700});
    const temporary = `${this.storagePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify(
          {
            version: 1,
            records: this.records.map((record) => this.publicRecord(record)),
          },
          null,
          2,
        ),
        {mode: 0o600},
      );
      await fs.rename(temporary, this.storagePath);
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  create(): Promise<string> {
    return this.serial(async () => {
      const environment = BuildEnvironment({
        hasDefaultRoute: true,
        hasContentTypeHeader: true,
        hasCorsHeaders: true,
        port: 3000,
      });
      environment.hostname = '127.0.0.1';
      environment.name = `Mock API ${this.records.length + 1}`;
      this.records.push({
        environment,
        directory: this.directory,
        options: {},
        disabledRoutes: [],
      });
      await this.persist();
      this.changed(this.snapshot());
      return environment.uuid;
    });
  }

  save(input: MockEnvironment): Promise<Workspace> {
    return this.serial(async () => {
      const next = this.validateRecord(input);
      const previous = this.record(next.environment.uuid);
      // Passwords stay in memory for this session and never enter exports/disk.
      next.environment.tlsOptions.passphrase ||=
        previous.environment.tlsOptions.passphrase;
      next.options.adminApiAuthToken ||= previous.options.adminApiAuthToken;
      const running = this.servers.has(next.environment.uuid);
      this.records[this.records.indexOf(previous)] = next;
      await this.persist();
      if (running)
        this.statuses[next.environment.uuid] = {
          ...this.statuses[next.environment.uuid],
          running: true,
          reloadRequired: true,
        };
      this.watchSources();
      const snapshot = this.snapshot();
      this.changed(snapshot);
      return snapshot;
    });
  }

  remove(id: string): Promise<Workspace> {
    return this.serial(async () => {
      await this.stopInternal(id);
      this.records = this.records.filter(
        (record) => record.environment.uuid !== id,
      );
      this.transactions.delete(id);
      delete this.statuses[id];
      await this.persist();
      this.watchSources();
      const snapshot = this.snapshot();
      this.changed(snapshot);
      return snapshot;
    });
  }

  start(id: string): Promise<Workspace> {
    return this.serial(async () => {
      await this.startInternal(id);
      const snapshot = this.snapshot();
      this.changed(snapshot);
      return snapshot;
    });
  }

  private async startInternal(id: string) {
    if (this.servers.has(id)) return;
    const record = this.record(id);
    const server = new MockoonServer(clone(record.environment), {
      ...record.options,
      environmentDirectory: record.directory,
      disabledRoutes: record.disabledRoutes,
      enableAdminApi: record.options.enableAdminApi ?? false,
      maxTransactionLogs: MAX_LOGS,
    });
    this.servers.set(id, server);
    server.on('error', (code, error) => {
      this.statuses[id] = {
        running: this.statuses[id]?.running ?? false,
        error: `${code}${error ? `: ${error.message}` : ''}`,
      };
      this.changed(this.snapshot());
    });
    server.on('transaction-complete', (transaction) => {
      const safe = clone(transaction);
      safe.response.body = String(safe.response.body ?? '').slice(0, MAX_BODY);
      safe.request.body = (
        typeof safe.request.body === 'string'
          ? safe.request.body
          : JSON.stringify(safe.request.body ?? '')
      ).slice(0, MAX_BODY);
      const log = {environmentId: id, transaction: safe};
      const logs = this.transactions.get(id) || [];
      logs.push(log);
      if (logs.length > MAX_LOGS) logs.shift();
      this.transactions.set(id, logs);
      this.transaction(log);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => finish(new Error('Mock server startup timed out.')),
          10000,
        );
        const failed = (code: string, error: Error | null) =>
          finish(new Error(`${code}${error ? `: ${error.message}` : ''}`));
        const started = () => finish();
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          server.off('error', failed);
          server.off('started', started);
          if (error) reject(error);
          else resolve();
        };
        server.once('started', started);
        server.once('error', failed);
        try {
          server.start();
        } catch (error) {
          finish(error as Error);
        }
      });
      this.statuses[id] = {running: true};
    } catch (error) {
      await this.stopInternal(id);
      this.statuses[id] = {running: false, error: (error as Error).message};
      this.changed(this.snapshot());
      throw error;
    }
  }

  stop(id: string): Promise<Workspace> {
    return this.serial(async () => {
      await this.stopInternal(id);
      const snapshot = this.snapshot();
      this.changed(snapshot);
      return snapshot;
    });
  }

  restart(id: string): Promise<Workspace> {
    return this.serial(async () => {
      await this.stopInternal(id);
      await this.startInternal(id);
      const snapshot = this.snapshot();
      this.changed(snapshot);
      return snapshot;
    });
  }

  private async stopInternal(id: string) {
    const server = this.servers.get(id);
    if (server) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        server.once('stopped', () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          server.stop();
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
      server.removeAllListeners();
      this.servers.delete(id);
    }
    this.statuses[id] = {running: false};
  }

  logs(id: string) {
    return clone(this.transactions.get(id) || []);
  }
  clearLogs(id: string) {
    this.transactions.delete(id);
  }

  import(
    text: string,
    format: 'auto' | 'mockoon' | 'openapi' = 'auto',
    sourcePath?: string,
  ): Promise<string[]> {
    return this.serial(async () => {
      if (text.length > 20 * 1024 * 1024)
        throw new Error('Import is limited to 20 MiB.');
      const document = text.replace(/^\uFEFF/, '');
      let detectedFormat: 'mockoon' | 'openapi' = 'openapi';
      if (format === 'auto') {
        let json;
        try {
          json = JSON.parse(document);
        } catch {
          // The OpenAPI converter also supports YAML and reports malformed files.
          detectedFormat = 'openapi';
        }
        if (json !== undefined) {
          if (Array.isArray(json) || Array.isArray(json?.routes)) {
            detectedFormat = 'mockoon';
          } else if (json?.openapi || json?.swagger) {
            detectedFormat = 'openapi';
          } else {
            throw new Error(
              'Expected a Mockoon environment or an OpenAPI document.',
            );
          }
        }
      } else {
        detectedFormat = format;
      }
      const parsed =
        detectedFormat === 'openapi'
          ? await new OpenApiConverter().convertFromOpenAPI(document, 3000, {
              disableExternalRefs: true,
            })
          : JSON.parse(document);
      const inputs = Array.isArray(parsed) ? parsed : [parsed];
      if (sourcePath && !path.isAbsolute(sourcePath))
        throw new Error('Source path must be absolute.');
      const records = inputs.map((input, index) => {
        const environment = normalizeEnvironment(input);
        if (
          this.records.some(
            (record) => record.environment.uuid === environment.uuid,
          )
        )
          environment.uuid = randomUUID();
        return {
          environment,
          directory: sourcePath ? path.dirname(sourcePath) : this.directory,
          options: {},
          disabledRoutes: [],
          ...(sourcePath
            ? {
                source: {
                  path: sourcePath,
                  index,
                  format: detectedFormat,
                  contentHash: contentHash(text),
                },
              }
            : {}),
        };
      });
      // Import validates all environments before changing the workspace, and never starts them.
      const ids = new Set(
        this.records.map((record) => record.environment.uuid),
      );
      records.forEach((record) => {
        while (ids.has(record.environment.uuid))
          record.environment.uuid = randomUUID();
        ids.add(record.environment.uuid);
      });
      this.records.push(...records);
      await this.persist();
      this.watchSources();
      this.changed(this.snapshot());
      return records.map((record) => record.environment.uuid);
    });
  }

  private watchSources() {
    const sources = new Set(
      this.records.flatMap((record) =>
        record.source ? [record.source.path] : [],
      ),
    );
    for (const [file, listener] of this.watched) {
      if (!sources.has(file)) {
        unwatchFile(file, listener);
        this.watched.delete(file);
      }
    }
    for (const file of sources) {
      if (this.watched.has(file)) continue;
      const listener = (current: Stats, previous: Stats) => {
        if (
          current.mtimeMs !== previous.mtimeMs ||
          current.size !== previous.size
        ) {
          this.serial(async () => {
            await this.refreshSource(file);
            await this.persist();
            this.changed(this.snapshot());
          }).catch(() => {});
        }
      };
      this.watched.set(file, listener);
      watchFile(file, {interval: 1000, persistent: false}, listener);
    }
  }

  private async refreshSource(file: string) {
    const records = this.records.filter(
      (record) => record.source?.path === file,
    );
    if (!records.length) return;
    try {
      const stat = await fs.stat(file);
      if (stat.size > 20 * 1024 * 1024)
        throw new Error('Source file exceeds 20 MiB.');
      const text = await fs.readFile(file, 'utf8');
      const hash = contentHash(text);
      const changedRecords = records.filter(
        (record) => record.source?.contentHash !== hash,
      );
      if (!changedRecords.length) {
        for (const record of records) {
          const status = this.statuses[record.environment.uuid];
          if (status?.error?.startsWith('Source file could not be reloaded:'))
            delete status.error;
        }
        return;
      }
      const parsed =
        records[0].source?.format === 'openapi'
          ? await new OpenApiConverter().convertFromOpenAPI(text, 3000, {
              disableExternalRefs: true,
            })
          : JSON.parse(text);
      const inputs = Array.isArray(parsed) ? parsed : [parsed];
      const updates = changedRecords.map((record) => {
        const environment = normalizeEnvironment(
          inputs[record.source?.index || 0],
        );
        environment.uuid = record.environment.uuid;
        return {record, environment};
      });
      for (const {record, environment} of updates) {
        if (record.source) record.source.contentHash = hash;
        if (JSON.stringify(environment) === JSON.stringify(record.environment))
          continue;
        record.environment = environment;
        this.statuses[environment.uuid] = {
          running: this.servers.has(environment.uuid),
          reloadRequired: this.servers.has(environment.uuid),
        };
      }
    } catch (error) {
      for (const record of records)
        this.statuses[record.environment.uuid] = {
          ...this.statuses[record.environment.uuid],
          running: this.servers.has(record.environment.uuid),
          error: `Source file could not be reloaded: ${(error as Error).message}. The last valid configuration is retained.`,
        };
    }
  }

  async export(id: string, format: 'mockoon' | 'openapi') {
    await this.load();
    const environment = this.publicRecord(this.record(id)).environment;
    return format === 'openapi'
      ? new OpenApiConverter().convertToOpenAPIV3(environment, 'json', true)
      : JSON.stringify(environment, null, 2);
  }

  async close() {
    await this.queue;
    this.closed = true;
    for (const [file, listener] of this.watched) unwatchFile(file, listener);
    this.watched.clear();
    await Promise.all(
      [...this.servers.keys()].map((id) => this.stopInternal(id)),
    );
  }
}
