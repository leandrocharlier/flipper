const {execFileSync} = require('node:child_process');
const path = require('node:path');
const adb = path.join(
  process.env.LOCALAPPDATA,
  'Android/Sdk/platform-tools/adb.exe',
);

function tapSampleAction(index) {
  execFileSync(adb, [
    'shell',
    'uiautomator',
    'dump',
    '/sdcard/flipper-test-ui.xml',
  ]);
  const xml = execFileSync(
    adb,
    ['shell', 'cat', '/sdcard/flipper-test-ui.xml'],
    {encoding: 'utf8'},
  );
  const targets = (xml.match(/<node\b[^>]*>/g) || []).filter(
    (node) =>
      node.includes('package="com.facebook.flipper.sample"') &&
      node.includes('clickable="true"'),
  );
  // RootComponentSpec puts GET, POST, then Trigger notification first. Litho
  // renders their labels on a canvas but exposes their clickable bounds.
  const bounds = targets[index]?.match(
    /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
  );
  if (!bounds) throw new Error(`Sample action ${index} is not visible`);
  execFileSync(adb, [
    'shell',
    'input',
    'tap',
    String(Math.floor((+bounds[1] + +bounds[3]) / 2)),
    String(Math.floor((+bounds[2] + +bounds[4]) / 2)),
  ]);
}

module.exports = {tapSampleAction};
