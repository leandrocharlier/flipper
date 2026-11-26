/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import 'core-js/stable/structured-clone';
import 'fake-indexeddb/auto';
import React from 'react';
import {fireEvent, render} from '@testing-library/react';
import {message} from 'antd';
import {TestUtils} from 'flipper-plugin';
import * as NetworkPlugin from '../index';
import RequestDetails from '../RequestDetails';
import {RequestWithData} from '../types';

afterEach(() => jest.restoreAllMocks());

test('copy icons pass the complete original request and response bodies', () => {
  const onCopyText = jest.fn();
  const requestData = '{"synthetic":"request"}';
  const responseData =
    '{\n  "synthetic": "respuesta ñ 🚀",\n  "value": 9007199254740993\n}';
  const request: RequestWithData = {
    id: 'synthetic-request',
    requestTime: new Date(0),
    method: 'POST',
    domain: 'example.test',
    url: 'https://example.test/clipboard',
    requestHeaders: [],
    responseHeaders: [],
    status: '200',
    requestData,
    responseData,
  };
  const view = render(
    <RequestDetails
      request={request}
      bodyFormat="raw"
      onSelectFormat={() => {}}
      onCopyText={onCopyText}
    />,
  );
  fireEvent.click(view.getByTitle('Copy request body'));
  expect(onCopyText).toHaveBeenLastCalledWith(requestData);
  fireEvent.click(view.getByTitle('Copy raw response body'));
  expect(onCopyText).toHaveBeenLastCalledWith(responseData);
});

test('copy reports success only after clipboard write resolves', async () => {
  const success = jest.spyOn(message, 'success').mockImplementation(jest.fn());
  const {instance, flipperLib} = TestUtils.startPlugin(NetworkPlugin);
  let finish!: () => void;
  const write = jest.spyOn(flipperLib, 'writeTextToClipboard').mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const copying = instance.onCopyText('synthetic response');
  expect(write).toHaveBeenCalledWith('synthetic response');
  expect(success).not.toHaveBeenCalled();
  finish();
  await copying;
  expect(success).toHaveBeenCalledTimes(1);
});

test('a denied clipboard write reports failure without claiming success', async () => {
  const success = jest.spyOn(message, 'success').mockImplementation(jest.fn());
  const failure = jest.spyOn(message, 'error').mockImplementation(jest.fn());
  const {instance, flipperLib} = TestUtils.startPlugin(NetworkPlugin);
  jest
    .spyOn(flipperLib, 'writeTextToClipboard')
    .mockRejectedValue(
      new DOMException('Write permission denied', 'NotAllowedError'),
    );
  await instance.onCopyText('synthetic response');
  expect(success).not.toHaveBeenCalled();
  expect(failure).toHaveBeenCalledWith(
    'Could not copy text to clipboard. Please try again.',
  );
});
