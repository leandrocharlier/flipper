const {test} = require('node:test');
const assert = require('node:assert/strict');
const {configurePermissions} = require('../permissions.cjs');

test('only the Flipper main frame can write, never read, the clipboard', () => {
  let check, request;
  const contents = {
    isDestroyed: () => false,
    getURL: () => 'http://localhost:52342/',
    session: {
      setPermissionCheckHandler: (handler) => {
        check = handler;
      },
      setPermissionRequestHandler: (handler) => {
        request = handler;
      },
    },
  };
  configurePermissions({webContents: contents}, 'http://localhost:52342');
  const details = {isMainFrame: true, requestingUrl: 'http://localhost:52342/'};
  function granted(sender, permission, url, frame) {
    const checked = check(sender, permission, url, frame);
    let requested;
    request(
      sender,
      permission,
      (value) => {
        requested = value;
      },
      {...frame, requestingUrl: url},
    );
    assert.equal(checked, requested);
    return checked;
  }
  assert.equal(
    granted(
      contents,
      'clipboard-sanitized-write',
      details.requestingUrl,
      details,
    ),
    true,
  );
  for (const permission of [
    'clipboard-read',
    'clipboard-read-write',
    'media',
    'notifications',
    'fileSystem',
  ])
    assert.equal(
      granted(contents, permission, details.requestingUrl, details),
      false,
    );
  for (const url of [
    'https://example.test',
    'http://localhost:52343',
    'http://localhost:52342.example.test',
    'null',
  ])
    assert.equal(
      granted(contents, 'clipboard-sanitized-write', url, details),
      false,
    );
  assert.equal(
    granted(contents, 'clipboard-sanitized-write', details.requestingUrl, {
      isMainFrame: false,
    }),
    false,
  );
  assert.equal(
    granted(null, 'clipboard-sanitized-write', details.requestingUrl, details),
    false,
  );
  assert.equal(
    granted({}, 'clipboard-sanitized-write', details.requestingUrl, details),
    false,
  );
  contents.getURL = () => 'https://example.test';
  assert.equal(
    granted(
      contents,
      'clipboard-sanitized-write',
      details.requestingUrl,
      details,
    ),
    false,
  );
});
