/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {FlipperServerImpl} from '../FlipperServerImpl';
import {initializeAdbClient} from '../devices/android/adbClient';
import {IOSDeviceManager} from '../devices/ios/iOSDeviceManager';

jest.mock('../devices/android/adbClient');
jest.mock('../devices/ios/iOSDeviceManager');
jest.mock('../devices/metro/metroDeviceManager', () => jest.fn());

test.each(['android', 'ios'])(
  'host device is available while %s discovery is still pending',
  async (platform) => {
    let finishDiscovery!: () => void;
    const discovery = new Promise<void>((resolve) => {
      finishDiscovery = resolve;
    });
    jest.mocked(initializeAdbClient).mockImplementation(async () => {
      await discovery;
      return undefined;
    });
    jest
      .mocked(IOSDeviceManager.prototype.watchIOSDevices)
      .mockReturnValue(discovery);
    const registerDevice = jest.fn();
    const server = {
      config: {
        settings: {
          enableAndroid: platform === 'android',
          enableIOS: platform === 'ios',
        },
      },
      disposers: [],
      registerDevice,
    } as unknown as FlipperServerImpl;

    const startup =
      FlipperServerImpl.prototype.startDeviceListeners.call(server);
    try {
      // No discovery promise has resolved: desktop-only plugins must work now.
      expect(registerDevice).toHaveBeenCalledTimes(1);
      expect(registerDevice.mock.calls[0][0].info.os).toBe(
        process.platform === 'darwin'
          ? 'MacOS'
          : process.platform === 'win32'
            ? 'Windows'
            : 'Linux',
      );
    } finally {
      finishDiscovery();
      await startup;
    }
    expect(registerDevice).toHaveBeenCalledTimes(1);
  },
);
