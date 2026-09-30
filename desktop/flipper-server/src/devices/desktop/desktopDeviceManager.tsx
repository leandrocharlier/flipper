/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import MacDevice from './MacDevice';
import WindowsDevice from './WindowsDevice';
import {FlipperServerImpl} from '../../FlipperServerImpl';
import {ServerDevice} from '../ServerDevice';

class LinuxDevice extends ServerDevice {}

export default (flipperServer: FlipperServerImpl) => {
  let device;
  if (process.platform === 'darwin') {
    device = new MacDevice(flipperServer);
  } else if (process.platform === 'win32') {
    device = new WindowsDevice(flipperServer);
  } else if (process.platform === 'linux') {
    device = new LinuxDevice(flipperServer, {
      serial: '',
      deviceType: 'physical',
      title: 'Linux',
      os: 'Linux',
      icon: 'server',
      features: {screenCaptureAvailable: false, screenshotAvailable: false},
    });
  } else {
    return;
  }
  flipperServer.registerDevice(device);
};
