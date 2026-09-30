/**
 * Copyright (c) Flipper Community contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */
import type {ServerAddOn} from 'flipper-plugin';
import path from 'path';
import {Events, Methods} from './contract';
import {MockApiRuntime} from './runtime';

const serverAddOn: ServerAddOn<Events, Methods> = async (
  connection,
  {flipperServer},
) => {
  const config = await flipperServer.exec('get-config');
  const runtime = new MockApiRuntime(
    process.env.FLIPPER_MOCK_API_DATA_DIR ||
      path.join(config.paths.homePath, '.flipper', 'mock-api'),
    (workspace) => connection.send('changed', workspace),
    (log) => connection.send('transaction', log),
  );
  connection.receive('load', () => runtime.load());
  connection.receive('create', () => runtime.create());
  connection.receive('save', (record) => runtime.save(record));
  connection.receive('remove', (id) => runtime.remove(id));
  connection.receive('start', (id) => runtime.start(id));
  connection.receive('stop', (id) => runtime.stop(id));
  connection.receive('restart', (id) => runtime.restart(id));
  connection.receive('logs', (id) => runtime.logs(id));
  connection.receive('clearLogs', (id) => runtime.clearLogs(id));
  connection.receive('import', ({text, format, sourcePath}) =>
    runtime.import(text, format, sourcePath),
  );
  connection.receive('export', ({id, format}) => runtime.export(id, format));
  return () => runtime.close();
};
export default serverAddOn;
