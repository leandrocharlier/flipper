/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import React, {useRef, useState} from 'react';
import {AutoComplete, Input, InputRef} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import {theme, useValue} from 'flipper-plugin';
import type {devicePlugin} from './index';
import {filterQuery, querySuggestions} from './logQuery';

export function LogQueryInput({
  plugin,
}: {
  plugin: ReturnType<typeof devicePlugin>;
}) {
  const filters = useValue(plugin.filters);
  const follow = useValue(plugin.packageFilter.followSelectedApp);
  const error = useValue(plugin.queryError);
  const query = filterQuery(filters, follow);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(query.length);
  const input = useRef<InputRef>(null);
  const suggestions = open
    ? querySuggestions(
        query,
        caret,
        plugin.rows.records().slice(-5000),
        filters.packageName,
      )
    : [];
  return (
    <div
      style={{
        padding: '6px 8px',
        borderBottom: `1px solid ${theme.borderColor}`,
      }}>
      <AutoComplete
        style={{width: '100%'}}
        value={query}
        open={open && suggestions.length > 0}
        defaultActiveFirstOption={false}
        options={suggestions.map((item) => ({
          value: item.value,
          label: (
            <div
              style={{
                display: 'flex',
                gap: 16,
                justifyContent: 'space-between',
              }}>
              <code>{item.text}</code>
              <span style={{color: theme.textColorSecondary}}>
                {item.description}
              </span>
            </div>
          ),
        }))}
        onChange={(value) => {
          plugin.filters.set({...plugin.filters.get(), query: value});
          setCaret(input.current?.input?.selectionStart ?? value.length);
        }}
        onSearch={() => setOpen(true)}
        onFocus={() => {
          setCaret(input.current?.input?.selectionStart ?? query.length);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onSelect={(value) => {
          const item = suggestions.find((option) => option.value === value);
          const nextCaret = item?.caret ?? value.length;
          setCaret(nextCaret);
          setOpen(!!item?.text.endsWith(':'));
          requestAnimationFrame(() =>
            input.current?.input?.setSelectionRange(nextCaret, nextCaret),
          );
        }}>
        <Input
          ref={input}
          aria-label="Filter logs"
          aria-describedby="log-query-help"
          prefix={<SearchOutlined />}
          allowClear
          status={error ? 'error' : undefined}
          placeholder='Filter logs: package:mine level:warn tag:Network message:"timeout"'
          onClick={() => {
            setCaret(input.current?.input?.selectionStart ?? query.length);
            setOpen(true);
          }}
          onKeyUp={() =>
            setCaret(input.current?.input?.selectionStart ?? query.length)
          }
          onKeyDown={(event) => {
            if (event.ctrlKey && event.code === 'Space') {
              event.preventDefault();
              setOpen(true);
            }
            if (event.key === 'Escape') setOpen(false);
          }}
        />
      </AutoComplete>
      <div
        id="log-query-help"
        style={{
          fontSize: 11,
          marginTop: 2,
          color: error ? theme.errorColor : theme.textColorSecondary,
        }}>
        {error
          ? `${error} Showing the last valid filter.`
          : 'Ctrl+Space for suggestions · level:debug = DEBUG and higher · Only DEBUG: level:debug -level:info · package:mine = selected app'}
      </div>
    </div>
  );
}
