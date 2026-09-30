/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {EventEmitter} from 'events';
import {Client} from 'fb-watchman';
import Watchman from '../watchman';

jest.mock('fb-watchman', () => ({Client: jest.fn()}));

test('a missing Watchman does not crash later when its timeout expires', async () => {
  jest.useFakeTimers();
  const client = Object.assign(new EventEmitter(), {
    capabilityCheck: jest.fn(),
    end: jest.fn(),
    command: jest.fn(),
  });
  (Client as unknown as jest.Mock).mockReturnValue(client);
  try {
    const watchman = new Watchman('test-root');
    const initialization = watchman.initialize();
    const failure = expect(initialization).rejects.toThrow('Watchman missing');
    client.emit('error', new Error('Watchman missing'));
    await failure;
    expect(() => jest.advanceTimersByTime(61000)).not.toThrow();
    // A late capability callback must not use the disposed client either.
    client.capabilityCheck.mock.calls[0][1](null);
    expect(client.command).not.toHaveBeenCalled();
    expect(client.end).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
