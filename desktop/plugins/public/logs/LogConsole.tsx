/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Button} from 'antd';
import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  VerticalAlignBottomOutlined,
  UpOutlined,
  DownOutlined,
} from '@ant-design/icons';
import {theme, useValue} from 'flipper-plugin';
import type {devicePlugin, ExtendedLogEntry} from './index';
import {filterQuery} from './logQuery';
import {LogQueryInput} from './LogQueryInput';
import {LogLine} from './LogLine';
import {LogFormatPanel} from './LogFormatPanel';

export type ConsoleActions = {
  getSelectedText(): string;
  goToBottom(): void;
};

// Native text selection requires keeping the displayed DOM in place. Bounded
// pages avoid rendering the entire 200,000-event history or recycling selected text.
export const PAGE_SIZE = 2000;

export function LogConsole({
  plugin,
}: {
  plugin: ReturnType<typeof devicePlugin>;
}) {
  const filters = useValue(plugin.filters);
  const format = useValue(plugin.format);
  const followSelectedApp = useValue(plugin.packageFilter.followSelectedApp);
  const packageStatus = useValue(plugin.packageFilter.status);
  const paused = useValue(plugin.isPaused);
  const connected = useValue(plugin.connected);
  const [wrap, setWrap] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [following, setFollowing] = useState(true);
  const followRef = useRef(true);
  const viewport = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const contextAnchor = useRef<{
    entry: ExtendedLogEntry;
    offset: number;
  } | null>(null);
  const pendingAnchor = useRef<{
    entry: ExtendedLogEntry;
    offset: number;
  } | null>(null);
  const previousFilters = useRef(filters);
  const entryKeys = useRef(new WeakMap<object, number>());
  const nextEntryKey = useRef(0);
  function entryKey(entry: object) {
    let key = entryKeys.current.get(entry);
    if (key === undefined) {
      key = nextEntryKey.current++;
      entryKeys.current.set(entry, key);
    }
    return key;
  }
  const view = plugin.rows.view;
  const [total, setTotal] = useState(view.size);
  const [page, setPage] = useState(() => {
    const start = Math.max(0, view.size - PAGE_SIZE);
    return {start, records: view.output(start, start + PAGE_SIZE)};
  });
  const pageRef = useRef(page);
  pageRef.current = page;

  function setFollow(value: boolean) {
    followRef.current = value;
    setFollowing(value);
  }
  function showPage(start: number) {
    start = Math.max(0, Math.min(start, Math.max(0, view.size - 1)));
    const next = {start, records: view.output(start, start + PAGE_SIZE)};
    pageRef.current = next;
    setPage(next);
    setTotal(view.size);
  }
  function goToBottom() {
    contextAnchor.current = null;
    pendingAnchor.current = null;
    setFollow(true);
    showPage(Math.max(0, view.size - PAGE_SIZE));
  }
  function getSelectedText() {
    const selection = window.getSelection();
    if (
      !selection ||
      !textRef.current?.contains(selection.anchorNode) ||
      !textRef.current.contains(selection.focusNode)
    ) {
      return '';
    }
    return selection.toString();
  }

  function rememberSelection() {
    const selection = window.getSelection();
    const text = textRef.current;
    if (
      !selection ||
      selection.isCollapsed ||
      !text ||
      !viewport.current ||
      !text.contains(selection.anchorNode) ||
      !text.contains(selection.focusNode)
    )
      return;
    let node = selection.anchorNode;
    while (node && node.parentNode !== text) node = node.parentNode;
    if (!(node instanceof HTMLElement)) return;
    const index = Array.prototype.indexOf.call(text.children, node);
    const entry = pageRef.current.records[index];
    if (entry) {
      contextAnchor.current = {
        entry,
        offset:
          node.getBoundingClientRect().top -
          viewport.current.getBoundingClientRect().top,
      };
      setFollow(false);
    }
  }

  useEffect(() => {
    document.addEventListener('selectionchange', rememberSelection);
    return () =>
      document.removeEventListener('selectionchange', rememberSelection);
    // Selection is read from the current rendered page and DOM refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin]);

  useEffect(() => {
    plugin.consoleRef.current = {getSelectedText, goToBottom};
    return () => {
      plugin.consoleRef.current = null;
    };
    // The actions read current DOM and view state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = view.addListener((change) => {
      // Clearing the data must invalidate a held page immediately,
      // even if fresh events arrive before the next batched display update.
      if (
        change.type === 'reset' &&
        change.newCount === 0 &&
        plugin.rows.size === 0
      ) {
        goToBottom();
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        setTotal(view.size);
        if (followRef.current || view.size === 0) {
          showPage(Math.max(0, view.size - PAGE_SIZE));
        }
      }, 100);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (previousFilters.current === filters) return;
    previousFilters.current = filters;
    // Capture the first visible occurrence before replacing the displayed page.
    // Keep this original anchor while editing, even through an empty result set.
    if (!contextAnchor.current && viewport.current && textRef.current) {
      const bounds = viewport.current.getBoundingClientRect();
      const children = Array.from(textRef.current.children);
      const visible = children.findIndex(
        (child) => child.getBoundingClientRect().bottom > bounds.top,
      );
      const index = Math.max(0, visible);
      const entry = pageRef.current.records[index];
      if (entry) {
        contextAnchor.current = {
          entry,
          offset: children[index].getBoundingClientRect().top - bounds.top,
        };
      }
    }
    const anchor = contextAnchor.current;
    if (anchor) {
      setFollow(false);
      let index = view.getViewIndex(anchor.entry);
      if (index < 0 && view.size > 0) {
        // Search by retained history order, not message text, so repeated events
        // and identical timestamps cannot send the reader to another occurrence.
        const records = plugin.rows.records();
        const original = records.indexOf(anchor.entry);
        const matching = new Set(view.output(0, view.size));
        for (
          let distance = 1;
          original >= 0 && distance < records.length;
          distance++
        ) {
          const next = records[original + distance];
          const previous = records[original - distance];
          const nearest = matching.has(next)
            ? next
            : matching.has(previous)
              ? previous
              : undefined;
          if (nearest) {
            index = view.getViewIndex(nearest);
            break;
          }
        }
        // The original event may have expired from the rolling history.
        if (index < 0) index = 0;
      }
      pendingAnchor.current =
        index >= 0 ? {entry: view.get(index), offset: anchor.offset} : null;
      showPage(Math.max(0, index - Math.floor(PAGE_SIZE / 2)));
    } else {
      goToBottom();
    }
    // The original reading position survives incremental query edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    if (anchor && viewport.current && textRef.current) {
      const index = page.records.indexOf(anchor.entry);
      const element = textRef.current.children[index];
      if (element) {
        viewport.current.scrollTop +=
          element.getBoundingClientRect().top -
          viewport.current.getBoundingClientRect().top -
          anchor.offset;
      }
      pendingAnchor.current = null;
    } else if (following && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [page, following, wrap]);

  function browse(direction: number) {
    contextAnchor.current = null;
    setFollow(false);
    // Recover the current position even if the rolling history dropped old logs.
    const first = pageRef.current.records[0];
    const index = first ? view.getViewIndex(first) : 0;
    showPage(Math.max(0, index) + direction * PAGE_SIZE);
    if (viewport.current) viewport.current.scrollTop = 0;
  }

  const firstIndex = page.records.length
    ? view.getViewIndex(page.records[0])
    : -1;
  const hasOlder = firstIndex > 0;
  const last = page.records[page.records.length - 1];
  const hasNewer = last
    ? view.getViewIndex(last) < view.size - 1
    : view.size > 0;
  const query = filterQuery(filters, followSelectedApp);
  const buttonStyle = {width: 28, height: 28};
  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        color: theme.textColorPrimary,
        background: theme.backgroundDefault,
      }}>
      <div
        role="toolbar"
        aria-label="Logcat actions"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '6px 4px',
          borderRight: `1px solid ${theme.borderColor}`,
        }}>
        <Button
          type="text"
          style={buttonStyle}
          aria-label="Clear logs"
          title="Clear logs (Ctrl+L)"
          icon={<DeleteOutlined />}
          onClick={() => {
            setActionError('');
            plugin
              .clearLogs()
              .catch(() => setActionError('Could not clear device logs.'));
          }}
        />
        <Button
          type="text"
          style={buttonStyle}
          disabled={!connected}
          aria-label={paused ? 'Resume capture' : 'Pause capture'}
          title={paused ? 'Resume capture' : 'Pause capture'}
          icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
          onClick={plugin.resumePause}
        />
        <Button
          type="text"
          style={buttonStyle}
          disabled={!connected}
          loading={reloading}
          aria-label="Reload logs"
          title="Reload capture (keeps history)"
          icon={<ReloadOutlined />}
          onClick={async () => {
            setReloading(true);
            setActionError('');
            try {
              await plugin.reloadLogs();
              goToBottom();
            } catch {
              setActionError('Could not reload capture.');
            } finally {
              setReloading(false);
            }
          }}
        />
        <Button
          type={wrap ? 'primary' : 'text'}
          style={buttonStyle}
          aria-label="Soft wrap"
          aria-pressed={wrap}
          title="Soft wrap (wrap long lines)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true">
              <path
                d="M3 5h18M3 10h13a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 15h4M3 20h4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          onClick={() => setWrap(!wrap)}
        />
        <Button
          type={following ? 'primary' : 'text'}
          style={buttonStyle}
          aria-label="Go to bottom"
          aria-pressed={following}
          title="Go to bottom and follow new logs"
          icon={<VerticalAlignBottomOutlined />}
          onClick={goToBottom}
        />
        <div
          style={{borderTop: `1px solid ${theme.borderColor}`, margin: '3px 0'}}
        />
        <Button
          type="text"
          style={buttonStyle}
          disabled={!hasOlder}
          aria-label="Older logs"
          title="Older logs: previous block of 2,000 entries"
          icon={<UpOutlined />}
          onClick={() => browse(-1)}
        />
        <Button
          type="text"
          style={buttonStyle}
          disabled={!hasNewer}
          aria-label="Newer logs"
          title="Newer logs: next block of 2,000 entries"
          icon={<DownOutlined />}
          onClick={() => browse(1)}
        />
        <LogFormatPanel format={plugin.format} />
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minWidth: 0,
          minHeight: 0,
        }}>
        <LogQueryInput plugin={plugin} />
        <div
          ref={viewport}
          style={{flex: 1, minHeight: 0, overflow: 'auto'}}
          onMouseDown={() => {
            contextAnchor.current = null;
            setFollow(false);
          }}
          onWheel={(event) => {
            contextAnchor.current = null;
            if (event.deltaY < 0) setFollow(false);
          }}>
          <div
            ref={textRef}
            aria-label="Logcat text"
            role="textbox"
            aria-readonly="true"
            aria-multiline="true"
            tabIndex={0}
            onMouseDown={() => setFollow(false)}
            onMouseUp={rememberSelection}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === 'a'
              ) {
                event.preventDefault();
                event.stopPropagation();
                setFollow(false);
                const range = document.createRange();
                range.selectNodeContents(event.currentTarget);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
              }
              if (
                [
                  'ArrowUp',
                  'PageUp',
                  'Home',
                  'ArrowLeft',
                  'ArrowRight',
                  'ArrowDown',
                  'PageDown',
                  'End',
                ].includes(event.key)
              ) {
                contextAnchor.current = null;
                setFollow(false);
              }
            }}
            style={{
              margin: 0,
              padding: '8px 12px',
              minHeight: page.records.length ? '100%' : 0,
              outline: 'none',
              fontFamily:
                '"Flipper JetBrains Mono", Consolas, "SF Mono", Menlo, monospace',
              fontSize: 13,
              fontWeight: 400,
              fontVariantLigatures: 'none',
              lineHeight: '22px',
              tabSize: 4,
              userSelect: 'text',
              cursor: 'text',
              whiteSpace: wrap ? 'pre-wrap' : 'pre',
              overflowWrap: wrap ? 'anywhere' : 'normal',
            }}>
            {page.records.map((entry, index) => (
              <LogLine
                key={entryKey(entry)}
                entry={entry}
                format={format}
                previous={page.records[index - 1]}
              />
            ))}
          </div>
          {page.records.length === 0 && (
            <div style={{padding: 16, color: theme.textColorSecondary}}>
              No matching logs. Check the filters or connect a device.
            </div>
          )}
        </div>
        <div
          role="status"
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            padding: '4px 8px',
            fontSize: 11,
            borderTop: `1px solid ${theme.borderColor}`,
            color: theme.textColorSecondary,
          }}>
          <span title="All matching entries are retained in the history. Use Older logs and Newer logs to browse blocks.">
            {firstIndex >= 0
              ? `Showing ${(firstIndex + 1).toLocaleString()}–${(firstIndex + page.records.length).toLocaleString()} of `
              : `${page.records.length.toLocaleString()} displayed / `}
            {total.toLocaleString()} matching
            {total > PAGE_SIZE && ' · Use ↑ / ↓ to browse blocks'}
          </span>
          {query.includes('package:mine') && (
            <span>
              {filters.packageName || 'Select an app in Flipper'}
              {packageStatus.pids.length
                ? ` | PID: ${packageStatus.pids.join(', ')}`
                : ''}
            </span>
          )}
          {(actionError || packageStatus.error) && (
            <span style={{color: theme.errorColor}}>
              {actionError || 'Unable to read Android processes; retrying…'}
            </span>
          )}
          <span style={{marginLeft: 'auto'}}>
            {paused
              ? 'Capture paused'
              : !following
                ? 'View held | Go to bottom to follow'
                : 'Following new logs'}
          </span>
        </div>
      </div>
    </div>
  );
}
