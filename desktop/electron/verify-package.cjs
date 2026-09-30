// Validate resources before producing an installer, including dependencies that
// electron-builder otherwise excludes when copying a root node_modules folder.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

module.exports = async ({appOutDir}) => {
  const server = path.join(appOutDir, 'resources', 'server');
  for (const file of [
    'flipper-runtime.exe',
    'server.js',
    'node_modules/chalk/package.json',
    'node_modules/ws/package.json',
    'static/native-modules/keytar-win32-x64.node',
  ]) {
    if (!fs.existsSync(path.join(server, file))) {
      throw new Error(`Packaged Flipper resource is missing: ${file}`);
    }
  }
  execFileSync(
    path.join(server, 'flipper-runtime.exe'),
    [
      '-e',
      "for (const name of ['chalk', 'fs-extra', 'yargs', 'exit-hook', 'ws']) require(name)",
    ],
    {cwd: server, windowsHide: true, stdio: 'pipe'},
  );
};
