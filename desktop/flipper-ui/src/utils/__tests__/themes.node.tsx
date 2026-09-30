/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {loadTheme} from '../loadTheme';
import {shouldUseDarkMode} from '../useIsDarkMode';

test('both dark palettes load independently and are reported as dark to plugins', () => {
  const link = document.createElement('link');
  link.id = 'flipper-theme-import';
  document.head.appendChild(link);
  try {
    for (const choice of ['dark', 'island-dark', 'light'] as const) {
      loadTheme(choice);
      expect(link.getAttribute('href')).toBe(`themes/${choice}.css`);
      expect(shouldUseDarkMode(choice)).toBe(choice !== 'light');
    }
  } finally {
    link.remove();
  }
});

test('system theme checks the media query result, not the media query object', () => {
  const previousConfig = window.flipperConfig;
  const previousMatchMedia = window.matchMedia;
  try {
    window.flipperConfig = {...previousConfig, theme: 'system'};
    window.matchMedia = jest.fn().mockReturnValue({matches: false});
    expect(shouldUseDarkMode('system')).toBe(false);
    window.matchMedia = jest.fn().mockReturnValue({matches: true});
    expect(shouldUseDarkMode('system')).toBe(true);
  } finally {
    window.flipperConfig = previousConfig;
    window.matchMedia = previousMatchMedia;
  }
});
