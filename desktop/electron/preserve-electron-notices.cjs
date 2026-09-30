// Preserve notices before electron-builder renames the macOS app and removes
// the Electron distribution's top-level LICENSE files.
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({appOutDir, electronPlatformName}) => {
  let resources = path.join(appOutDir, 'resources');
  if (electronPlatformName === 'darwin') {
    const apps = fs.readdirSync(appOutDir).filter(name => name.endsWith('.app'));
    if (apps.length !== 1) throw new Error('Expected one extracted Electron app');
    resources = path.join(appOutDir, apps[0], 'Contents', 'Resources');
  }
  const destination = path.join(resources, 'licenses');
  fs.mkdirSync(destination, {recursive: true});
  for (const [name, candidates] of [
    ['Electron-LICENSE', ['LICENSE.electron.txt', 'LICENSE']],
    ['LICENSES.chromium.html', ['LICENSES.chromium.html']],
  ]) {
    const source = candidates.map(file => path.join(appOutDir, file)).find(file => fs.existsSync(file));
    if (!source) throw new Error(`Electron distribution is missing ${name}`);
    fs.copyFileSync(source, path.join(destination, name));
  }
};
