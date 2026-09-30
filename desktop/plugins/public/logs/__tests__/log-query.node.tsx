/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {act, fireEvent, waitFor} from '@testing-library/react';
import {createState, Device, TestUtils} from 'flipper-plugin';
import * as LogsPlugin from '../index';
import {compileLogQuery, querySuggestions, quoteQueryValue} from '../logQuery';
import {levels} from '../logText';
import type {DeviceLogEntry} from 'flipper-plugin';

const entry = {
  date: new Date(),
  type: 'warn',
  tag: 'Network Client',
  processName: 'com.example.app:worker',
  pid: 42,
  tid: 43,
  message: 'Request timed out',
} as const;

test('combines fields, quoted phrases, exclusions and minimum severity', () => {
  expect(
    compileLogQuery(
      'package:mine tag:"Network Client" level:INFO message:"timed out" -message:success pid:42 tid:43',
      'com.example.app',
    )(entry),
  ).toBe(true);
  expect(compileLogQuery('package:mine', 'com.example.other')(entry)).toBe(
    false,
  );
  expect(compileLogQuery('package:mine', '')(entry)).toBe(false);
  expect(compileLogQuery('level:ERROR', '')(entry)).toBe(false);
  expect(compileLogQuery('process:worker Request', '')(entry)).toBe(true);
  expect(compileLogQuery('package:com.example', '')(entry)).toBe(false);
});

test('repeated positive keys are alternatives while exclusions still apply', () => {
  expect(
    compileLogQuery('tag:Other tag:Network -message:success', '')(entry),
  ).toBe(true);
  expect(compileLogQuery('tag:Other tag:Network -tag:Client', '')(entry)).toBe(
    false,
  );
  expect(compileLogQuery('', '')(entry)).toBe(true);
  expect(compileLogQuery('level:WARNING', '')(entry)).toBe(true);
  expect(compileLogQuery('level:ASSERT', '')({...entry, type: 'fatal'})).toBe(
    true,
  );
});

test.each(levels)(
  'level:%s includes that severity and higher, with the inverse for exclusions',
  (level) => {
    const entries = levels.map((type) => ({
      ...entry,
      type: type as DeviceLogEntry['type'],
    }));
    expect(
      entries
        .filter(compileLogQuery(`level:${level}`, ''))
        .map((log) => log.type),
    ).toEqual(levels.slice(levels.indexOf(level)));
    expect(
      entries
        .filter(compileLogQuery(`-level:${level}`, ''))
        .map((log) => log.type),
    ).toEqual(levels.slice(0, levels.indexOf(level)));
  },
);

test('only DEBUG and ALL match the expected severity sets', () => {
  const entries = levels.map((type) => ({
    ...entry,
    type: type as DeviceLogEntry['type'],
  }));
  expect(
    entries
      .filter(compileLogQuery('level:DEBUG -level:INFO', ''))
      .map((log) => log.type),
  ).toEqual(['debug']);
  expect(entries.filter(compileLogQuery('level:ALL', ''))).toEqual(entries);
  expect(entries.filter(compileLogQuery('-level:ALL', ''))).toEqual([]);
});

test.each([
  ['package:com.example.app', 'package:com.example.app.debug'],
  ['tag:network', 'tag:Other'],
  ['process:worker', 'process:main'],
  ['pid:42', 'pid:420'],
  ['tid:43', 'tid:430'],
  ['message:"TIMED OUT"', 'message:success'],
])(
  'field and exclusion %s match only the intended entries',
  (matching, other) => {
    expect(compileLogQuery(matching, '')(entry)).toBe(true);
    expect(compileLogQuery(other, '')(entry)).toBe(false);
    expect(compileLogQuery(`-${matching}`, '')(entry)).toBe(false);
    expect(compileLogQuery(`-${other}`, '')(entry)).toBe(true);
    expect(compileLogQuery(`${matching} ${other}`, '')(entry)).toBe(true);
  },
);

test('reports incomplete, invalid and unsupported syntax without silently accepting it', () => {
  for (const query of [
    'tag:',
    'message:"missing quote',
    'level:bad',
    'pid:x',
    'wrong:value',
    'tag:a | tag:b',
    'tag: level:WARN',
    'message: -tag:Network',
    'tag~:Network.*',
  ]) {
    expect(() => compileLogQuery(query, '')).toThrow();
  }
  expect(
    compileLogQuery(
      'message:"a \\"quote\\""',
      '',
    )({...entry, message: 'a "quote"'}),
  ).toBe(true);
});

test('literal operators, colons, quotes and backslashes remain searchable', () => {
  for (const message of [
    '|',
    'tag~:Network',
    "'quoted",
    'a "quote"',
    'C:\\temp\\file',
    'first\nsecond',
    'level:WARN',
  ]) {
    expect(
      compileLogQuery(
        `message:${quoteQueryValue(message)}`,
        '',
      )({...entry, message}),
    ).toBe(true);
  }
  expect(
    compileLogQuery(
      'message:http://localhost',
      '',
    )({...entry, message: 'http://localhost'}),
  ).toBe(true);
  expect(compileLogQuery('"|"', '')({...entry, message: '|'})).toBe(true);
});

test('suggests keys and real values, replacing only the token at the caret', () => {
  expect(
    querySuggestions('pac', 3, [], 'com.example.app').map((item) => item.text),
  ).toContain('package:mine');
  const query = 'level:WARN tag:Net pid:42';
  const suggestions = querySuggestions(
    query,
    query.indexOf(' pid'),
    [entry],
    'com.example.app',
  );
  expect(suggestions[0].value).toBe('level:WARN tag:"Network Client" pid:42');
  expect(
    querySuggestions('-tag:Net', 8, [entry], '').map((item) => item.text),
  ).toEqual(['-tag:"Network Client"']);
  expect(
    querySuggestions('level:E', 7, [], '').map((item) => item.text),
  ).toContain('level:error');
});

test('completion preserves quoted tokens, whitespace and filters after the caret', () => {
  for (const query of [
    'level:WARN tag:"Network Cl" pid:42',
    'level:WARN\ttag: "Network Cl"\tpid:42',
  ]) {
    const caret = query.indexOf(' Cl') + 3;
    const suggestions = querySuggestions(query, caret, [entry], '');
    expect(suggestions[0].value).toContain('tag:"Network Client"');
    expect(suggestions[0].value).toMatch(/\s+pid:42$/);
    expect(compileLogQuery(suggestions[0].value, '')(entry)).toBe(true);
  }
  expect(querySuggestions('tag:"Network Cl', 15, [entry], '')[0].value).toBe(
    'tag:"Network Client"',
  );
  expect(querySuggestions('LEVEL:D', 7, [], '')[0].text).toBe('level:debug');
  expect(querySuggestions('-level:D', 8, [], '')[0].description).toContain(
    'Exclude',
  );
});

test('one query field offers suggestions and holds the last valid filter on errors', async () => {
  const plugin = TestUtils.renderDevicePlugin(LogsPlugin, {
    initialState: {logs: [{...entry, count: 1, pidStr: '42'}]},
  });
  const input = plugin.renderer.getByLabelText('Filter logs');
  expect(plugin.renderer.queryByLabelText('Filter PID')).toBeNull();
  fireEvent.change(input, {target: {value: 'tag:Network level:WARN'}});
  expect(plugin.instance.rows.view.size).toBe(1);
  fireEvent.change(input, {target: {value: 'level:WRONG'}});
  expect(plugin.instance.rows.view.size).toBe(1);
  expect(
    plugin.renderer.getByText(/Showing the last valid filter/),
  ).toBeTruthy();
  fireEvent.change(input, {target: {value: 'tag:'}});
  fireEvent.keyDown(input, {key: ' ', code: 'Space', ctrlKey: true});
  await waitFor(() =>
    expect(
      plugin.renderer.getByText('tag:"Network Client"', {selector: 'code'}),
    ).toBeTruthy(),
  );
  fireEvent.click(
    plugin.renderer.getByText('tag:"Network Client"', {selector: 'code'}),
  );
  expect(plugin.instance.filters.get().query).toBe('tag:"Network Client"');
  expect(plugin.instance.queryError.get()).toBe('');
  plugin.destroy();
});

test('package:mine follows app changes and a manual query is not overwritten', () => {
  const selectedAppId = createState<string | null>('com.example.app');
  const plugin = TestUtils.startDevicePlugin(LogsPlugin, {
    testDevice: {selectedAppId} as unknown as Device,
  });
  plugin.sendLogEntry({...entry, app: 'com.example.app'});
  plugin.instance.filters.set({
    ...plugin.instance.filters.get(),
    query: 'package:mine level:WARN',
  });
  expect(plugin.instance.rows.view.size).toBe(1);
  selectedAppId.set('com.other.app');
  expect(plugin.instance.rows.view.size).toBe(0);
  plugin.instance.filters.set({
    ...plugin.instance.filters.get(),
    query: 'package:com.example.app',
  });
  selectedAppId.set('com.third.app');
  expect(plugin.instance.rows.view.size).toBe(1);
  expect(plugin.instance.filters.get().query).toBe('package:com.example.app');
  plugin.destroy();
});

test('reload resumes a paused capture without clearing history or changing its query', async () => {
  const plugin = TestUtils.renderDevicePlugin(LogsPlugin);
  plugin.sendLogEntry(entry);
  fireEvent.change(plugin.renderer.getByLabelText('Filter logs'), {
    target: {value: 'tag:Network'},
  });
  fireEvent.click(plugin.renderer.getByRole('button', {name: 'Pause capture'}));
  await act(async () => {
    fireEvent.click(plugin.renderer.getByRole('button', {name: 'Reload logs'}));
  });
  await waitFor(() => expect(plugin.instance.isPaused.get()).toBe(false));
  plugin.sendLogEntry(entry);
  expect(plugin.instance.rows.size).toBe(2);
  expect(plugin.instance.filters.get().query).toBe('tag:Network');
  plugin.destroy();
});
