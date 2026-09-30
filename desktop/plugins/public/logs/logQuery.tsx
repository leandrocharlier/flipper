/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {LogFilters, levels, matchesPackage} from './logText';
import {FormattableLog, packageOf} from './logFormat';

export const quoteQueryValue = (value: string) =>
  /[\s:'"\\]/.test(value)
    ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : value;
export function filterQuery(filters: LogFilters, followSelectedApp: boolean) {
  if (filters.query !== undefined) return filters.query;
  return [
    filters.packageName &&
      `package:${followSelectedApp ? 'mine' : quoteQueryValue(filters.packageName)}`,
    filters.level !== 'all' && `level:${filters.level.toLowerCase()}`,
    filters.tag && `tag:${quoteQueryValue(filters.tag)}`,
    filters.pid && `pid:${filters.pid}`,
    filters.search && `message:${quoteQueryValue(filters.search)}`,
  ]
    .filter(Boolean)
    .join(' ');
}

type Term = {key: string; value: string; negative: boolean};
const keys = ['package', 'tag', 'level', 'message', 'process', 'pid', 'tid'];
export function compileLogQuery(query: string, selectedPackage: string) {
  const terms: Term[] = [];
  let cursor = 0;
  while (cursor < query.length) {
    while (/\s/.test(query[cursor] ?? '') && cursor < query.length) cursor++;
    if (cursor === query.length) break;
    const prefix = /^(-?)([a-zA-Z]+):/.exec(query.slice(cursor));
    const negative = prefix?.[1] === '-';
    const key = prefix?.[2].toLowerCase() ?? 'text';
    if (prefix) cursor += prefix[0].length;
    if (prefix && !keys.includes(key))
      throw new Error(
        `Unknown filter: ${key}. Use package, tag, level, message, process, pid or tid.`,
      );
    while (/\s/.test(query[cursor] ?? '') && cursor < query.length) cursor++;
    let value = '';
    const quote =
      query[cursor] === '"' || query[cursor] === "'"
        ? query[cursor++]
        : undefined;
    if (quote) {
      let closed = false;
      while (cursor < query.length) {
        const character = query[cursor++];
        if (character === quote) {
          closed = true;
          break;
        }
        if (
          character === '\\' &&
          cursor < query.length &&
          [quote, '\\'].includes(query[cursor])
        )
          value += query[cursor++];
        else value += character;
      }
      if (!closed) throw new Error('Close the quoted filter value.');
      if (cursor < query.length && !/\s/.test(query[cursor]))
        throw new Error('Separate filters with a space.');
    } else {
      while (cursor < query.length && !/\s/.test(query[cursor]))
        value += query[cursor++];
    }
    if (!value) throw new Error(`Choose a value for ${key}:`);
    const nextKey = /^-?([a-zA-Z]+):/.exec(value)?.[1].toLowerCase();
    if (prefix && !quote && nextKey && keys.includes(nextKey))
      throw new Error(
        `Choose a value for ${key}: (quote values containing a filter key).`,
      );
    if (
      !quote &&
      key === 'text' &&
      (['|', '&', '(', ')'].includes(value) || /^-?[a-zA-Z]+~:/.test(value))
    )
      throw new Error(
        'Use space-separated filters; operators and regular expressions are not supported.',
      );
    if (key === 'level') {
      value = value.toLowerCase();
      if (value === 'warning') value = 'warn';
      if (value === 'assert') value = 'fatal';
      if (![...levels, 'all'].includes(value))
        throw new Error(
          'Level must be verbose, debug, info, warn, error, fatal or all.',
        );
    }
    if (['pid', 'tid'].includes(key) && !/^\d+$/.test(value))
      throw new Error(`${key.toUpperCase()} must be a number.`);
    terms.push({key, value, negative});
  }
  function matchesTerm(entry: FormattableLog, term: Term) {
    const value = term.value.toLowerCase();
    switch (term.key) {
      case 'package':
        return term.value === 'mine'
          ? !!selectedPackage &&
              matchesPackage(entry.processName || entry.app, selectedPackage)
          : matchesPackage(entry.processName || entry.app, term.value);
      case 'tag':
        return entry.tag.toLowerCase().includes(value);
      case 'message':
        return entry.message.toLowerCase().includes(value);
      case 'process':
        return (entry.processName || entry.app || '')
          .toLowerCase()
          .includes(value);
      case 'pid':
        return String(entry.pid) === term.value;
      case 'tid':
        return String(entry.tid) === term.value;
      case 'level':
        return (
          value === 'all' || levels.indexOf(entry.type) >= levels.indexOf(value)
        );
      default:
        return [
          entry.message,
          entry.tag,
          entry.app ?? '',
          entry.processName ?? '',
          String(entry.pid),
          String(entry.tid),
        ].some((text) => text.toLowerCase().includes(value));
    }
  }
  // Repeated positive keys are alternatives. Different keys, exclusions and
  // unqualified words are combined, matching Logcat's common query form.
  const groups = new Map<string, Term[]>();
  terms.forEach((term, index) => {
    const group =
      term.negative || term.key === 'text' ? `term-${index}` : term.key;
    groups.set(group, [...(groups.get(group) ?? []), term]);
  });
  const grouped = Array.from(groups.values());
  return (entry: FormattableLog) =>
    grouped.every((group) =>
      group.some((term) =>
        term.negative ? !matchesTerm(entry, term) : matchesTerm(entry, term),
      ),
    );
}

export function querySuggestions(
  query: string,
  caret: number,
  entries: readonly FormattableLog[],
  selectedPackage: string,
) {
  // Keep quoted phrases intact when editing in the middle of a query. The
  // completion scanner also accepts an unfinished quote while the user types.
  caret = Math.max(0, Math.min(caret, query.length));
  let start = caret;
  let end = caret;
  let cursor = 0;
  while (cursor < query.length) {
    while (cursor < query.length && /\s/.test(query[cursor])) cursor++;
    const tokenStart = cursor;
    let quote = '';
    while (cursor < query.length) {
      const character = query[cursor];
      if (quote) {
        if (character === '\\' && [quote, '\\'].includes(query[cursor + 1])) {
          cursor += 2;
          continue;
        }
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (/\s/.test(character)) {
        // The parser allows whitespace between a field and its value.
        if (/^-?[a-zA-Z]+:\s*$/.test(query.slice(tokenStart, cursor))) {
          cursor++;
          continue;
        }
        break;
      }
      cursor++;
    }
    if (tokenStart <= caret && caret <= cursor) {
      start = tokenStart;
      end = cursor;
      break;
    }
  }
  const token = query.slice(start, caret);
  const negative = token.startsWith('-') ? '-' : '';
  const plain = token.slice(negative.length);
  const colon = plain.indexOf(':');
  let candidates: {text: string; description: string}[];
  if (colon >= 0) {
    const key = plain.slice(0, colon).toLowerCase();
    const typed = plain
      .slice(colon + 1)
      .trimStart()
      .replace(/^['"]|['"]$/g, '')
      .replace(/\\([\\'"])/g, '$1')
      .toLowerCase();
    const values =
      key === 'package'
        ? ['mine', selectedPackage, ...entries.map(packageOf)]
        : key === 'tag'
          ? entries.map((entry) => entry.tag)
          : key === 'process'
            ? entries.map((entry) => entry.processName || entry.app || '')
            : key === 'pid'
              ? entries.map((entry) => String(entry.pid))
              : key === 'tid'
                ? entries.map((entry) => String(entry.tid))
                : key === 'level'
                  ? [
                      'verbose',
                      'debug',
                      'info',
                      'warn',
                      'error',
                      'fatal',
                      'all',
                    ]
                  : [];
    candidates = Array.from(new Set(values.filter(Boolean)))
      .filter((value) => value.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((value) => ({
        text: `${negative}${key}:${quoteQueryValue(value)}`,
        description:
          value === 'mine' && key === 'package'
            ? `Selected app${selectedPackage ? `: ${selectedPackage}` : ''}`
            : key === 'level'
              ? value === 'all'
                ? negative
                  ? 'Exclude all levels'
                  : 'All levels'
                : negative
                  ? 'Exclude this level and higher'
                  : 'This level and higher'
              : key,
      }));
  } else {
    candidates = [
      {text: 'package:mine', description: 'Follow the selected app'},
      {text: 'package:', description: 'Package ID'},
      {text: 'tag:', description: 'Log tag'},
      {text: 'level:', description: 'Minimum severity'},
      {text: 'message:', description: 'Message text; use quotes for phrases'},
      {text: 'process:', description: 'Process name'},
      {text: 'pid:', description: 'Process ID'},
      {text: 'tid:', description: 'Thread ID'},
    ]
      .filter((item) => item.text.startsWith(plain.toLowerCase()))
      .map((item) => ({...item, text: negative + item.text}));
  }
  return candidates.map((item) => ({
    ...item,
    value: query.slice(0, start) + item.text + query.slice(end),
    caret: start + item.text.length,
  }));
}
