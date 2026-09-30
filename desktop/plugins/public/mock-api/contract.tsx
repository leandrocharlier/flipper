/**
 * Copyright (c) Flipper Community contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */
import type {
  Environment,
  Route,
  RouteResponse,
  ResponseRule,
  DataBucket,
  Callback,
  ServerOptions,
  Transaction,
} from '@mockoon/commons';

export type MockEnvironment = {
  environment: Environment;
  directory: string;
  options: Partial<ServerOptions>;
  disabledRoutes: string[];
  source?: {
    path: string;
    index: number;
    format: 'mockoon' | 'openapi';
    contentHash?: string;
  };
};
export type RuntimeStatus = {
  running: boolean;
  error?: string;
  reloadRequired?: boolean;
};
export type MockLog = {environmentId: string; transaction: Transaction};
export type Workspace = {
  records: MockEnvironment[];
  statuses: Record<string, RuntimeStatus>;
  storagePath: string;
  templates: {
    route: Route;
    response: RouteResponse;
    rule: ResponseRule;
    data: DataBucket;
    callback: Callback;
  };
};
export type Events = {
  changed: Workspace;
  transaction: MockLog;
};
export type Methods = {
  load: () => Promise<Workspace>;
  create: () => Promise<string>;
  save: (record: MockEnvironment) => Promise<Workspace>;
  remove: (id: string) => Promise<Workspace>;
  start: (id: string) => Promise<Workspace>;
  stop: (id: string) => Promise<Workspace>;
  restart: (id: string) => Promise<Workspace>;
  logs: (id: string) => Promise<MockLog[]>;
  clearLogs: (id: string) => Promise<void>;
  import: (input: {
    text: string;
    format?: 'auto' | 'mockoon' | 'openapi';
    sourcePath?: string;
  }) => Promise<string[]>;
  export: (input: {
    id: string;
    format: 'mockoon' | 'openapi';
  }) => Promise<string>;
};
