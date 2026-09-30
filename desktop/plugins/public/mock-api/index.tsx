/**
 * Copyright (c) Flipper Community contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  CaretRightOutlined,
  StopOutlined,
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  SaveOutlined,
  ImportOutlined,
  ExportOutlined,
  LockOutlined,
  ClearOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  createState,
  DevicePluginClient,
  theme,
  usePlugin,
  useValue,
} from 'flipper-plugin';
import type {
  Environment,
  Header,
  Route,
  RouteResponse,
  ResponseRule,
} from '@mockoon/commons';
import {Events, Methods, MockEnvironment, MockLog, Workspace} from './contract';

export function devicePlugin(client: DevicePluginClient<Events, Methods>) {
  const workspace = createState<Workspace | null>(null);
  const error = createState('');
  const logs = createState<MockLog[]>([]);
  client.onServerAddOnMessage('changed', (value) => workspace.set(value));
  client.onServerAddOnMessage('transaction', (value) =>
    logs.update((items) => [...items, value].slice(-1000)),
  );
  async function load() {
    try {
      workspace.set(await client.sendToServerAddOn('load'));
      error.set('');
    } catch (err) {
      error.set(String(err));
    }
  }
  client.onReady(() => client.onServerAddOnStart(load));
  // Environments/traffic are intentionally not registered as exportable device state.
  return {client, workspace, error, logs, load};
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const id = () => crypto.randomUUID();
const mono = {fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12};
const box: React.CSSProperties = {
  border: `1px solid ${theme.dividerColor}`,
  borderRadius: 6,
  padding: 16,
};
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 16,
};

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        marginBottom: 12,
      }}>
      <Typography.Text strong>{label}</Typography.Text>
      {children}
      {hint && (
        <Typography.Text type="secondary" style={{fontSize: 12}}>
          {hint}
        </Typography.Text>
      )}
    </label>
  );
}

function Headers({
  value,
  onChange,
}: {
  value: Header[];
  onChange: (headers: Header[]) => void;
}) {
  return (
    <div>
      {value.map((header, index) => (
        <div key={index} style={{display: 'flex', gap: 8, marginBottom: 6}}>
          <Input
            aria-label={`Header ${index + 1} name`}
            placeholder="Content-Type"
            value={header.key}
            onChange={(e) =>
              onChange(
                value.map((item, i) =>
                  i === index ? {...item, key: e.target.value} : item,
                ),
              )
            }
          />
          <Input
            aria-label={`Header ${index + 1} value`}
            placeholder="application/json"
            value={header.value}
            onChange={(e) =>
              onChange(
                value.map((item, i) =>
                  i === index ? {...item, value: e.target.value} : item,
                ),
              )
            }
          />
          <Button
            aria-label={`Remove header ${index + 1}`}
            icon={<DeleteOutlined />}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={() => onChange([...value, {key: '', value: ''}])}>
        Header
      </Button>
    </div>
  );
}

function JsonEditor({
  value,
  onApply,
  label = 'JSON',
  rows = 15,
}: {
  value: unknown;
  onApply: (value: any) => void;
  label?: string;
  rows?: number;
}) {
  const serialized = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState('');
  useEffect(() => {
    setText(serialized);
    setError('');
  }, [serialized]);
  return (
    <div>
      <Input.TextArea
        aria-label={label}
        spellCheck={false}
        rows={rows}
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={mono}
      />
      {error && (
        <Alert type="error" showIcon message={error} style={{marginTop: 8}} />
      )}
      <Button
        style={{marginTop: 8}}
        disabled={text === serialized}
        onClick={() => {
          try {
            onApply(JSON.parse(text));
            setError('');
          } catch (err) {
            setError((err as Error).message);
          }
        }}>
        Apply JSON to draft
      </Button>
    </div>
  );
}

function Rules({
  value,
  template,
  onChange,
}: {
  value: ResponseRule[];
  template: ResponseRule;
  onChange: (rules: ResponseRule[]) => void;
}) {
  const update = (index: number, patch: Partial<ResponseRule>) =>
    onChange(
      value.map((rule, i) => (i === index ? {...rule, ...patch} : rule)),
    );
  return (
    <div>
      {value.map((rule, index) => (
        <div key={index} style={{...box, marginBottom: 8, padding: 10}}>
          <div style={grid}>
            <Field label="Target">
              <Select
                value={rule.target}
                onChange={(target) => update(index, {target})}
                options={[
                  'body',
                  'query',
                  'header',
                  'cookie',
                  'params',
                  'path',
                  'method',
                  'request_number',
                  'global_var',
                  'data_bucket',
                  'templating',
                ].map((value) => ({value}))}
              />
            </Field>
            <Field label="Property / expression">
              <Input
                value={rule.modifier}
                onChange={(e) => update(index, {modifier: e.target.value})}
                placeholder="userId"
              />
            </Field>
            <Field label="Operator">
              <Select
                value={rule.operator}
                onChange={(operator) => update(index, {operator})}
                options={[
                  'equals',
                  'regex',
                  'regex_i',
                  'null',
                  'empty_array',
                  'array_includes',
                  'valid_json_schema',
                ].map((value) => ({value}))}
              />
            </Field>
            <Field label="Value">
              <Input
                value={rule.value}
                onChange={(e) => update(index, {value: e.target.value})}
              />
            </Field>
          </div>
          <Space>
            <Checkbox
              checked={rule.invert}
              onChange={(e) => update(index, {invert: e.target.checked})}>
              Invert match
            </Checkbox>
            <Button
              size="small"
              onClick={() => onChange(value.filter((_, i) => i !== index))}>
              Remove rule
            </Button>
          </Space>
        </div>
      ))}
      <Button
        icon={<PlusOutlined />}
        onClick={() => onChange([...value, clone(template)])}>
        Add rule
      </Button>
    </div>
  );
}

function ResponseEditor({
  response,
  workspace,
  onChange,
}: {
  response: RouteResponse;
  workspace: Workspace;
  onChange: (patch: Partial<RouteResponse>) => void;
}) {
  return (
    <>
      <div style={grid}>
        <Field label="Response name">
          <Input
            value={response.label}
            onChange={(e) => onChange({label: e.target.value})}
          />
        </Field>
        <Field label="Status code">
          <InputNumber
            min={100}
            max={599}
            value={response.statusCode}
            onChange={(value) => onChange({statusCode: value || 200})}
          />
        </Field>
        <Field label="Response delay (ms)">
          <InputNumber
            min={0}
            value={response.latency}
            onChange={(value) => onChange({latency: value || 0})}
          />
        </Field>
        <Field label="Body source">
          <Select
            value={response.bodyType}
            onChange={(bodyType) => onChange({bodyType})}
            options={[
              {value: 'INLINE', label: 'Text / JSON / template'},
              {value: 'FILE', label: 'File'},
              {value: 'DATABUCKET', label: 'Data bucket'},
            ]}
          />
        </Field>
      </div>
      <Tabs
        size="small"
        items={[
          {
            key: 'body',
            label: 'Body',
            children: (
              <>
                {response.bodyType === 'INLINE' && (
                  <Input.TextArea
                    aria-label="Response body"
                    rows={14}
                    spellCheck={false}
                    style={mono}
                    value={response.body}
                    onChange={(e) => onChange({body: e.target.value})}
                  />
                )}
                {response.bodyType === 'FILE' && (
                  <>
                    <Field
                      label="File path"
                      hint="Relative to the environment working directory, or an absolute path.">
                      <Input
                        value={response.filePath}
                        onChange={(e) => onChange({filePath: e.target.value})}
                      />
                    </Field>
                    <Checkbox
                      checked={response.sendFileAsBody}
                      onChange={(e) =>
                        onChange({sendFileAsBody: e.target.checked})
                      }>
                      Send file content as response body
                    </Checkbox>
                  </>
                )}
                {response.bodyType === 'DATABUCKET' && (
                  <Field label="Data bucket ID">
                    <Input
                      value={response.databucketID}
                      onChange={(e) => onChange({databucketID: e.target.value})}
                    />
                  </Field>
                )}
                <div style={{marginTop: 12}}>
                  <Checkbox
                    checked={!response.disableTemplating}
                    onChange={(e) =>
                      onChange({disableTemplating: !e.target.checked})
                    }>
                    Enable Mockoon templates and Faker helpers
                  </Checkbox>
                </div>
              </>
            ),
          },
          {
            key: 'headers',
            label: 'Headers',
            children: (
              <Headers
                value={response.headers}
                onChange={(headers) => onChange({headers})}
              />
            ),
          },
          {
            key: 'rules',
            label: `Rules (${response.rules.length})`,
            children: (
              <>
                <Space style={{marginBottom: 12}}>
                  <Typography.Text>Match</Typography.Text>
                  <Select
                    value={response.rulesOperator}
                    onChange={(rulesOperator) => onChange({rulesOperator})}
                    options={[
                      {value: 'AND', label: 'All rules (AND)'},
                      {value: 'OR', label: 'Any rule (OR)'},
                    ]}
                  />
                  <Checkbox
                    checked={response.default}
                    onChange={(e) => onChange({default: e.target.checked})}>
                    Default response
                  </Checkbox>
                </Space>
                <Rules
                  value={response.rules}
                  template={workspace.templates.rule}
                  onChange={(rules) => onChange({rules})}
                />
              </>
            ),
          },
          {
            key: 'advanced',
            label: 'Advanced / callbacks',
            children: (
              <JsonEditor
                label="Response configuration JSON"
                value={response}
                onApply={(value) => {
                  if (
                    !value ||
                    typeof value !== 'object' ||
                    !Array.isArray(value.rules) ||
                    !Array.isArray(value.headers)
                  )
                    throw new Error(
                      'Expected a response object with rules and headers.',
                    );
                  onChange({...value, uuid: response.uuid});
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}

function Routes({
  record,
  workspace,
  onChange,
}: {
  record: MockEnvironment;
  workspace: Workspace;
  onChange: (patch: Partial<MockEnvironment>) => void;
}) {
  const env = record.environment;
  const [selected, setSelected] = useState(env.routes[0]?.uuid || '');
  const [responseId, setResponseId] = useState('');
  const route =
    env.routes.find((item) => item.uuid === selected) || env.routes[0];
  const response =
    route?.responses.find((item) => item.uuid === responseId) ||
    route?.responses[0];
  const changeRoutes = (routes: Route[]) =>
    onChange({environment: {...env, routes}});
  const update = (patch: Partial<Route>) =>
    changeRoutes(
      env.routes.map((item) =>
        item.uuid === route.uuid ? {...item, ...patch} : item,
      ),
    );
  const add = () => {
    const next = clone(workspace.templates.route);
    next.uuid = id();
    next.endpoint = `route-${env.routes.length + 1}`;
    next.responses.forEach((item) => (item.uuid = id()));
    changeRoutes([...env.routes, next]);
    setSelected(next.uuid);
  };
  return (
    <div style={{display: 'flex', minHeight: 480, gap: 16}}>
      <div
        style={{
          width: 245,
          flexShrink: 0,
          borderRight: `1px solid ${theme.dividerColor}`,
          paddingRight: 12,
        }}>
        <Button block icon={<PlusOutlined />} onClick={add}>
          Add route
        </Button>
        <div style={{marginTop: 12, maxHeight: '65vh', overflowY: 'auto'}}>
          {env.routes.map((item) => (
            <Button
              key={item.uuid}
              block
              type={item.uuid === route?.uuid ? 'primary' : 'text'}
              style={{
                height: 'auto',
                padding: 10,
                textAlign: 'left',
                marginBottom: 4,
                whiteSpace: 'normal',
              }}
              onClick={() => {
                setSelected(item.uuid);
                setResponseId('');
              }}>
              <span
                style={{
                  ...mono,
                  opacity: record.disabledRoutes.includes(item.uuid) ? 0.45 : 1,
                }}>
                <strong>
                  {item.type === 'http'
                    ? item.method.toUpperCase()
                    : item.type.toUpperCase()}
                </strong>{' '}
                /{item.endpoint}
              </span>
            </Button>
          ))}
        </div>
      </div>
      <div style={{flex: 1, minWidth: 0}}>
        {route ? (
          <>
            <Space style={{marginBottom: 12}} wrap>
              <Switch
                checked={!record.disabledRoutes.includes(route.uuid)}
                checkedChildren="Enabled"
                unCheckedChildren="Disabled"
                onChange={(enabled) =>
                  onChange({
                    disabledRoutes: enabled
                      ? record.disabledRoutes.filter(
                          (value) => value !== route.uuid,
                        )
                      : [...record.disabledRoutes, route.uuid],
                  })
                }
              />
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  const next = clone(route);
                  next.uuid = id();
                  next.responses.forEach((item) => (item.uuid = id()));
                  changeRoutes([...env.routes, next]);
                  setSelected(next.uuid);
                }}>
                Duplicate
              </Button>
              <Popconfirm
                title="Delete this route and its responses?"
                onConfirm={() =>
                  changeRoutes(
                    env.routes.filter((item) => item.uuid !== route.uuid),
                  )
                }>
                <Button size="small" danger icon={<DeleteOutlined />}>
                  Delete
                </Button>
              </Popconfirm>
            </Space>
            <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
              <Select
                aria-label="Route type"
                style={{width: 100}}
                value={route.type}
                onChange={(type) => update({type})}
                options={[
                  {value: 'http', label: 'HTTP'},
                  {value: 'crud', label: 'CRUD'},
                  {value: 'ws', label: 'WebSocket'},
                ]}
              />
              <Select
                aria-label="HTTP method"
                style={{width: 110}}
                value={route.method}
                onChange={(method) => update({method})}
                options={[
                  'get',
                  'post',
                  'put',
                  'patch',
                  'delete',
                  'head',
                  'options',
                  'all',
                  'propfind',
                  'proppatch',
                  'move',
                  'copy',
                  'mkcol',
                  'lock',
                  'unlock',
                ].map((value) => ({value, label: value.toUpperCase()}))}
              />
              <Input
                aria-label="Route path"
                addonBefore="/"
                value={route.endpoint}
                onChange={(e) =>
                  update({endpoint: e.target.value.replace(/^\//, '')})
                }
                placeholder="users/:id"
              />
            </div>
            <Field label="Documentation">
              <Input
                value={route.documentation}
                onChange={(e) => update({documentation: e.target.value})}
              />
            </Field>
            <div style={grid}>
              <Field label="Response selection">
                <Select
                  value={route.responseMode || 'rules'}
                  onChange={(value) =>
                    update({
                      responseMode:
                        value === 'rules'
                          ? null
                          : (value as Route['responseMode']),
                    })
                  }
                  options={[
                    {value: 'rules', label: 'Rules'},
                    {value: 'RANDOM', label: 'Random'},
                    {value: 'SEQUENTIAL', label: 'Sequential'},
                    {
                      value: 'DISABLE_RULES',
                      label: 'Default response (ignore rules)',
                    },
                    {value: 'FALLBACK', label: 'Rules with fallback'},
                  ]}
                />
              </Field>
              {route.type === 'ws' && (
                <>
                  <Field label="Streaming mode">
                    <Select
                      value={route.streamingMode}
                      allowClear
                      onChange={(value) =>
                        update({streamingMode: value || null})
                      }
                      options={['UNICAST', 'BROADCAST'].map((value) => ({
                        value,
                      }))}
                    />
                  </Field>
                  <Field label="Streaming interval (ms)">
                    <InputNumber
                      min={0}
                      value={route.streamingInterval}
                      onChange={(value) =>
                        update({streamingInterval: value || 0})
                      }
                    />
                  </Field>
                </>
              )}
            </div>
            <Space style={{marginBottom: 16}} wrap>
              <Select
                aria-label="Selected response"
                style={{minWidth: 190}}
                value={response?.uuid}
                onChange={setResponseId}
                options={route.responses.map((item, i) => ({
                  value: item.uuid,
                  label: `${item.statusCode} · ${item.label || `Response ${i + 1}`}`,
                }))}
              />
              <Button
                icon={<PlusOutlined />}
                onClick={() => {
                  const next = clone(workspace.templates.response);
                  next.uuid = id();
                  next.default = false;
                  update({responses: [...route.responses, next]});
                  setResponseId(next.uuid);
                }}>
                Response
              </Button>
              <Button
                disabled={route.responses.length < 2}
                icon={<DeleteOutlined />}
                aria-label="Delete response"
                onClick={() =>
                  update({
                    responses: route.responses.filter(
                      (item) => item.uuid !== response.uuid,
                    ),
                  })
                }
              />
            </Space>
            {response && (
              <ResponseEditor
                key={response.uuid}
                response={response}
                workspace={workspace}
                onChange={(patch) =>
                  update({
                    responses: route.responses.map((item) =>
                      item.uuid === response.uuid
                        ? {...item, ...patch}
                        : patch.default
                          ? {...item, default: false}
                          : item,
                    ),
                  })
                }
              />
            )}
          </>
        ) : (
          <Empty description="Add a route to define your first response">
            <Button onClick={add}>Add route</Button>
          </Empty>
        )}
      </div>
    </div>
  );
}

function TLS({
  env,
  onChange,
}: {
  env: Environment;
  onChange: (patch: Partial<Environment>) => void;
}) {
  const tls = env.tlsOptions;
  const update = (patch: Partial<typeof tls>) =>
    onChange({tlsOptions: {...tls, ...patch}});
  return (
    <div style={{maxWidth: 900}}>
      <Space style={{marginBottom: 20}}>
        <Switch
          checked={tls.enabled}
          onChange={(enabled) => update({enabled})}
        />
        <Typography.Text strong>Serve over HTTPS / WSS</Typography.Text>
      </Space>
      <Alert
        type="info"
        showIcon
        message="TLS runs on the mock server"
        description="Leave certificate paths empty to use Mockoon's built-in development certificate. For a trusted connection on a phone, use a certificate trusted by that device and matching the hostname. Enabling TLS does not automatically make a certificate trusted."
        style={{marginBottom: 20}}
      />
      <Field label="Certificate format">
        <Select
          disabled={!tls.enabled}
          value={tls.type}
          onChange={(type) => update({type})}
          options={[
            {value: 'CERT', label: 'PEM certificate + private key'},
            {value: 'PFX', label: 'PKCS#12 / PFX'},
          ]}
        />
      </Field>
      {tls.type === 'CERT' ? (
        <>
          <Field label="Certificate path (PEM)">
            <Input
              disabled={!tls.enabled}
              value={tls.certPath}
              placeholder="certificates/server.crt"
              onChange={(e) => update({certPath: e.target.value})}
            />
          </Field>
          <Field label="Private key path (PEM)">
            <Input
              disabled={!tls.enabled}
              value={tls.keyPath}
              placeholder="certificates/server.key"
              onChange={(e) => update({keyPath: e.target.value})}
            />
          </Field>
        </>
      ) : (
        <Field label="PFX / P12 file path">
          <Input
            disabled={!tls.enabled}
            value={tls.pfxPath}
            placeholder="certificates/server.p12"
            onChange={(e) => update({pfxPath: e.target.value})}
          />
        </Field>
      )}
      <Field label="CA chain path (optional)">
        <Input
          disabled={!tls.enabled}
          value={tls.caPath}
          onChange={(e) => update({caPath: e.target.value})}
        />
      </Field>
      <Field
        label="Key / PFX passphrase"
        hint="Session only. Not saved to disk or included in exports. Re-enter after restarting Flipper.">
        <Input.Password
          disabled={!tls.enabled}
          value={tls.passphrase}
          autoComplete="new-password"
          onChange={(e) => update({passphrase: e.target.value})}
        />
      </Field>
      <Typography.Text type="secondary">
        Paths refer to files on the computer running Flipper. Certificate and
        key contents are never copied into environment exports.
      </Typography.Text>
    </div>
  );
}

function Traffic({logs, clear}: {logs: MockLog[]; clear: () => void}) {
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const filtered = logs.filter((log) =>
    `${log.transaction.request.method} ${log.transaction.request.urlPath} ${log.transaction.response.statusCode}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const current = logs.find((log) => log.transaction.uuid === selected);
  return (
    <>
      <Space style={{marginBottom: 12}}>
        <Input.Search
          aria-label="Filter mock requests"
          placeholder="Filter method, URL or status"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button icon={<ClearOutlined />} onClick={clear}>
          Clear
        </Button>
        <Typography.Text type="secondary">
          Last 500 requests · bodies up to 64 KiB · kept in memory
        </Typography.Text>
      </Space>
      <div style={{display: 'flex', gap: 16}}>
        <div style={{width: '42%', maxHeight: '60vh', overflow: 'auto'}}>
          {filtered.length ? (
            [...filtered].reverse().map(({transaction: t}) => (
              <Button
                block
                key={t.uuid}
                type={selected === t.uuid ? 'primary' : 'text'}
                style={{
                  height: 'auto',
                  textAlign: 'left',
                  padding: 10,
                  whiteSpace: 'normal',
                }}
                onClick={() => setSelected(t.uuid)}>
                <div style={mono}>
                  <Tag color={t.response.statusCode >= 400 ? 'red' : 'green'}>
                    {t.response.statusCode}
                  </Tag>
                  {t.request.method.toUpperCase()} {t.request.urlPath}
                  {t.request.query ? `?${t.request.query}` : ''}
                </div>
                <Typography.Text type="secondary">
                  {new Date(t.timestampMs).toLocaleTimeString()}
                  {t.proxied ? ' · proxied' : ''}
                </Typography.Text>
              </Button>
            ))
          ) : (
            <Empty description="Requests received by this mock server will appear here" />
          )}
        </div>
        <div style={{flex: 1, minWidth: 0}}>
          {current && (
            <Input.TextArea
              aria-label="Request and response details"
              readOnly
              rows={28}
              value={JSON.stringify(current.transaction, null, 2)}
              style={mono}
            />
          )}
        </div>
      </div>
    </>
  );
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Component() {
  const plugin = usePlugin(devicePlugin);
  const workspace = useValue(plugin.workspace);
  const error = useValue(plugin.error);
  const logs = useValue(plugin.logs);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<MockEnvironment | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('routes');
  const input = useRef<HTMLInputElement>(null);
  const record =
    workspace?.records.find((item) => item.environment.uuid === selected) ||
    workspace?.records[0];
  const recordId = record?.environment.uuid;
  useEffect(() => {
    setDraft(record ? clone(record) : null);
    setDirty(false);
    if (recordId) {
      plugin.client
        .sendToServerAddOn('logs', recordId)
        .then((items) =>
          plugin.logs.update((current) => {
            const combined = [...items, ...current];
            return [
              ...new Map(
                combined.map((item) => [item.transaction.uuid, item]),
              ).values(),
            ].slice(-1000);
          }),
        )
        .catch((err) => plugin.error.set(String(err)));
    }
    // Reset only when selecting another environment; status events must retain edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);
  useEffect(() => {
    if (!dirty && record) setDraft(clone(record));
  }, [record, dirty]);

  async function action<T>(
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    setBusy(true);
    plugin.error.set('');
    try {
      return await operation();
    } catch (err) {
      plugin.error.set((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const change = (patch: Partial<MockEnvironment>) => {
    if (draft) {
      setDraft({...draft, ...patch});
      setDirty(true);
    }
  };
  const env = draft?.environment;
  const changeEnv = (patch: Partial<Environment>) => {
    if (env) change({environment: {...env, ...patch}});
  };
  const save = async () => {
    if (!draft) return;
    const next = await plugin.client.sendToServerAddOn('save', draft);
    plugin.workspace.set(next);
    setDraft(
      clone(
        next.records.find(
          (item) => item.environment.uuid === draft.environment.uuid,
        ) || draft,
      ),
    );
    setDirty(false);
  };
  const choose = (next: string) => {
    if (
      dirty &&
      !window.confirm('Discard unsaved changes to this environment?')
    )
      return;
    setSelected(next);
  };
  const status = env && workspace?.statuses[env.uuid];

  if (!workspace)
    return (
      <div style={{padding: 32}}>
        {error ? (
          <Alert
            type="error"
            message={error}
            action={<Button onClick={plugin.load}>Retry</Button>}
          />
        ) : (
          <Spin tip="Loading Mock API…" />
        )}
      </div>
    );
  return (
    <div
      aria-label="Mock API workspace"
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        background: theme.backgroundDefault,
        color: theme.textColorPrimary,
      }}>
      <aside
        style={{
          width: 210,
          flexShrink: 0,
          padding: 16,
          borderRight: `1px solid ${theme.dividerColor}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          overflow: 'auto',
        }}>
        <Typography.Title level={4} style={{margin: 0}}>
          <ApiOutlined /> Mock API
        </Typography.Title>
        <Typography.Text type="secondary">
          Powered by Mockoon 9.9
        </Typography.Text>
        <Button
          icon={<PlusOutlined />}
          onClick={() =>
            action(async () => {
              if (dirty && !window.confirm('Discard unsaved changes?')) return;
              setSelected(await plugin.client.sendToServerAddOn('create'));
            })
          }
          disabled={busy}>
          New environment
        </Button>
        <div style={{flex: 1}}>
          {workspace.records.map((item) => (
            <Button
              key={item.environment.uuid}
              block
              type={item.environment.uuid === recordId ? 'primary' : 'text'}
              onClick={() => choose(item.environment.uuid)}
              style={{
                height: 'auto',
                whiteSpace: 'normal',
                padding: 10,
                marginBottom: 6,
                textAlign: 'left',
              }}>
              <div>
                {workspace.statuses[item.environment.uuid]?.running
                  ? '● '
                  : '○ '}
                {item.environment.name}
                {workspace.statuses[item.environment.uuid]?.reloadRequired && (
                  <ReloadOutlined style={{marginLeft: 6}} />
                )}
              </div>
              <small>
                {item.environment.tlsOptions.enabled ? 'HTTPS' : 'HTTP'} ·{' '}
                {item.environment.port}
              </small>
            </Button>
          ))}
        </div>
        <Button
          icon={<ImportOutlined />}
          onClick={() => input.current?.click()}
          disabled={busy}>
          Import
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".json,.yaml,.yml"
          style={{display: 'none'}}
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            if (!files.length) return;
            action(async () => {
              if (dirty && !window.confirm('Discard unsaved changes?')) return;
              for (const file of files) {
                if (file.size > 20 * 1024 * 1024)
                  throw new Error('Import is limited to 20 MiB per file.');
                const desktop = (
                  window as unknown as {
                    flipperDesktop?: {getPathForFile: (file: File) => string};
                  }
                ).flipperDesktop;
                const sourcePath = desktop?.getPathForFile(file) || undefined;
                const ids = await plugin.client.sendToServerAddOn('import', {
                  text: await file.text(),
                  sourcePath,
                });
                if (ids[0]) setSelected(ids[0]);
              }
            });
          }}
        />
        <Typography.Text type="secondary" style={{fontSize: 11}}>
          Local environments. No cloud sync or Flipper SDK required in your app.
        </Typography.Text>
      </aside>
      <main style={{flex: 1, minWidth: 0, overflow: 'auto', padding: 20}}>
        {error && (
          <Alert
            type="error"
            showIcon
            closable
            onClose={() => plugin.error.set('')}
            message={error}
            style={{marginBottom: 12}}
          />
        )}
        {env && draft ? (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: 12,
              }}>
              <Space>
                <Typography.Title level={4} style={{margin: 0}}>
                  {env.name}
                </Typography.Title>
                <Tag color={status?.running ? 'green' : 'default'}>
                  {status?.running ? 'Running' : 'Stopped'}
                </Tag>
                {dirty && <Tag color="gold">Unsaved changes</Tag>}
              </Space>
              <Space wrap>
                <Button
                  aria-label="Save environment"
                  icon={<SaveOutlined />}
                  loading={busy}
                  disabled={!dirty}
                  onClick={() => action(save)}>
                  Save
                </Button>
                {status?.running && (
                  <Tooltip
                    title={
                      status.reloadRequired || dirty
                        ? 'Apply changes to the running server'
                        : 'Restart server'
                    }>
                    <Button
                      aria-label="Reload mock server"
                      icon={<ReloadOutlined />}
                      type={
                        status.reloadRequired || dirty ? 'primary' : 'default'
                      }
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          if (dirty) await save();
                          plugin.workspace.set(
                            await plugin.client.sendToServerAddOn(
                              'restart',
                              env.uuid,
                            ),
                          );
                        })
                      }
                    />
                  </Tooltip>
                )}
                <Button
                  type="primary"
                  icon={
                    status?.running ? <StopOutlined /> : <CaretRightOutlined />
                  }
                  loading={busy}
                  onClick={() =>
                    action(async () => {
                      if (status?.running) {
                        plugin.workspace.set(
                          await plugin.client.sendToServerAddOn(
                            'stop',
                            env.uuid,
                          ),
                        );
                      } else {
                        if (dirty) await save();
                        plugin.workspace.set(
                          await plugin.client.sendToServerAddOn(
                            'start',
                            env.uuid,
                          ),
                        );
                      }
                    })
                  }>
                  {status?.running ? 'Stop' : 'Start'}
                </Button>
                <Tooltip title="Export saved environment in Mockoon format (TLS passphrase excluded)">
                  <Button
                    aria-label="Export Mockoon"
                    icon={<ExportOutlined />}
                    disabled={dirty || busy}
                    onClick={() =>
                      action(async () =>
                        download(
                          await plugin.client.sendToServerAddOn('export', {
                            id: env.uuid,
                            format: 'mockoon',
                          }),
                          `${env.name.replace(/[^a-z0-9_-]/gi, '-')}.json`,
                        ),
                      )
                    }>
                    Export
                  </Button>
                </Tooltip>
                <Popconfirm
                  title="Delete this environment? Its server will stop."
                  onConfirm={() =>
                    action(async () => {
                      plugin.workspace.set(
                        await plugin.client.sendToServerAddOn(
                          'remove',
                          env.uuid,
                        ),
                      );
                      setSelected('');
                    })
                  }>
                  <Button
                    aria-label="Delete environment"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={busy}
                  />
                </Popconfirm>
              </Space>
            </div>
            <div
              style={{
                ...mono,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginBottom: 16,
              }}>
              {env.tlsOptions.enabled && <LockOutlined />}{' '}
              {env.tlsOptions.enabled ? 'https' : 'http'}://
              {env.hostname.includes(':')
                ? `[${env.hostname}]`
                : env.hostname || '0.0.0.0'}
              :
              <Tooltip title="Server port. Save and reload to apply changes.">
                <InputNumber
                  aria-label="Server port"
                  min={1}
                  max={65535}
                  precision={0}
                  value={env.port}
                  disabled={busy}
                  style={{width: 96}}
                  onChange={(port) => {
                    if (port !== null) changeEnv({port});
                  }}
                />
              </Tooltip>
              /{env.endpointPrefix}
            </div>
            {status?.error && (
              <Alert
                type="warning"
                showIcon
                message={status.error}
                style={{marginBottom: 12}}
              />
            )}
            {status?.reloadRequired && (
              <Alert
                type="info"
                showIcon
                message="Changes detected. Press the reload arrow to apply them to the running server."
                style={{marginBottom: 12}}
              />
            )}
            <Tabs
              activeKey={tab}
              onChange={setTab}
              items={[
                {
                  key: 'routes',
                  label: `Routes (${env.routes.length})`,
                  children: (
                    <Routes
                      key={env.uuid}
                      record={draft}
                      workspace={workspace}
                      onChange={change}
                    />
                  ),
                },
                {
                  key: 'traffic',
                  label: 'Requests',
                  children: (
                    <Traffic
                      logs={logs.filter(
                        (log) => log.environmentId === env.uuid,
                      )}
                      clear={() =>
                        action(async () => {
                          await plugin.client.sendToServerAddOn(
                            'clearLogs',
                            env.uuid,
                          );
                          plugin.logs.update((items) =>
                            items.filter(
                              (log) => log.environmentId !== env.uuid,
                            ),
                          );
                        })
                      }
                    />
                  ),
                },
                {
                  key: 'settings',
                  label: 'Settings',
                  children: (
                    <>
                      <div style={grid}>
                        <Field label="Environment name">
                          <Input
                            value={env.name}
                            onChange={(e) => changeEnv({name: e.target.value})}
                          />
                        </Field>
                        <Field label="Port">
                          <InputNumber
                            min={1}
                            max={65535}
                            value={env.port}
                            onChange={(value) =>
                              changeEnv({port: value || 3000})
                            }
                          />
                        </Field>
                        <Field
                          label="Listen address"
                          hint="127.0.0.1: this computer only. 0.0.0.0: also reachable over your network.">
                          <Input
                            value={env.hostname}
                            onChange={(e) =>
                              changeEnv({hostname: e.target.value})
                            }
                          />
                        </Field>
                        <Field label="URL prefix">
                          <Input
                            addonBefore="/"
                            value={env.endpointPrefix}
                            onChange={(e) =>
                              changeEnv({
                                endpointPrefix: e.target.value.replace(
                                  /^\//,
                                  '',
                                ),
                              })
                            }
                          />
                        </Field>
                        <Field label="Global delay (ms)">
                          <InputNumber
                            min={0}
                            value={env.latency}
                            onChange={(value) =>
                              changeEnv({latency: value || 0})
                            }
                          />
                        </Field>
                        <Field label="CORS">
                          <Switch
                            checked={env.cors}
                            onChange={(cors) => changeEnv({cors})}
                          />
                        </Field>
                      </div>
                      <Field
                        label="Working directory"
                        hint="Absolute directory used to resolve relative certificate paths, response files and file helpers. Set this to the original file's directory when importing an environment that uses relative paths.">
                        <Input
                          value={draft.directory}
                          onChange={(e) => change({directory: e.target.value})}
                        />
                      </Field>
                      {draft.source && (
                        <Alert
                          type="info"
                          message="Watching imported file"
                          description={
                            <>
                              {draft.source.path}
                              <br />
                              External changes update this environment and mark
                              a running server for reload. Editing here saves a
                              local copy; the original file is never
                              overwritten.
                              <br />
                              <Button
                                size="small"
                                style={{marginTop: 8}}
                                onClick={() => change({source: undefined})}>
                                Detach source file
                              </Button>
                            </>
                          }
                          style={{marginBottom: 16}}
                        />
                      )}
                      <Field label="Global response headers">
                        <Headers
                          value={env.headers}
                          onChange={(headers) => changeEnv({headers})}
                        />
                      </Field>
                      <Alert
                        type="info"
                        message="Connect an Android device over USB"
                        description={
                          <>
                            <div>
                              Run{' '}
                              <code>
                                adb reverse tcp:{env.port} tcp:{env.port}
                              </code>
                              , then point your app's development API URL to{' '}
                              <code>
                                {env.tlsOptions.enabled ? 'https' : 'http'}
                                ://localhost:{env.port}/{env.endpointPrefix}
                              </code>
                              .
                            </div>
                            <div>
                              Over Wi-Fi, bind to 0.0.0.0 and use your
                              computer's LAN IP. Your app must permit HTTP in
                              development or trust your HTTPS certificate.
                            </div>
                          </>
                        }
                        style={{marginTop: 12}}
                      />
                      <Typography.Paragraph
                        type="secondary"
                        style={{marginTop: 16}}>
                        Saved locally at {workspace.storagePath}. Servers start
                        only when you press Start.
                      </Typography.Paragraph>
                    </>
                  ),
                },
                {
                  key: 'tls',
                  label: 'TLS / HTTPS',
                  children: <TLS env={env} onChange={changeEnv} />,
                },
                {
                  key: 'proxy',
                  label: 'Proxy',
                  children: (
                    <>
                      <Field label="Proxy unhandled requests">
                        <Switch
                          checked={env.proxyMode}
                          onChange={(proxyMode) => changeEnv({proxyMode})}
                        />
                      </Field>
                      <Field label="Target backend URL">
                        <Input
                          value={env.proxyHost}
                          placeholder="https://api.example.com"
                          onChange={(e) =>
                            changeEnv({proxyHost: e.target.value})
                          }
                        />
                      </Field>
                      <Field label="Remove environment URL prefix">
                        <Switch
                          checked={env.proxyRemovePrefix}
                          onChange={(proxyRemovePrefix) =>
                            changeEnv({proxyRemovePrefix})
                          }
                        />
                      </Field>
                      <Field label="Headers sent to backend">
                        <Headers
                          value={env.proxyReqHeaders}
                          onChange={(proxyReqHeaders) =>
                            changeEnv({proxyReqHeaders})
                          }
                        />
                      </Field>
                      <Field label="Headers added to proxy responses">
                        <Headers
                          value={env.proxyResHeaders}
                          onChange={(proxyResHeaders) =>
                            changeEnv({proxyResHeaders})
                          }
                        />
                      </Field>
                    </>
                  ),
                },
                {
                  key: 'data',
                  label: `Data (${env.data.length})`,
                  children: (
                    <>
                      <Typography.Paragraph>
                        Mockoon data buckets support templating and stateful
                        CRUD routes. Use their ID in a response or the Mockoon
                        data helpers.
                      </Typography.Paragraph>
                      <Button
                        style={{marginBottom: 12}}
                        icon={<PlusOutlined />}
                        onClick={() => {
                          const item = clone(workspace.templates.data);
                          item.uuid = id();
                          item.id = `data-${env.data.length + 1}`;
                          changeEnv({data: [...env.data, item]});
                        }}>
                        Add data bucket
                      </Button>
                      <JsonEditor
                        label="Data buckets JSON"
                        value={env.data}
                        onApply={(data) => {
                          if (!Array.isArray(data))
                            throw new Error(
                              'Expected an array of data buckets.',
                            );
                          changeEnv({data});
                        }}
                      />
                    </>
                  ),
                },
                {
                  key: 'callbacks',
                  label: `Callbacks (${env.callbacks.length})`,
                  children: (
                    <>
                      <Typography.Paragraph>
                        Define outgoing callbacks here, then reference their
                        UUID in a response's Advanced / callbacks tab.
                      </Typography.Paragraph>
                      <Button
                        style={{marginBottom: 12}}
                        icon={<PlusOutlined />}
                        onClick={() => {
                          const item = clone(workspace.templates.callback);
                          item.uuid = id();
                          item.id = `callback-${env.callbacks.length + 1}`;
                          changeEnv({callbacks: [...env.callbacks, item]});
                        }}>
                        Add callback
                      </Button>
                      <JsonEditor
                        label="Callbacks JSON"
                        value={env.callbacks}
                        onApply={(callbacks) => {
                          if (!Array.isArray(callbacks))
                            throw new Error('Expected an array of callbacks.');
                          changeEnv({callbacks});
                        }}
                      />
                    </>
                  ),
                },
                {
                  key: 'advanced',
                  label: 'Advanced',
                  children: (
                    <>
                      <Typography.Paragraph>
                        Full Mockoon environment configuration, including
                        folders and route order. Apply edits to the draft, then
                        Save. Unknown future schemas are rejected instead of
                        silently discarding settings.
                      </Typography.Paragraph>
                      <JsonEditor
                        label="Environment JSON"
                        value={env}
                        onApply={(environment) => {
                          if (
                            !environment ||
                            !Array.isArray(environment.routes) ||
                            !environment.tlsOptions ||
                            !Array.isArray(environment.data) ||
                            !Array.isArray(environment.callbacks)
                          )
                            throw new Error(
                              'Expected a complete Mockoon environment object.',
                            );
                          change({
                            environment: {...environment, uuid: env.uuid},
                          });
                        }}
                      />
                      <Typography.Title level={5}>
                        Mockoon runtime options
                      </Typography.Title>
                      <Typography.Paragraph type="secondary">
                        Optional engine settings such as fakerOptions,
                        enableRandomLatency, publicBaseUrl and request-size
                        limits. Admin API is disabled by default.
                        environmentDirectory and disabledRoutes are managed by
                        this plugin; logs are limited to 500.
                      </Typography.Paragraph>
                      <JsonEditor
                        label="Runtime options JSON"
                        rows={7}
                        value={draft.options}
                        onApply={(options) => {
                          if (
                            !options ||
                            typeof options !== 'object' ||
                            Array.isArray(options)
                          )
                            throw new Error('Expected an options object.');
                          change({options});
                        }}
                      />
                      <Button
                        style={{marginTop: 16}}
                        disabled={dirty || busy}
                        onClick={() =>
                          action(async () =>
                            download(
                              await plugin.client.sendToServerAddOn('export', {
                                id: env.uuid,
                                format: 'openapi',
                              }),
                              'openapi.json',
                            ),
                          )
                        }>
                        Export saved environment as OpenAPI
                      </Button>
                    </>
                  ),
                },
              ]}
            />
          </>
        ) : (
          <Empty description="Create an environment or import a Mockoon / OpenAPI file to begin." />
        )}
      </main>
    </div>
  );
}
