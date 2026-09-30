/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import React, {useState} from 'react';
import {Button, Checkbox, InputNumber, Modal, Select} from 'antd';
import {Atom, theme} from 'flipper-plugin';
import {
  LogFormat,
  compactFormat,
  defaultFormat,
  normalizeFormat,
} from './logFormat';
import {LogLine} from './LogLine';
import {ControlOutlined} from '@ant-design/icons';

const examples = ['debug', 'info', 'warn', 'error'].map((type, index) => ({
  date: new Date(2026, 8, 30, 10, 30, index, 123),
  type: type as 'debug' | 'info' | 'warn' | 'error',
  pid: 27217,
  tid: index < 2 ? 3814 : 3945,
  tag: index < 2 ? 'ExampleTag1' : 'ExampleTag2',
  processName: index < 2 ? 'com.example.app' : 'com.example.app:service',
  message:
    index === 3
      ? 'Example multiline message\n    at com.example.Client.send(Client.kt:42)'
      : `Sample logcat message ${index + 1}.`,
}));
export function LogFormatPanel({format}: {format: Atom<LogFormat>}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(defaultFormat);
  function toggle(key: keyof LogFormat, label: string, disabled = false) {
    return (
      <Checkbox
        disabled={disabled}
        checked={draft[key] === true}
        onChange={(event) => setDraft({...draft, [key]: event.target.checked})}>
        {label}
      </Checkbox>
    );
  }
  function width(
    key: 'tagWidth' | 'packageWidth' | 'processWidth',
    label: string,
    disabled: boolean,
  ) {
    return (
      <label style={{display: 'flex', gap: 8, alignItems: 'center'}}>
        {label}
        <InputNumber
          aria-label={label}
          disabled={disabled}
          min={1}
          max={100}
          value={draft[key]}
          onChange={(value) =>
            setDraft({...draft, [key]: value ?? defaultFormat[key]})
          }
        />
      </label>
    );
  }
  const sectionStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  };
  return (
    <>
      <Button
        type="text"
        size="small"
        aria-label="Logcat Format"
        title="Logcat Format"
        icon={<ControlOutlined />}
        onClick={() => {
          setDraft(normalizeFormat(format.get()));
          setOpen(true);
        }}
      />
      <Modal
        title="Logcat Format"
        open={open}
        width={960}
        style={{top: 20}}
        bodyStyle={{maxHeight: 'calc(100vh - 180px)', overflowY: 'auto'}}
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="reset" onClick={() => setDraft(defaultFormat)}>
            Restore defaults
          </Button>,
          <Button key="cancel" onClick={() => setOpen(false)}>
            Cancel
          </Button>,
          <Button
            key="apply"
            onClick={() => format.set(normalizeFormat(draft))}>
            Apply
          </Button>,
          <Button
            key="ok"
            type="primary"
            onClick={() => {
              format.set(normalizeFormat(draft));
              setOpen(false);
            }}>
            OK
          </Button>,
        ]}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            marginBottom: 20,
          }}>
          <span>View</span>
          <Select
            aria-label="Format preset"
            value={
              JSON.stringify(draft) === JSON.stringify(defaultFormat)
                ? 'standard'
                : JSON.stringify(draft) === JSON.stringify(compactFormat)
                  ? 'compact'
                  : 'custom'
            }
            style={{width: 130}}
            options={[
              {value: 'standard', label: 'Standard'},
              {value: 'compact', label: 'Compact'},
              {value: 'custom', label: 'Custom', disabled: true},
            ]}
            onChange={(value) =>
              setDraft(value === 'compact' ? compactFormat : defaultFormat)
            }
          />
          <span style={{color: theme.textColorSecondary}}>
            Saved for future sessions when applied.
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 24,
          }}>
          <div style={sectionStyle}>
            <strong>Timestamp</strong>
            {toggle('showTimestamp', 'Show timestamp')}
            <Select
              aria-label="Timestamp format"
              disabled={!draft.showTimestamp}
              value={draft.timestampFormat}
              options={[
                {value: 'datetime', label: 'Date and time'},
                {value: 'time', label: 'Time only'},
                {value: 'epoch', label: 'Epoch seconds'},
              ]}
              onChange={(value) => setDraft({...draft, timestampFormat: value})}
            />
          </div>
          <div style={sectionStyle}>
            <strong>Process ID</strong>
            {toggle('showPid', 'Show process ID')}
            {toggle('showTid', 'Include thread ID', !draft.showPid)}
          </div>
          <div style={sectionStyle}>
            <strong>Tag</strong>
            {toggle('showTag', 'Show tag')}
            {width('tagWidth', 'Tag width', !draft.showTag)}
            {toggle('repeatTags', 'Show repeated tags', !draft.showTag)}
            {toggle('colorizeTags', 'Colorize tags', !draft.showTag)}
          </div>
          <div style={sectionStyle}>
            <strong>Package name</strong>
            {toggle('showPackage', 'Show package name')}
            {width('packageWidth', 'Package width', !draft.showPackage)}
            {toggle(
              'repeatPackages',
              'Show repeated package names',
              !draft.showPackage,
            )}
          </div>
          <div style={sectionStyle}>
            <strong>Level</strong>
            {toggle('showLevel', 'Show level')}
            {toggle('colorizeMessages', 'Colorize messages by level')}
          </div>
          <div style={sectionStyle}>
            <strong>Process name</strong>
            {toggle('showProcess', 'Show process name')}
            {width('processWidth', 'Process width', !draft.showProcess)}
            {toggle(
              'repeatProcesses',
              'Show repeated process names',
              !draft.showProcess,
            )}
          </div>
        </div>
        <div
          aria-label="Logcat format preview"
          style={{
            whiteSpace: 'pre',
            overflow: 'auto',
            fontFamily:
              '"Flipper JetBrains Mono", Consolas, "SF Mono", Menlo, monospace',
            fontWeight: 400,
            fontVariantLigatures: 'none',
            fontSize: 13,
            lineHeight: '22px',
            marginTop: 24,
            padding: 12,
            background: theme.backgroundDefault,
            border: `1px solid ${theme.borderColor}`,
          }}>
          {examples.map((entry, index) => (
            <LogLine
              key={index}
              entry={entry}
              previous={examples[index - 1]}
              format={normalizeFormat(draft)}
            />
          ))}
        </div>
        <div style={{marginTop: 8, color: theme.textColorSecondary}}>
          Widths are minimum character widths; longer values remain complete.
        </div>
      </Modal>
    </>
  );
}
