/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import type {DeviceLogEntry} from 'flipper-plugin';

export type LogFormat = {
  showTimestamp: boolean;
  timestampFormat: 'datetime' | 'time' | 'epoch';
  showPid: boolean;
  showTid: boolean;
  showTag: boolean;
  tagWidth: number;
  repeatTags: boolean;
  colorizeTags: boolean;
  showPackage: boolean;
  packageWidth: number;
  repeatPackages: boolean;
  showProcess: boolean;
  processWidth: number;
  repeatProcesses: boolean;
  showLevel: boolean;
  colorizeMessages: boolean;
};
export const defaultFormat: LogFormat = {
  showTimestamp: true,
  timestampFormat: 'datetime',
  showPid: true,
  showTid: true,
  showTag: true,
  tagWidth: 23,
  repeatTags: true,
  colorizeTags: true,
  showPackage: true,
  packageWidth: 35,
  repeatPackages: true,
  showProcess: false,
  processWidth: 35,
  repeatProcesses: true,
  showLevel: true,
  colorizeMessages: true,
};
export const compactFormat: LogFormat = {
  ...defaultFormat,
  timestampFormat: 'time',
  showPid: false,
  showPackage: false,
  tagWidth: 18,
};
export function normalizeFormat(value: Partial<LogFormat>): LogFormat {
  const result = {...defaultFormat, ...value};
  for (const key of ['tagWidth', 'packageWidth', 'processWidth'] as const) {
    result[key] = Number.isFinite(result[key])
      ? Math.max(1, Math.min(100, Math.round(result[key])))
      : defaultFormat[key];
  }
  return result;
}
export type FormattableLog = DeviceLogEntry & {
  count?: number;
  processName?: string;
  processNameInferred?: boolean;
};
export type LogPart = {
  kind:
    | 'timestamp'
    | 'pid'
    | 'tag'
    | 'package'
    | 'process'
    | 'level'
    | 'message';
  text: string;
};
const letters: {[key: string]: string} = {
  verbose: 'V',
  debug: 'D',
  info: 'I',
  warn: 'W',
  error: 'E',
  fatal: 'F',
};
export function packageOf(entry: FormattableLog) {
  return entry.processName?.split(':')[0] || entry.app || '';
}
export function formatLogParts(
  entry: FormattableLog,
  format = defaultFormat,
  previous?: FormattableLog,
): LogPart[] {
  const parts: LogPart[] = [];
  const add = (kind: LogPart['kind'], text: string) =>
    parts.push({kind, text: `${text}  `});
  if (format.showTimestamp) {
    const date = new Date(entry.date);
    const pad = (value: number, length = 2) =>
      String(value).padStart(length, '0');
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
    add(
      'timestamp',
      Number.isNaN(date.getTime())
        ? 'Invalid date'
        : format.timestampFormat === 'epoch'
          ? (date.getTime() / 1000).toFixed(3)
          : format.timestampFormat === 'time'
            ? time
            : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`,
    );
  }
  if (format.showPid)
    add(
      'pid',
      (format.showTid ? `${entry.pid}-${entry.tid}` : String(entry.pid)).padEnd(
        format.showTid ? 13 : 6,
      ),
    );
  if (format.showTag)
    add(
      'tag',
      (!format.repeatTags && previous?.tag === entry.tag
        ? ''
        : entry.tag
      ).padEnd(format.tagWidth),
    );
  const packageName = packageOf(entry);
  if (format.showPackage)
    add(
      'package',
      (!format.repeatPackages && previous && packageOf(previous) === packageName
        ? ''
        : packageName
      ).padEnd(format.packageWidth),
    );
  if (format.showProcess)
    add(
      'process',
      (!format.repeatProcesses &&
      previous &&
      previous.processName === entry.processName
        ? ''
        : entry.processName || ''
      ).padEnd(format.processWidth),
    );
  if (format.showLevel)
    parts.push({kind: 'level', text: letters[entry.type] ?? '?'});
  const count =
    (entry.count ?? 1) > 1 ? ` [repeated ${entry.count} times]` : '';
  // Reuse a message's existing line terminator as the event separator. Keep
  // internal newlines and any additional intentional blank lines unchanged.
  const message = entry.message.replace(/(?:\r\n|\r|\n)$/, '');
  parts.push({
    kind: 'message',
    text: `${format.showLevel ? ' ' : ''}${message}${count}\n`,
  });
  return parts;
}
export function formatLogEntry(
  entry: FormattableLog,
  format = defaultFormat,
  previous?: FormattableLog,
) {
  return formatLogParts(entry, format, previous)
    .map((part) => part.text)
    .join('');
}
