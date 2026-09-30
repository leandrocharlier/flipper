/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import React from 'react';
import {theme} from 'flipper-plugin';
import {FormattableLog, LogFormat, formatLogParts} from './logFormat';

const colors: {[key: string]: string} = {
  verbose: `var(--flipper-log-verbose, ${theme.textColorSecondary})`,
  debug: `var(--flipper-log-debug, ${theme.primaryColor})`,
  info: `var(--flipper-log-info, ${theme.successColor})`,
  warn: `var(--flipper-log-warn, ${theme.warningColor})`,
  error: `var(--flipper-log-error, ${theme.errorColor})`,
  fatal: `var(--flipper-log-error, ${theme.errorColor})`,
};
const tagColors = ['#6a9fea', '#b48ce0', '#47ad9e', '#dc9472', '#ce85b6'];
function tagColor(tag: string) {
  let hash = 0;
  for (const character of tag) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return tagColors[(hash >>> 0) % tagColors.length];
}
export const LogLine = React.memo(function LogLine({
  entry,
  format,
  previous,
}: {
  entry: FormattableLog;
  format: LogFormat;
  previous?: FormattableLog;
}) {
  const color = colors[entry.type] ?? theme.textColorSecondary;
  return (
    <span>
      {formatLogParts(entry, format, previous).map((part) => (
        <span
          key={part.kind}
          title={
            (part.kind === 'package' || part.kind === 'process') &&
            entry.processNameInferred
              ? 'Package inferred from Android process lifecycle records in this imported file'
              : undefined
          }
          style={
            part.kind === 'level'
              ? {
                  background: `var(--flipper-log-${entry.type}-badge, ${color})`,
                  padding: 'var(--flipper-log-level-padding, 0)',
                  color: `var(--flipper-log-${entry.type}-label, ${
                    entry.type === 'warn' || entry.type === 'info'
                      ? theme.backgroundDefault
                      : '#fff'
                  })`,
                }
              : part.kind === 'message'
                ? {
                    color: format.colorizeMessages
                      ? color
                      : theme.textColorPrimary,
                  }
                : part.kind === 'tag' && format.colorizeTags
                  ? {color: tagColor(entry.tag)}
                  : {
                      color: `var(--flipper-log-metadata, ${theme.textColorSecondary})`,
                    }
          }>
          {part.text}
        </span>
      ))}
    </span>
  );
});
