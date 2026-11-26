// Copyright (c) Meta Platforms, Inc. and affiliates. MIT license.
function configurePermissions(window, origin) {
  const contents = window.webContents;
  function isTrusted(url) {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  }
  function allow(requester, permission, url, details) {
    return (
      requester === contents &&
      !contents.isDestroyed() &&
      permission === 'clipboard-sanitized-write' &&
      details?.isMainFrame === true &&
      isTrusted(url) &&
      isTrusted(contents.getURL())
    );
  }
  contents.session.setPermissionCheckHandler(
    (requester, permission, requestingOrigin, details) =>
      allow(requester, permission, requestingOrigin, details),
  );
  contents.session.setPermissionRequestHandler(
    (requester, permission, callback, details) =>
      callback(allow(requester, permission, details.requestingUrl, details)),
  );
}
module.exports = {configurePermissions};
