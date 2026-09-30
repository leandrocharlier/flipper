/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {
  Atom,
  createState,
  DataSource,
  DevicePluginClient,
} from 'flipper-plugin';
import type {ExtendedLogEntry} from './index';
import {LogFilters, matchesPackage} from './logText';

// Both toybox's explicit columns and older Android `ps` output are accepted.
export function parseProcesses(output: string): Map<number, string> {
  const lines = output.trim().split(/\r?\n/);
  const header = lines.shift()?.trim().split(/\s+/) ?? [];
  const pidColumn = header.indexOf('PID');
  const nameColumn = header.findIndex((name) =>
    ['NAME', 'CMD', 'CMDLINE', 'COMMAND'].includes(name),
  );
  if (pidColumn < 0 || nameColumn < 0) throw new Error('Invalid process list');
  const processes = new Map<number, string>();
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    const pid = Number(fields[pidColumn]);
    const name = fields[nameColumn];
    if (Number.isSafeInteger(pid) && pid > 0 && name) processes.set(pid, name);
  }
  return processes;
}

export function createPackageFilter(
  client: DevicePluginClient,
  rows: DataSource<ExtendedLogEntry>,
  filters: Atom<LogFilters>,
) {
  const supported = client.device.os === 'Android';
  const followSelectedApp = createState(true);
  const selectedAppId =
    client.device.selectedAppId ?? createState<string | null>(null);
  const status = createState<{pids: number[]; error: boolean}>({
    pids: [],
    error: false,
  });
  let processes = new Map<number, string>();
  let active = false;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let generation = 0;
  let pollRun = 0;

  function updateStatus(error = false) {
    const packageName = filters.get().packageName.trim();
    const pids = packageName
      ? Array.from(processes)
          .filter(([, name]) => matchesPackage(name, packageName))
          .map(([pid]) => pid)
          .sort((a, b) => a - b)
      : [];
    if (
      error !== status.get().error ||
      pids.join(',') !== status.get().pids.join(',')
    ) {
      status.set({pids, error});
    }
  }

  function followApp() {
    const packageName = selectedAppId.get();
    // Keep the last selected package during a disconnect/reconnect. Clearing the
    // input explicitly switches to manual mode and shows all packages.
    if (supported && followSelectedApp.get() && packageName) {
      filters.set({...filters.get(), packageName, pid: ''});
    }
  }
  const disposers = [
    selectedAppId.subscribe(followApp),
    followSelectedApp.subscribe(followApp),
    filters.subscribe(() => updateStatus(status.get().error)),
    client.device.connected.subscribe((connected) => {
      generation++;
      processes = new Map();
      updateStatus();
      if (connected && active) void poll();
    }),
  ];
  followApp();

  async function refresh() {
    if (pending) return pending;
    if (
      !supported ||
      destroyed ||
      !client.device.isConnected ||
      client.device.isArchived
    )
      return;
    const currentGeneration = generation;
    pending = (async () => {
      try {
        let next: Map<number, string>;
        try {
          next = parseProcesses(
            await client.device.executeShell('ps -A -o PID,NAME'),
          );
        } catch {
          next = parseProcesses(await client.device.executeShell('ps'));
        }
        if (destroyed || generation !== currentGeneration) return;
        processes = next;
        // Resolve events captured before their process first appeared in `ps`.
        // Once assigned, retain the original name, even if Android reuses a PID.
        rows.records().forEach((entry, index) => {
          const processName = processes.get(entry.pid);
          if (!entry.processName && processName)
            rows.update(index, {...entry, processName});
        });
        updateStatus();
      } catch {
        if (!destroyed && generation === currentGeneration) {
          processes = new Map();
          updateStatus(true);
        }
      }
    })();
    try {
      await pending;
    } finally {
      pending = undefined;
    }
  }
  async function poll() {
    const run = ++pollRun;
    if (timer) clearTimeout(timer);
    await refresh();
    if (active && !destroyed && run === pollRun) timer = setTimeout(poll, 1000);
  }
  client.onActivate(() => {
    active = true;
    if (supported) void poll();
  });
  client.onDeactivate(() => {
    active = false;
    pollRun++;
    generation++;
    processes = new Map();
    if (timer) clearTimeout(timer);
  });
  client.onDestroy(() => {
    destroyed = true;
    pollRun++;
    if (timer) clearTimeout(timer);
    disposers.forEach((dispose) => dispose());
  });
  return {
    supported,
    followSelectedApp,
    selectedAppId,
    status,
    refresh,
    processName: (pid: number) => processes.get(pid),
    setPackageName(packageName: string) {
      followSelectedApp.set(false);
      filters.set({...filters.get(), packageName, pid: ''});
    },
  };
}
