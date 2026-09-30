/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {
  DevicePluginClient,
  DeviceLogEntry,
  usePlugin,
  createDataSource,
  createState,
} from 'flipper-plugin';
import React from 'react';
import {LogConsole, ConsoleActions} from './LogConsole';
import {defaultFilters, formatLogEntry, matchesLog} from './logText';
import {createPackageFilter} from './packageFilter';
import {defaultFormat, normalizeFormat} from './logFormat';
import {compileLogQuery} from './logQuery';
import {resolveImportedPackages} from './importPackages';

export type ExtendedLogEntry = DeviceLogEntry & {
  count: number;
  pidStr: string;
  processName?: string;
  processNameInferred?: boolean;
};

export function devicePlugin(client: DevicePluginClient) {
  const rows = createDataSource<ExtendedLogEntry>([], {
    limit: 200000,
    persist: 'logs',
  });
  // Receive metadata updates for retained events as well as newly appended logs.
  // The console bounds its own rendered page separately.
  rows.view.setWindow(0, Infinity);
  const isPaused = createState(true);
  const filters = createState(defaultFilters);
  const format = createState(defaultFormat, {
    persist: 'logcat-format-v1',
    persistToLocalStorage: true,
  });
  format.set(normalizeFormat(format.get()));
  const packageFilter = createPackageFilter(client, rows, filters);
  const consoleRef: {current: ConsoleActions | null} = {current: null};
  const queryError = createState('');
  function applyFilters(value: typeof defaultFilters) {
    try {
      const predicate =
        value.query === undefined
          ? (entry: ExtendedLogEntry) => matchesLog(entry, value)
          : compileLogQuery(value.query, value.packageName);
      rows.view.setFilter(predicate);
      queryError.set('');
    } catch (error) {
      queryError.set((error as Error).message);
    }
  }
  applyFilters(filters.get());
  const unsubscribeFilters = filters.subscribe(applyFilters);
  client.onReady(() => {
    if (client.device.isArchived && client.device.os === 'Android') {
      const entries = rows.records();
      const resolved = resolveImportedPackages(entries);
      if (resolved.some((entry, index) => entry !== entries[index])) {
        rows.deserialize(resolved);
      }
    }
  });

  client.onDeepLink((payload: unknown) => {
    if (typeof payload === 'string') {
      filters.set({
        ...defaultFilters,
        packageName: filters.get().packageName,
        level: 'all',
        search: payload,
      });
    }
  });

  client.addMenuEntry(
    {action: 'clear', handler: clearLogs, accelerator: 'ctrl+l'},
    {action: 'createPaste', handler: createPaste},
    {action: 'goToBottom', handler: () => consoleRef.current?.goToBottom()},
  );

  let logDisposer: (() => void) | undefined;
  function resumePause() {
    if (isPaused.get() && client.device.isConnected) {
      isPaused.set(false);
      logDisposer = client.onDeviceLogEntry((entry) => {
        // Keep every event, including repeated messages and different processes.
        rows.append({
          ...entry,
          pidStr: String(entry.pid),
          count: 1,
          processName: packageFilter.processName(entry.pid),
        });
      });
    } else {
      logDisposer?.();
      logDisposer = undefined;
      isPaused.set(true);
    }
  }

  async function clearLogs() {
    if (client.device.connected.get()) {
      await client.device.clearLogs();
    }
    rows.clear();
  }
  async function reloadLogs() {
    if (!client.device.isConnected) return;
    if (!isPaused.get()) resumePause();
    resumePause();
    await packageFilter.refresh();
  }

  function createPaste() {
    const text =
      consoleRef.current?.getSelectedText() ||
      rows.view
        .output(0, rows.view.size)
        .map((entry, index, entries) =>
          formatLogEntry(entry, format.get(), entries[index - 1]),
        )
        .join('');
    if (text) {
      client.createPaste(text);
    }
  }

  client.onDestroy(() => {
    logDisposer?.();
    unsubscribeFilters();
  });
  resumePause();
  return {
    rows,
    filters,
    queryError,
    format,
    packageFilter,
    isPaused,
    consoleRef,
    connected: client.device.connected,
    clearLogs,
    reloadLogs,
    resumePause,
  };
}

export function Component() {
  const plugin = usePlugin(devicePlugin);
  return <LogConsole plugin={plugin} />;
}
