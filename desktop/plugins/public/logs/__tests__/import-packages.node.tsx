/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {TestUtils} from 'flipper-plugin';
import * as LogsPlugin from '../index';
import {ExtendedLogEntry} from '../index';
import {resolveImportedPackages} from '../importPackages';
import {defaultFilters} from '../logText';

const row = (
  second: number,
  extra: Partial<ExtendedLogEntry> = {},
): ExtendedLogEntry => ({
  date: new Date(2026, 8, 30, 12, 0, second),
  pid: 10,
  tid: 11,
  tag: 'Example',
  type: 'info',
  message: 'Example',
  count: 1,
  pidStr: '10',
  ...extra,
});
const start = (second: number, name: string) =>
  row(second, {
    pid: 100,
    tag: 'ActivityManager',
    message: `Start proc 10:${name}/u0a1 for activity`,
  });

test('reconstructs only explicit process lifetimes, retaining chronological PID reuse boundaries', () => {
  const entries = [
    row(0),
    start(1, 'com.one.app'),
    row(2),
    row(3, {
      pid: 100,
      tag: 'ActivityManager',
      message: 'Process com.one.app (pid 10) has died: prcp TOP',
    }),
    row(4),
    start(5, 'com.two.app:worker'),
    row(6),
    row(7, {
      pid: 100,
      tag: 'ActivityManager',
      message: 'Killing 10:com.two.app:worker/u0a1 (adj 0): stop',
    }),
    row(8),
  ];
  const result = resolveImportedPackages(entries);
  expect(result.map((e) => e.processName)).toEqual([
    undefined,
    undefined,
    'com.one.app',
    undefined,
    undefined,
    undefined,
    'com.two.app:worker',
    undefined,
    undefined,
  ]);
  expect(result[2].processNameInferred).toBe(true);
  expect(entries[2].processName).toBeUndefined();
  expect(
    resolveImportedPackages([...entries].reverse()).map((e) => e.processName),
  ).toEqual(result.map((e) => e.processName).reverse());
});

test('does not infer from arbitrary text, overwrite saved identities, or carry an identity past a conflict', () => {
  const entries = [
    row(0, {message: 'Start proc 10:com.fake.app/u0a1 for activity'}),
    row(1),
    start(2, 'com.one.app'),
    row(3, {processName: 'com.actual.app'}),
    row(4),
    start(5, 'com.one.app'),
    row(6, {date: new Date(NaN)}),
    start(7, 'system_process'),
    row(8),
  ];
  expect(resolveImportedPackages(entries).map((e) => e.processName)).toEqual([
    undefined,
    undefined,
    undefined,
    'com.actual.app',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

test('archived Android import restores package filtering and persists the inferred provenance', async () => {
  const plugin = TestUtils.startDevicePlugin(LogsPlugin, {
    initialState: {
      logs: [start(1, 'com.example.app'), row(2), row(3, {pid: 20})],
    },
    isArchived: true,
  });
  try {
    plugin.instance.filters.set({
      ...defaultFilters,
      query: 'package:com.example.app',
    });
    expect(plugin.instance.rows.view.output().map((e) => e.pid)).toEqual([10]);
    const exported = await plugin.exportStateAsync();
    expect(exported.logs[1]).toMatchObject({
      processName: 'com.example.app',
      processNameInferred: true,
    });
    expect(exported.logs[2].processName).toBeUndefined();
  } finally {
    plugin.destroy();
  }
});
