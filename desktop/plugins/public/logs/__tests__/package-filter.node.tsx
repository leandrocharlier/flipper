/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {
  createState,
  Device,
  DevicePluginClient,
  TestUtils,
} from 'flipper-plugin';
import * as LogsPlugin from '../index';
import {parseProcesses} from '../packageFilter';
import {defaultFilters, matchesLog} from '../logText';

const entry = {
  date: new Date(),
  message: 'A message without a package name',
  tag: 'Test',
  type: 'info',
  pid: 10,
  tid: 11,
} as const;
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
function start(packageName: string | null = 'com.example.app') {
  const selectedAppId = createState(packageName);
  const executeShell = jest
    .fn()
    .mockResolvedValue(
      'PID NAME\n10 com.example.app\n20 com.example.app:worker\n30 com.example.app.debug\n40 com.other.app',
    );
  const plugin = TestUtils.startDevicePlugin(
    {
      ...LogsPlugin,
      devicePlugin(client: DevicePluginClient) {
        client.device.executeShell = executeShell;
        return LogsPlugin.devicePlugin(client);
      },
    },
    {
      testDevice: {executeShell, selectedAppId} as unknown as Device,
    },
  );
  cleanups.push(plugin.destroy);
  return {...plugin, selectedAppId, executeShell};
}

test('reads modern and legacy Android process tables', () => {
  expect(parseProcesses('PID NAME\r\n123 com.example.app:worker')).toEqual(
    new Map([[123, 'com.example.app:worker']]),
  );
  expect(
    parseProcesses(
      'USER PID PPID VSZ RSS WCHAN ADDR S NAME\nu0_a2 42 1 0 0 0 0 S com.example.app',
    ),
  ).toEqual(new Map([[42, 'com.example.app']]));
  expect(() => parseProcesses('ps: bad option')).toThrow(
    'Invalid process list',
  );
});

test('uses the selected app ID and includes subprocesses, without prefix collisions or message matching', async () => {
  const plugin = start();
  await plugin.instance.packageFilter.refresh();
  [10, 20, 30, 40].forEach((pid) =>
    plugin.sendLogEntry({
      ...entry,
      pid,
      message: 'com.example.app appears in all messages',
    }),
  );
  expect(plugin.instance.filters.get().packageName).toBe('com.example.app');
  expect(plugin.instance.rows.view.output().map((row) => row.pid)).toEqual([
    10, 20,
  ]);
  expect(plugin.instance.packageFilter.status.get().pids).toEqual([10, 20]);
  expect(
    matchesLog(
      {...entry, processName: 'com.example.app.debug'},
      {...defaultFilters, packageName: 'com.example.app'},
    ),
  ).toBe(false);
});

test('follows app switches while preserving manual package choices', async () => {
  const plugin = start();
  await plugin.instance.packageFilter.refresh();
  plugin.selectedAppId.set('com.other.app');
  expect(plugin.instance.filters.get().packageName).toBe('com.other.app');
  plugin.instance.packageFilter.setPackageName('com.manual.app');
  plugin.selectedAppId.set('com.third.app');
  expect(plugin.instance.filters.get().packageName).toBe('com.manual.app');
  plugin.instance.packageFilter.followSelectedApp.set(true);
  expect(plugin.instance.filters.get().packageName).toBe('com.third.app');
  plugin.selectedAppId.set(null);
  expect(plugin.instance.filters.get().packageName).toBe('com.third.app');
  plugin.instance.packageFilter.setPackageName('');
  expect(plugin.instance.filters.get().packageName).toBe('');
  expect(plugin.instance.packageFilter.followSelectedApp.get()).toBe(false);
});

test('discovers new PIDs after restart and retains historical process identity when a PID is reused', async () => {
  const plugin = start();
  await plugin.instance.packageFilter.refresh();
  plugin.sendLogEntry(entry);
  plugin.executeShell.mockResolvedValue(
    'PID NAME\n10 com.other.app\n50 com.example.app\n60 com.example.app:worker',
  );
  plugin.sendLogEntry({...entry, pid: 50}); // Arrives before process lookup.
  await plugin.instance.packageFilter.refresh();
  plugin.sendLogEntry({...entry, message: 'Another app now owns PID 10'});
  plugin.sendLogEntry({...entry, pid: 60});
  expect(plugin.instance.packageFilter.status.get().pids).toEqual([50, 60]);
  expect(plugin.instance.rows.view.output().map((row) => row.pid)).toEqual([
    10, 50, 60,
  ]);
  plugin.instance.packageFilter.setPackageName('com.other.app');
  expect(plugin.instance.rows.view.output().map((row) => row.message)).toEqual([
    'Another app now owns PID 10',
  ]);
});

test('falls back to legacy ps and retries after failure without broadening the filter', async () => {
  const plugin = start();
  await plugin.instance.packageFilter.refresh();
  plugin.executeShell
    .mockReset()
    .mockRejectedValueOnce(new Error('unsupported'))
    .mockResolvedValueOnce('USER PID NAME\nu0_a1 10 com.example.app');
  await plugin.instance.packageFilter.refresh();
  expect(plugin.executeShell.mock.calls.map((call) => call[0])).toEqual([
    'ps -A -o PID,NAME',
    'ps',
  ]);
  plugin.executeShell.mockRejectedValue(new Error('Device unavailable'));
  await plugin.instance.packageFilter.refresh();
  expect(plugin.instance.packageFilter.status.get().error).toBe(true);
  plugin.sendLogEntry(entry);
  expect(plugin.instance.rows.view.size).toBe(0);
  plugin.executeShell.mockResolvedValue('PID NAME\n10 com.example.app');
  await plugin.instance.packageFilter.refresh();
  expect(plugin.instance.packageFilter.status.get().error).toBe(false);
  expect(plugin.instance.rows.view.size).toBe(1);
});

test('never interpolates a package ID into a device shell command', async () => {
  const plugin = start(null);
  await plugin.instance.packageFilter.refresh();
  plugin.instance.packageFilter.setPackageName('com.test; echo injected');
  await plugin.instance.packageFilter.refresh();
  expect(
    plugin.executeShell.mock.calls.every(
      (call) => call[0] === 'ps -A -o PID,NAME',
    ),
  ).toBe(true);
});

test('exports device-supplied process identities and restores package filtering offline without guessing missing identities', async () => {
  const live = start(null);
  await live.instance.packageFilter.refresh();
  live.sendLogEntry(entry);
  live.sendLogEntry({...entry, pid: 20});
  live.sendLogEntry({
    ...entry,
    pid: 999,
    message: 'Start proc 999:com.example.app/u0a1 for activity',
  });
  const exported = JSON.parse(JSON.stringify(await live.exportStateAsync()));
  expect(
    exported.logs.map((row: {processName?: string}) => row.processName),
  ).toEqual(['com.example.app', 'com.example.app:worker', undefined]);
  const imported = TestUtils.startDevicePlugin(LogsPlugin, {
    initialState: exported,
    testDevice: {isArchived: true} as unknown as Device,
  });
  cleanups.push(imported.destroy);
  await imported.instance.packageFilter.refresh();
  imported.instance.filters.set({
    ...defaultFilters,
    query: 'package:com.example.app',
  });
  expect(imported.instance.rows.view.output().map((row) => row.pid)).toEqual([
    10, 20,
  ]);
  expect(imported.instance.rows.records()[2].processName).toBeUndefined();
  expect(await imported.exportStateAsync()).toEqual(exported);
});

test('ignores results that arrive after disposal', async () => {
  const plugin = start();
  await plugin.instance.packageFilter.refresh();
  let resolve!: (value: string) => void;
  plugin.executeShell.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const pending = plugin.instance.packageFilter.refresh();
  plugin.destroy();
  cleanups.pop();
  resolve('PID NAME\n999 com.example.app');
  await pending;
  expect(plugin.instance.packageFilter.status.get().pids).not.toContain(999);
});
