/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {fireEvent} from '@testing-library/react';
import {TestUtils} from 'flipper-plugin';
import * as LogsPlugin from '../index';
import {
  defaultFormat,
  formatLogEntry,
  formatLogParts,
  normalizeFormat,
} from '../logFormat';
const entry = {
  date: new Date(2026, 8, 30, 10, 30, 1, 123),
  type: 'info',
  pid: 10,
  tid: 11,
  tag: 'SampleTag',
  processName: 'com.example.app:worker',
  message: 'A multiline message\n    stack trace',
} as const;
beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

test('renders separate package/process names in Logcat order, with an intact message', () => {
  const parts = formatLogParts(entry, {...defaultFormat, showProcess: true});
  expect(parts.map((part) => part.kind)).toEqual([
    'timestamp',
    'pid',
    'tag',
    'package',
    'process',
    'level',
    'message',
  ]);
  expect(parts.find((part) => part.kind === 'package')?.text.trim()).toBe(
    'com.example.app',
  );
  expect(parts.find((part) => part.kind === 'process')?.text.trim()).toBe(
    'com.example.app:worker',
  );
  expect(parts[parts.length - 1].text).toBe(` ${entry.message}\n`);
});

test('does not duplicate line terminators or remove internal and intentional blank lines', () => {
  for (const ending of ['', '\n', '\r\n', '\r']) {
    const parts = formatLogParts({
      ...entry,
      message: `${entry.message}${ending}`,
    });
    expect(parts[parts.length - 1].text).toBe(` ${entry.message}\n`);
  }
  const parts = formatLogParts({...entry, message: `${entry.message}\n\n`});
  expect(parts[parts.length - 1].text).toBe(` ${entry.message}\n\n`);
  expect(formatLogEntry({...entry, message: 'Repeated\n', count: 3})).toContain(
    'Repeated [repeated 3 times]\n',
  );
});

test('supports hidden fields, timestamp styles, PID without TID and minimum widths', () => {
  const format = {
    ...defaultFormat,
    showPid: false,
    showTimestamp: false,
    showTag: false,
    showPackage: false,
    showLevel: false,
  };
  expect(formatLogEntry(entry, format)).toBe(`${entry.message}\n`);
  expect(
    formatLogParts(entry, {
      ...defaultFormat,
      timestampFormat: 'time',
    })[0].text.trim(),
  ).toBe('10:30:01.123');
  expect(
    formatLogParts(entry, {
      ...defaultFormat,
      timestampFormat: 'epoch',
    })[0].text.trim(),
  ).toBe((entry.date.getTime() / 1000).toFixed(3));
  expect(
    formatLogParts(entry, {...defaultFormat, showTid: false})[1].text.trim(),
  ).toBe('10');
  expect(formatLogEntry(entry, {...defaultFormat, tagWidth: 1})).toContain(
    entry.tag,
  );
  expect(
    normalizeFormat({...defaultFormat, tagWidth: -5, packageWidth: 500}),
  ).toMatchObject({tagWidth: 1, packageWidth: 100});
});

test('can suppress repeated metadata without hiding messages or first entries', () => {
  const format = {
    ...defaultFormat,
    repeatTags: false,
    repeatPackages: false,
    repeatProcesses: false,
    showProcess: true,
  };
  const parts = formatLogParts(entry, format, entry);
  for (const kind of ['tag', 'package', 'process'])
    expect(parts.find((part) => part.kind === kind)?.text.trim()).toBe('');
  expect(formatLogEntry(entry, format, entry)).toContain(entry.message);
  expect(formatLogEntry(entry, format)).toContain(entry.tag);
});

test('previews settings, applies them to text/copy, persists choices and cancels uncommitted edits', () => {
  const plugin = TestUtils.renderDevicePlugin(LogsPlugin, {
    initialState: {logs: [{...entry, pidStr: '10', count: 1}]},
  });
  fireEvent.click(plugin.renderer.getByRole('button', {name: 'Logcat Format'}));
  fireEvent.click(plugin.renderer.getByLabelText('Show timestamp'));
  expect(
    plugin.renderer.getByLabelText('Logcat format preview').textContent,
  ).not.toContain('2026-09-30');
  expect(plugin.instance.format.get().showTimestamp).toBe(true);
  fireEvent.click(plugin.renderer.getByText('Apply'));
  expect(
    plugin.renderer.getByLabelText('Logcat text').textContent,
  ).not.toContain('2026-09-30');
  plugin.triggerMenuEntry('createPaste');
  expect(plugin.flipperLib.createPaste).toHaveBeenCalledWith(
    formatLogEntry(entry, {...defaultFormat, showTimestamp: false}),
  );
  fireEvent.click(plugin.renderer.getByLabelText('Show tag'));
  fireEvent.click(plugin.renderer.getByText('Cancel'));
  expect(plugin.instance.format.get().showTag).toBe(true);
  plugin.destroy();
  const reopened = TestUtils.startDevicePlugin(LogsPlugin);
  expect(reopened.instance.format.get().showTimestamp).toBe(false);
  reopened.destroy();
});
