/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import type {ExtendedLogEntry} from './index';

// Only Android's explicit process lifecycle records establish an identity.
// Package mentions in arbitrary application messages are not evidence.
export function resolveImportedPackages(entries: readonly ExtendedLogEntry[]) {
  const result = [...entries];
  const processes = new Map<number, string>();
  const ordered = entries
    .map((entry, index) => ({
      entry,
      index,
      time: new Date(entry.date).getTime(),
    }))
    .filter(({time}) => Number.isFinite(time))
    .sort((a, b) => a.time - b.time || a.index - b.index);
  for (const {entry, index} of ordered) {
    if (entry.tag === 'ActivityManager') {
      const start = /^Start proc (\d+):([^/\s]+)\/\S+(?:\s|$)/.exec(
        entry.message,
      );
      const died = /^Process (\S+) \(pid (\d+)\) has died\b/.exec(
        entry.message,
      );
      const killed = /^Killing (\d+):([^/\s]+)\/\S+(?:\s|$)/.exec(
        entry.message,
      );
      if (start) {
        const pid = Number(start[1]);
        processes.delete(pid);
        if (
          Number.isSafeInteger(pid) &&
          pid > 0 &&
          /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+(?::[\w.:-]+)?$/.test(start[2])
        ) {
          processes.set(pid, start[2]);
        }
      } else {
        const ended = died
          ? {pid: Number(died[2]), name: died[1]}
          : killed
            ? {pid: Number(killed[1]), name: killed[2]}
            : undefined;
        if (ended && processes.get(ended.pid) === ended.name)
          processes.delete(ended.pid);
      }
    }
    const savedName = entry.processName || entry.app;
    const processName = processes.get(entry.pid);
    if (savedName) {
      // A stored identity takes precedence, including at an unrecorded restart.
      if (processName && savedName !== processName) processes.delete(entry.pid);
    } else if (processName) {
      result[index] = {...entry, processName, processNameInferred: true};
    }
  }
  return result;
}
