/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import type {DeviceLogEntry} from 'flipper-plugin';

export type LogFilters = {
  search: string;
  level: string;
  tag: string;
  pid: string;
  packageName: string;
  query?: string;
};
export const defaultFilters: LogFilters = {
  search: '',
  level: 'debug',
  tag: '',
  pid: '',
  packageName: '',
};
export const levels = ['verbose', 'debug', 'info', 'warn', 'error', 'fatal'];
export {formatLogEntry} from './logFormat';

export function matchesPackage(
  processName: string | undefined,
  packageName: string,
) {
  return (
    processName === packageName || !!processName?.startsWith(`${packageName}:`)
  );
}

export function matchesLog(
  entry: DeviceLogEntry & {processName?: string},
  filters: LogFilters,
) {
  if (
    filters.packageName.trim() &&
    !matchesPackage(entry.processName || entry.app, filters.packageName.trim())
  ) {
    return false;
  }
  if (
    filters.level !== 'all' &&
    levels.indexOf(entry.type) < levels.indexOf(filters.level)
  ) {
    return false;
  }
  if (filters.pid.trim() && String(entry.pid) !== filters.pid.trim()) {
    return false;
  }
  if (!entry.tag.toLowerCase().includes(filters.tag.trim().toLowerCase())) {
    return false;
  }
  const search = filters.search.trim().toLowerCase();
  return (
    !search ||
    [
      entry.message,
      entry.tag,
      entry.app ?? '',
      entry.processName ?? '',
      String(entry.pid),
      String(entry.tid),
    ].some((value) => value.toLowerCase().includes(search))
  );
}
