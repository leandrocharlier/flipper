// Validate resources before producing an installer, including dependencies that
// electron-builder otherwise excludes when copying a root node_modules folder.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

module.exports = async ({appOutDir, electronPlatformName, packager}) => {
  const resources = electronPlatformName === 'darwin'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  const server = path.join(resources, 'server');
  fs.mkdirSync(path.join(resources, 'licenses'), {recursive: true});
  // Take notices from the Electron distribution actually unpacked by the
  // packager. npm may skip Electron's optional binary download on CI.
  for (const [destination, candidates] of [
    ['Electron-LICENSE', ['LICENSE.electron.txt', 'LICENSE']],
    ['LICENSES.chromium.html', ['LICENSES.chromium.html']],
  ]) {
    const source = candidates.map(name=>path.join(appOutDir,name)).find(file=>fs.existsSync(file));
    if (!source) throw new Error(`Electron distribution is missing ${destination}`);
    fs.copyFileSync(source,path.join(resources,'licenses',destination));
  }
  const runtime = process.platform === 'win32' ? 'flipper-runtime.exe' : 'flipper-runtime';
  for (const file of [
    runtime,
    'server.js',
    'node_modules/chalk/package.json',
    'node_modules/ws/package.json',
    `static/native-modules/keytar-${process.platform}-${process.arch}.node`,
    'NODE-LICENSE',
    'THIRD-PARTY-NOTICES.txt',
  ]) {
    if (!fs.existsSync(path.join(server, file))) {
      throw new Error(`Packaged Flipper resource is missing: ${file}`);
    }
  }
  execFileSync(
    path.join(server, runtime),
    [
      '-e',
      "for (const name of ['chalk', 'fs-extra', 'yargs', 'exit-hook', 'ws']) require(name)",
    ],
    {cwd: server, windowsHide: true, stdio: 'pipe'},
  );
  for (const file of ['LICENSE', 'NOTICE', 'licenses/Electron-LICENSE', 'licenses/LICENSES.chromium.html', 'licenses/JetBrainsMono-OFL.txt']) {
    if (!fs.existsSync(path.join(resources, file))) throw new Error(`Missing license notice: ${file}`);
  }
};
