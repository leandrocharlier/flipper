/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {sleep, TestUtils} from 'flipper-plugin';
import {act, fireEvent, waitFor} from '@testing-library/react';
import * as LogsPlugin from '../index';
import {defaultFilters, formatLogEntry, matchesLog} from '../logText';
import {PAGE_SIZE} from '../LogConsole';

const entry = {
  date: new Date(1611854112859),
  message: 'Request failed\n\tat com.example.Client.send(Client.kt:42)',
  pid: 123,
  tag: 'NetworkClient',
  tid: 456,
  type: 'error',
  app: 'com.example',
} as const;

test('preserves repeated events, timestamps, processes and threads', () => {
  const plugin = TestUtils.startDevicePlugin(LogsPlugin);
  const events = [
    entry,
    {...entry, date: new Date(1611854113860)},
    {...entry, pid: 789, tid: 790},
  ];
  events.forEach(plugin.sendLogEntry);
  expect(plugin.instance.rows.records()).toEqual(
    events.map((event) => ({...event, pidStr: String(event.pid), count: 1})),
  );
  plugin.destroy();
});

test('formats complete multiline text and legacy repeat counts', () => {
  const message = `${'x'.repeat(5000)}\n\tCaused by: failure\n`;
  const text = formatLogEntry({...entry, message});
  expect(text).toContain('123-456');
  expect(text).toContain('NetworkClient');
  expect(text).toContain(`E ${message}`);
  expect(text).toContain('com.example');
  expect(text.endsWith(message)).toBe(true);
  expect(formatLogEntry({...entry, count: 3})).toContain('[repeated 3 times]');
});

test('combines severity, exact PID, tag and full-text filters', () => {
  expect(
    matchesLog(entry, {
      ...defaultFilters,
      level: 'warn',
      pid: '123',
      tag: 'network',
      search: 'CLIENT.KT:42',
    }),
  ).toBe(true);
  expect(matchesLog(entry, {...defaultFilters, pid: '12'})).toBe(false);
  expect(matchesLog(entry, {...defaultFilters, tag: 'Other'})).toBe(false);
  expect(matchesLog(entry, {...defaultFilters, level: 'fatal'})).toBe(false);
  expect(matchesLog({...entry, type: 'verbose'}, defaultFilters)).toBe(false);
  expect(
    matchesLog({...entry, type: 'unknown'}, {...defaultFilters, level: 'all'}),
  ).toBe(true);
  expect(matchesLog(entry, {...defaultFilters, search: '456'})).toBe(true);
});

test('pauses and resumes capture, clears history and detaches on destroy', async () => {
  const plugin = TestUtils.startDevicePlugin(LogsPlugin);
  plugin.sendLogEntry(entry);
  plugin.instance.resumePause();
  plugin.sendLogEntry(entry);
  expect(plugin.instance.rows.size).toBe(1);
  plugin.instance.resumePause();
  plugin.sendLogEntry(entry);
  expect(plugin.instance.rows.size).toBe(2);
  await plugin.instance.clearLogs();
  expect(plugin.instance.rows.size).toBe(0);
  plugin.destroy();
  plugin.sendLogEntry(entry);
  expect(plugin.instance.rows.size).toBe(0);
});

test('deep links filter the text and paste exports all matching events', async () => {
  const plugin = TestUtils.startDevicePlugin(LogsPlugin);
  plugin.sendLogEntry(entry);
  plugin.sendLogEntry({...entry, message: 'Unrelated'});
  await plugin.triggerDeepLink('Client.kt:42');
  expect(plugin.instance.rows.view.size).toBe(1);
  plugin.triggerMenuEntry('createPaste');
  expect(plugin.flipperLib.createPaste).toHaveBeenCalledWith(
    formatLogEntry(entry),
  );
  plugin.destroy();
});

test('export/import retains logs and accepts snapshots from the table viewer', async () => {
  const old = {...entry, count: 3, pidStr: '123'};
  const plugin = TestUtils.startDevicePlugin(LogsPlugin, {
    initialState: {logs: [old]},
  });
  plugin.sendLogEntry(entry);
  const data = await plugin.exportStateAsync();
  expect(data.logs).toEqual([old, {...entry, count: 1, pidStr: '123'}]);
  const imported = TestUtils.startDevicePlugin(LogsPlugin, {
    initialState: data,
  });
  expect(await imported.exportStateAsync()).toEqual(data);
  plugin.destroy();
  imported.destroy();
});

test('clearing a search keeps the selected occurrence visible in its original context', async () => {
  const logs = Array.from({length: PAGE_SIZE * 2 + 50}, (_, index) => ({
    ...entry,
    message:
      index === 120 || index === 3500 ? 'Repeated event' : `event-${index}`,
    count: 1,
    pidStr: '123',
  }));
  const plugin = TestUtils.renderDevicePlugin(LogsPlugin, {
    initialState: {logs},
  });
  const input = plugin.renderer.getByLabelText('Filter logs');
  fireEvent.change(input, {target: {value: 'message:"Repeated event"'}});
  const text = plugin.renderer.getByLabelText('Logcat text');
  expect(text.children).toHaveLength(2);
  const selectedRow = text.children[0];
  const range = document.createRange();
  range.selectNodeContents(selectedRow.lastChild!);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.mouseUp(text);
  fireEvent.change(input, {target: {value: ''}});
  expect(text.textContent).toContain('event-119\n');
  expect(text.textContent).toContain('Repeated event\n');
  expect(text.textContent).toContain('event-121\n');
  expect(
    plugin.renderer
      .getByRole('button', {name: 'Go to bottom'})
      .getAttribute('aria-pressed'),
  ).toBe('false');
  fireEvent.click(plugin.renderer.getByRole('button', {name: 'Go to bottom'}));
  expect(text.textContent).toContain(`event-${logs.length - 1}\n`);
  expect(text.textContent).not.toContain('event-119\n');
  plugin.destroy();
});

test('editing filters preserves the reading position without selection, including excluded and empty results', () => {
  window.getSelection()!.removeAllRanges();
  const logs = Array.from({length: PAGE_SIZE * 2 + 50}, (_, index) => ({
    ...entry,
    tag: index % 2 ? 'Odd' : 'Even',
    message: `event-${index}`,
    count: 1,
    pidStr: '123',
  }));
  const plugin = TestUtils.renderDevicePlugin(LogsPlugin, {
    initialState: {logs},
  });
  fireEvent.click(plugin.renderer.getByRole('button', {name: 'Older logs'}));
  const text = plugin.renderer.getByLabelText('Logcat text');
  // jsdom has no layout: place event 130 at the viewport's top edge.
  Array.from(text.children).forEach((node, index) => {
    jest.spyOn(node, 'getBoundingClientRect').mockReturnValue({
      top: (index - 80) * 22,
      bottom: (index - 79) * 22,
    } as DOMRect);
  });
  const input = plugin.renderer.getByLabelText('Filter logs');
  fireEvent.change(input, {target: {value: 'tag:Odd'}});
  expect(text.textContent).toContain('event-131\n');
  expect(text.textContent).not.toContain('event-4049\n');
  fireEvent.change(input, {target: {value: 'message:no-matches'}});
  expect(text.children).toHaveLength(0);
  fireEvent.change(input, {target: {value: ''}});
  expect(text.textContent).toContain('event-129\n');
  expect(text.textContent).toContain('event-130\n');
  expect(text.textContent).toContain('event-131\n');
  expect(text.textContent).not.toContain('event-4049\n');
  expect(
    plugin.renderer.getByLabelText('Go to bottom').getAttribute('aria-pressed'),
  ).toBe('false');
  plugin.destroy();
});

test('native selection spans events and survives incoming logs until follow resumes', async () => {
  const plugin = TestUtils.renderDevicePlugin(LogsPlugin);
  plugin.sendLogEntry(entry);
  plugin.sendLogEntry({...entry, message: 'Second event'});
  const pre = plugin.renderer.getByLabelText('Logcat text');
  await waitFor(() => expect(pre.children).toHaveLength(2));
  fireEvent.mouseDown(pre);
  const firstText = pre.children[0].lastChild!.firstChild!;
  const secondText = pre.children[1].lastChild!.firstChild!;
  const range = document.createRange();
  range.setStart(firstText, firstText.textContent!.indexOf('Request'));
  range.setEnd(secondText, secondText.textContent!.indexOf('Second') + 6);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const selected = window.getSelection()!.toString();
  expect(selected).toContain('Client.kt:42');
  expect(selected.endsWith('Second')).toBe(true);
  plugin.sendLogEntry({...entry, message: 'Incoming event'});
  await act(async () => {
    await sleep(150);
  });
  expect(pre.children).toHaveLength(2);
  expect(window.getSelection()!.toString()).toBe(selected);
  plugin.triggerMenuEntry('createPaste');
  expect(plugin.flipperLib.createPaste).toHaveBeenCalledWith(selected);
  fireEvent.click(plugin.renderer.getByRole('button', {name: 'Go to bottom'}));
  await waitFor(() => expect(pre.textContent).toContain('Incoming event'));
  fireEvent.keyDown(pre, {key: 'a', ctrlKey: true});
  expect(window.getSelection()!.toString()).toBe(pre.textContent);
  await act(async () => {
    await plugin.instance.clearLogs();
    plugin.sendLogEntry({...entry, message: 'After clear'});
    await sleep(150);
  });
  expect(pre.children).toHaveLength(1);
  expect(pre.textContent).toContain('After clear');
  plugin.destroy();
});

test('bounds the displayed DOM and lets users browse the entire filtered history', () => {
  const logs = Array.from({length: PAGE_SIZE + 10}, (_, index) => ({
    ...entry,
    message: `event-${index}`,
    count: 1,
    pidStr: '123',
  }));
  const plugin = TestUtils.renderDevicePlugin(LogsPlugin, {
    initialState: {logs},
  });
  const pre = plugin.renderer.getByLabelText('Logcat text');
  expect(pre.children).toHaveLength(PAGE_SIZE);
  expect(pre.children[0].textContent).toContain('event-10\n');
  fireEvent.click(plugin.renderer.getByRole('button', {name: 'Older logs'}));
  expect(pre.children[0].textContent).toContain('event-0\n');
  fireEvent.click(plugin.renderer.getByRole('button', {name: 'Newer logs'}));
  expect(pre.children[0].textContent).toContain(`event-${PAGE_SIZE}\n`);
  act(() => plugin.triggerMenuEntry('goToBottom'));
  expect(pre.children[0].textContent).toContain('event-10\n');
  fireEvent.change(plugin.renderer.getByLabelText('Filter logs'), {
    target: {value: 'event-2009'},
  });
  expect(pre.children).toHaveLength(1);
  expect(pre.style.whiteSpace).toBe('pre');
  fireEvent.click(plugin.renderer.getByLabelText('Soft wrap'));
  expect(pre.style.whiteSpace).toBe('pre-wrap');
  plugin.destroy();
});
