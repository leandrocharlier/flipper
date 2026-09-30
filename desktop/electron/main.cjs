// Copyright (c) Meta Platforms, Inc. and affiliates. MIT license.
const {app, BrowserWindow, Menu, dialog, shell} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {ServerProcess} = require('./server-process.cjs');
const {serverDirectory} = require('./platform.cjs');
const desktopVersion = require('./package.json').version;

const ORIGIN = 'http://localhost:52342';
function isInternal(url) {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}
function isExternalLink(url) {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function createDesktop({
  show = true,
  onFailure = (error) => dialog.showErrorBox('Flipper', error.message),
} = {}) {
  const directory = app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : serverDirectory();
  const logFile = path.join(app.getPath('logs'), 'flipper-server.log');
  const stateFile = path.join(app.getPath('userData'), 'window.json');
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {}
  const window = new BrowserWindow({
    title: `Flipper Community ${desktopVersion}`,
    width: Math.max(900, Math.min(2200, previous.width || 1400)),
    height: Math.max(600, Math.min(1400, previous.height || 900)),
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    icon: path.join(directory, 'static', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  const session = window.webContents.session;
  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle(`Flipper Community ${desktopVersion}`);
  });
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.setWindowOpenHandler(({url}) => {
    if (isExternalLink(url) && !isInternal(url))
      shell.openExternal(url).catch(onFailure);
    return {action: 'deny'};
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      if (isExternalLink(url)) shell.openExternal(url).catch(onFailure);
    }
  });
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  );
  // Browser downloads, including blob-based plugin exports, use a native Save dialog.
  session.on('will-download', (_event, item) =>
    item.setSaveDialogOptions({title: 'Save Flipper export'}),
  );
  window.on('close', () => {
    try {
      fs.mkdirSync(path.dirname(stateFile), {recursive: true});
      fs.writeFileSync(stateFile, JSON.stringify(window.getNormalBounds()));
    } catch {}
  });
  const server = new ServerProcess({
    directory,
    logFile,
    onUnexpectedExit: (error) => {
      onFailure(error);
      app.quit();
    },
  });
  try {
    await server.start();
    if (window.isDestroyed())
      throw new Error('Flipper window was closed during startup.');
    await window.loadURL(ORIGIN);
    if (show) window.show();
  } catch (error) {
    await server.stop();
    window.destroy();
    throw error;
  }
  return {window, server, logFile};
}

function launch(options = {}) {
  app.setName('Flipper');
  app.setAppUserModelId('io.github.leandrocharlier.flipper');
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  let desktop;
  let quitting = false;
  let startup;
  app.on('second-instance', () => {
    if (desktop?.window && !desktop.window.isDestroyed()) {
      if (desktop.window.isMinimized()) desktop.window.restore();
      desktop.window.show();
      desktop.window.focus();
    }
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    Promise.resolve(startup)
      .then(() => desktop?.server.stop())
      .finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
  return app.whenReady().then(() => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {label: 'File', submenu: [{role: 'quit'}]},
        {
          label: 'Edit',
          submenu: [
            {role: 'undo'},
            {role: 'redo'},
            {type: 'separator'},
            {role: 'cut'},
            {role: 'copy'},
            {role: 'paste'},
            {role: 'selectAll'},
          ],
        },
        {
          label: 'View',
          submenu: [
            {role: 'reload'},
            {role: 'resetZoom'},
            {role: 'zoomIn'},
            {role: 'zoomOut'},
            {role: 'togglefullscreen'},
            {role: 'toggleDevTools'},
          ],
        },
        {
          label: 'Help',
          submenu: [
            {
              label: 'About Flipper Community',
              click: () => dialog.showMessageBox(desktop.window, {
                type: 'info',
                title: 'About Flipper Community',
                message: `Flipper Community ${desktopVersion}`,
                detail: 'Maintained by Leandro Charlier. Based on Meta Flipper 0.273.0.\nAn independent community fork, not an official Meta release.\nMIT license; third-party notices are included in the application resources.',
              }),
            },
            {
              label: 'Open logs folder',
              click: () => shell.openPath(app.getPath('logs')),
            },
          ],
        },
      ]),
    );
    startup = createDesktop(options)
      .then((result) => {
        desktop = result;
        return result;
      })
      .catch((error) => {
        dialog.showErrorBox(
          'Unable to start Flipper',
          `${error.message}\n\nClose any other Flipper server and check that Android SDK and OpenSSL are installed.`,
        );
        app.quit();
      });
    return startup;
  });
}

if (require.main === module) launch();
module.exports = {launch, createDesktop, isInternal, isExternalLink};
