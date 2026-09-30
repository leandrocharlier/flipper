// Collect notices from the exact production tree being shipped, retaining text.
const fs = require('node:fs');
const path = require('node:path');

function collectNotices(server) {
  const packages = [];
  const visited = new Set();
  function scan(directory) {
    if (!fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory).sort()) {
      if (name.startsWith('.')) continue;
      const candidate = path.join(directory, name);
      if (!fs.statSync(candidate).isDirectory()) continue;
      if (name.startsWith('@')) { scan(candidate); continue; }
      const real = fs.realpathSync(candidate);
      if (visited.has(real)) continue;
      visited.add(real);
      const manifest = path.join(candidate, 'package.json');
      if (fs.existsSync(manifest)) {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        const notices = fs.readdirSync(candidate).filter(file => /^(licen[cs]e|copying|notice|copyright|authors)([._-]|$)/i.test(file) && fs.statSync(path.join(candidate, file)).isFile());
        packages.push({
          name: pkg.name, version: pkg.version,
          license: pkg.license || pkg.licenses || 'See package notices',
          notices: notices.map(file => ({file, text: fs.readFileSync(path.join(candidate, file), 'utf8')})),
          repository: pkg.repository?.url || pkg.repository || '',
        });
      }
      scan(path.join(candidate, 'node_modules'));
    }
  }
  scan(path.join(server, 'node_modules'));
  scan(path.join(server, 'static', 'defaultPlugins'));
  // Production dependencies bundled into the renderer/plugins are not present
  // in the backend's node_modules. Include their dependency closure as well.
  function dependencies(directory) {
    const real = fs.realpathSync(directory);
    const manifest = path.join(directory, 'package.json');
    if (!fs.existsSync(manifest) || visited.has(real)) return;
    visited.add(real);
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const names = fs.readdirSync(directory).filter(file => /^(licen[cs]e|copying|notice|copyright|authors)([._-]|$)/i.test(file) && fs.statSync(path.join(directory,file)).isFile());
    packages.push({name:pkg.name,version:pkg.version,license:pkg.license || pkg.licenses || 'See package notices',repository:pkg.repository?.url || pkg.repository || '',notices:names.map(file=>({file,text:fs.readFileSync(path.join(directory,file),'utf8')}))});
    for (const name of Object.keys(pkg.dependencies || {})) {
      let parent=directory;
      while (true) {
        const candidate=path.join(parent,'node_modules',name);
        if(fs.existsSync(path.join(candidate,'package.json'))) {dependencies(candidate);break;}
        const next=path.dirname(parent);if(next===parent)break;parent=next;
      }
    }
  }
  const desktop=path.resolve(__dirname,'..');
  dependencies(path.join(desktop,'flipper-ui'));
  dependencies(path.join(desktop,'flipper-plugin'));
  const shippedPlugins = new Set(fs.readdirSync(path.join(server, 'static', 'defaultPlugins')));
  for (const name of fs.readdirSync(path.join(desktop,'plugins/public'))) {
    const candidate=path.join(desktop,'plugins/public',name);
    const manifest = path.join(candidate, 'package.json');
    if(fs.existsSync(manifest) && shippedPlugins.has(JSON.parse(fs.readFileSync(manifest, 'utf8')).name)) dependencies(candidate);
  }
  const upstreamDirectory = path.join(desktop, 'licenses', 'upstream');
  const supplemental = JSON.parse(fs.readFileSync(path.join(upstreamDirectory, 'index.json'), 'utf8'));
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    const notice = supplemental[key] || (pkg.name.startsWith('esbuild-') && supplemental[`esbuild-windows-64@${pkg.version}`]);
    if (notice) pkg.notices.push({file: notice.file, text: `Source: ${notice.source}\n\n${fs.readFileSync(path.join(upstreamDirectory, notice.file), 'utf8')}`});
    if (!pkg.notices.length && pkg.name.startsWith('flipper-')) pkg.notices.push({file: 'Flipper-LICENSE', text: fs.readFileSync(path.join(desktop, '..', 'LICENSE'), 'utf8')});
    if (!pkg.notices.length) throw new Error(`Missing third-party notice: ${key}`);
  }
  packages.sort((a,b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const lines = ['Third-party notices for Flipper Community', 'Packages retain their original copyrights and licenses.\n'];
  for (const notice of JSON.parse(fs.readFileSync(path.join(upstreamDirectory, 'native.json'), 'utf8'))) {
    lines.push('='.repeat(80), notice.name, `Source: ${notice.source}`, fs.readFileSync(path.join(upstreamDirectory, notice.file), 'utf8'));
  }
  for (const pkg of packages) {
    lines.push('='.repeat(80), `${pkg.name}@${pkg.version}`, `License: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}`, `Source: ${pkg.repository}`);
    for (const notice of pkg.notices) lines.push(`--- ${notice.file} ---`, notice.text);
  }
  fs.writeFileSync(path.join(server, 'THIRD-PARTY-NOTICES.txt'), lines.join('\n\n'));
  fs.writeFileSync(path.join(server, 'THIRD-PARTY-INVENTORY.json'), JSON.stringify(packages.map(({notices, ...pkg}) => ({...pkg, noticeFiles: notices.map(n=>n.file)})), null, 2));
  return packages;
}
module.exports = {collectNotices};
