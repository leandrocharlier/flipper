const path = require('node:path');
const {serverDirectory} = require('./platform.cjs');
const {collectNotices} = require('./third-party-notices.cjs');
const server = serverDirectory();
module.exports = {
  appId: 'io.github.leandrocharlier.flipper',
  productName: 'Flipper',
  asar: true,
  npmRebuild: false,
  beforePack: () => { collectNotices(server); },
  afterPack: './verify-package.cjs',
  directories: {output: '../../dist/electron'},
  files: ['main.cjs', 'server-process.cjs', 'platform.cjs', 'package.json'],
  extraResources: [
    {from: server, to: 'server'},
    {from: path.join(server, 'node_modules'), to: 'server/node_modules'},
    {from: '../../LICENSE', to: 'LICENSE'},
    {from: '../../NOTICE', to: 'NOTICE'},
    {from: 'node_modules/electron/dist/LICENSE', to: 'licenses/Electron-LICENSE'},
    {from: 'node_modules/electron/dist/LICENSES.chromium.html', to: 'licenses/LICENSES.chromium.html'},
    {from: '../themes/fonts/OFL.txt', to: 'licenses/JetBrainsMono-OFL.txt'},
  ],
  win: {icon: '../static/icon.ico', signExecutable: false},
  nsis: {oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true},
  mac: {icon: '../static/icon.icns', category: 'public.app-category.developer-tools', identity: '-', hardenedRuntime: false, target: ['dmg', 'zip']},
  linux: {executableName: 'flipper', icon: '../static/icon.png', category: 'Development', target: ['AppImage', 'tar.gz']},
  artifactName: 'Flipper-${version}-${os}-${arch}.${ext}',
};
