// Copyright (c) Meta Platforms, Inc. and affiliates. MIT license.
// Run with Electron after building the Windows server and starting an Android
// emulator. FLIPPER_LEAVE_OPEN=1 keeps the tested window open for manual testing.
const {app, clipboard} = require('electron');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {launch} = require('../main.cjs');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'work', 'logs-electron');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
fs.mkdirSync(output, {recursive: true});
app.setPath('userData', path.join(output, 'profile'));
app.setAppLogsPath(path.join(output, 'logs'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let desktop;
const result = {};
const run = code => desktop.window.webContents.executeJavaScript(code);
async function waitFor(code, message) {
  for (let i = 0; i < 60; i++) {
    if (await run(code)) return;
    await delay(500);
  }
  fs.writeFileSync(path.join(output, 'failed-ui.txt'), await run('document.body.innerText'));
  fs.writeFileSync(path.join(output, 'failed.png'), (await desktop.window.webContents.capturePage()).toPNG());
  throw new Error(message);
}
async function input(label, value) {
  await run(`(() => {
    const input = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
    if (!input) throw new Error('Missing input');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  await delay(250);
}
async function click(text) {
  await run(`Array.from(document.querySelectorAll('button')).find(button => button.getClientRects().length > 0 && (button.getAttribute('aria-label') === ${JSON.stringify(text)} || button.textContent.trim() === ${JSON.stringify(text)}))?.click()`);
  await delay(400);
}
function log(message, level = 'e') {
  // Only test-owned fixed text is passed to Android's shell.
  execFileSync(adb, ['shell', `log -p ${level} -t FlipperTextPreview '${message.replace(/'/g, "'\\''")}'`], {windowsHide: true});
}
const viewer = `document.querySelector('[aria-label="Logcat text"]')`;
(async () => {
  desktop = await launch({show: true, onFailure: error => {throw error;}});
  assert.ok(desktop);
  if (process.env.FLIPPER_PACKAGE_E2E === '1') {
    execFileSync(adb, ['shell', 'am', 'start', '-W', '-n', 'com.facebook.flipper.sample/.MainActivity'], {windowsHide: true});
  }
  await waitFor(`(() => {
    Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Skip Setup Wizard'))?.click();
    const label = Array.from(document.querySelectorAll('.ant-menu-item .ant-typography')).find(item => item.textContent === 'Logs');
    const item = label?.closest('.ant-menu-item');
    if (!label) {
      const android = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) .anticon-android');
      if (android) android.closest('.ant-dropdown-menu-item, .ant-menu-item')?.click();
      else if (!document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden)')) document.querySelector('[title="Select the device / app to inspect"]')?.click();
    }
    if (!label) Array.from(document.querySelectorAll('.ant-menu-submenu-title')).find(item => item.textContent.includes('Disabled') && item.getAttribute('aria-expanded') === 'false')?.click();
    label?.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
    item?.querySelector('button[title="Enable plugin"]')?.click();
    item?.click();
    label?.dispatchEvent(new MouseEvent('mouseout', {bubbles: true}));
    return !!${viewer};
  })()`, 'Logs viewer did not open');
  if (process.env.FLIPPER_PACKAGE_E2E === '1') {
    await waitFor(`document.querySelector('input[aria-label="Filter logs"]').value.includes('package:mine') && document.body.innerText.includes('com.facebook.flipper.sample')`, 'Selected app did not supply its package ID');
    result.autoSelectedPackage = true;
  }
  await input('Filter logs', 'tag:FlipperTextPreview');
  assert.equal(await run(`document.querySelector('button[aria-label="Reload logs"]').nextElementSibling.getAttribute('aria-label')`), 'Soft wrap');
  await run(`document.querySelector('button[aria-label="Clear logs"]').click()`);
  await delay(500);
  const multiline = 'Logcat text preview: first event\n    at com.example.Client.send(Client.kt:42)\nCaused by: test failure';
  log(multiline);
  log('Second event: select across these lines', 'w');
  await waitFor(`${viewer}.children.length === 2`, 'Live Android logs did not arrive');
  const text = await run(`${viewer}.textContent`);
  assert.ok(text.includes(multiline), 'Stack trace retains its newlines');
  result.liveMultiline = true;
  const colors = await run(`Array.from(${viewer}.children).map(node => getComputedStyle(node.lastElementChild).color)`);
  assert.notEqual(colors[0], colors[1], 'Error and warning colors differ');
  result.severityColors = true;

  const selected = await run(`(() => {
    const view = ${viewer};
    view.focus();
    view.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    const first = view.children[0].lastChild.firstChild;
    const second = view.children[1].lastChild.firstChild;
    const range = document.createRange();
    range.setStart(first, first.textContent.indexOf('Logcat text preview'));
    range.setEnd(second, second.textContent.indexOf('Second event') + 'Second event'.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  })()`);
  assert.ok(selected.includes('Client.kt:42') && selected.endsWith('Second event'));
  log('Third event while reading');
  await delay(500);
  assert.equal(await run('window.getSelection().toString()'), selected, 'Selection survives incoming logs');
  assert.equal(await run(`${viewer}.children.length`), 2);
  desktop.window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'C', modifiers: ['control']});
  desktop.window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'C', modifiers: ['control']});
  await delay(300);
  assert.equal((await clipboard.readText()).replace(/\r\n/g, '\n'), selected, 'Native Ctrl+C copies the selected characters');
  result.nativeSelectionAndCopy = true;
  await click('Go to bottom');
  await waitFor(`${viewer}.textContent.includes('Third event')`, 'Follow did not resume');
  result.followResumes = true;

  await input('Filter logs', 'tag:FlipperTextPreview message:"Client.kt:42"');
  assert.equal(await run(`${viewer}.children.length`), 1);
  await input('Filter logs', 'tag:FlipperTextPreview pid:999999999');
  assert.equal(await run(`${viewer}.children.length`), 0);
  await input('Filter logs', 'tag:FlipperTextPreview');
  assert.equal(await run(`${viewer}.children.length`), 3);
  result.filters = true;
  assert.equal(await run(`getComputedStyle(${viewer}).whiteSpace`), 'pre');
  await click('Soft wrap');
  assert.equal(await run(`getComputedStyle(${viewer}).whiteSpace`), 'pre-wrap');
  await click('Soft wrap');
  result.wrap = true;

  await run(`document.querySelector('button[aria-label="Pause capture"]').click()`);
  log('Not captured while paused');
  await delay(300);
  assert.equal(await run(`${viewer}.children.length`), 3);
  await click('Reload logs');
  await waitFor(`!!document.querySelector('button[aria-label="Pause capture"]')`, 'Reload did not resume capture');
  result.reloadCapture = true;
  log('Capture resumed successfully', 'i');
  await waitFor(`${viewer}.textContent.includes('Capture resumed successfully')`, 'Capture did not resume');
  result.pauseAndResume = true;
  // Android's shell `log` command caps messages at 1,024 bytes. This still
  // exceeds the old viewer's 400-character truncation; Jest also covers 5 KB.
  const long = 'Full message: ' + '0123456789'.repeat(80) + ' END';
  log(long);
  log(long);
  await waitFor(`${viewer}.textContent.includes(' END') && ${viewer}.children.length === 6`, 'Repeated or long messages lost');
  assert.equal(await run(`${viewer}.textContent.split(${JSON.stringify(long)}).length - 1`), 2);
  result.fullAndRepeatedMessages = true;
  log('Severity review DEBUG', 'd');
  log('Severity review INFO', 'i');
  log('Severity review VERBOSE', 'v');
  await click('Go to bottom');
  await waitFor(`${viewer}.children.length === 9`, 'Severity test events missing');
  await input('Filter logs', 'tag:FlipperTextPreview level:debug -level:info');
  await waitFor(`${viewer}.children.length === 1 && ${viewer}.textContent.includes('Severity review DEBUG')`, 'Exact DEBUG filter failed');
  await input('Filter logs', 'tag:FlipperTextPreview level:debug');
  await waitFor(`${viewer}.children.length === 8 && !${viewer}.textContent.includes('Severity review VERBOSE')`, 'Minimum DEBUG filter failed');
  await input('Filter logs', 'tag:FlipperTextPreview level:info');
  await waitFor(`${viewer}.children.length === 7 && !${viewer}.textContent.includes('Severity review DEBUG')`, 'INFO filter failed to remove DEBUG');
  await input('Filter logs', 'tag: level:warn');
  assert.ok(await run(`document.getElementById('log-query-help').textContent.includes('Choose a value for tag:')`));
  assert.equal(await run(`${viewer}.children.length`), 7, 'Invalid expression retains the last valid filter');
  await input('Filter logs', 'tag:FlipperTextPreview');
  await waitFor(`${viewer}.children.length === 9`, 'Removing level filter did not restore all events');
  result.severityFilters = true;
  // Leave a clean, readable preview with real ADB events for manual testing.
  await run(`document.querySelector('button[aria-label="Clear logs"]').click()`);
  await delay(300);
  assert.equal(await run(`${viewer}.textContent`), '');
  result.clear = true;
  log('Flipper Logs: free text selection is ready. Drag across lines and press Ctrl+C.', 'i');
  log('Warning example: select a fragment of this message.', 'w');
  log(multiline);
  await waitFor(`${viewer}.children.length === 3`, 'Preview logs missing');
  await input('Filter logs', 'tag:');
  await run(`(() => {const input = document.querySelector('input[aria-label="Filter logs"]'); input.focus(); input.setSelectionRange(4,4); input.dispatchEvent(new KeyboardEvent('keydown', {key:' ',code:'Space',ctrlKey:true,bubbles:true}));})()`);
  await waitFor(`Array.from(document.querySelectorAll('.ant-select-item-option code')).some(item => item.textContent === 'tag:FlipperTextPreview')`, 'Tag suggestion missing');
  fs.writeFileSync(path.join(output, 'suggestions.png'), (await desktop.window.webContents.capturePage()).toPNG());
  await run(`Array.from(document.querySelectorAll('.ant-select-item-option code')).find(item => item.textContent === 'tag:FlipperTextPreview').click()`);
  await waitFor(`document.querySelector('input[aria-label="Filter logs"]').value === 'tag:FlipperTextPreview'`, 'Autocomplete did not insert the tag');
  result.querySuggestions = true;
  await click('Logcat Format');
  await waitFor(`!!document.querySelector('[aria-label="Logcat format preview"]')`, 'Format dialog missing');
  fs.writeFileSync(path.join(output, 'format.png'), (await desktop.window.webContents.capturePage()).toPNG());
  await run(`Array.from(document.querySelectorAll('.ant-modal label')).find(label => label.textContent === 'Show timestamp')?.click()`);
  await click('Apply');
  assert.ok(!(await run(`${viewer}.textContent`)).includes(new Date().getFullYear() + '-'), 'Hidden timestamp is removed from real text');
  await click('Restore defaults');
  await click('OK');
  assert.ok((await run(`${viewer}.textContent`)).includes(new Date().getFullYear() + '-'), 'Default format restored');
  result.formatDialog = true;
  if (process.env.FLIPPER_PACKAGE_E2E === '1') {
    await input('Filter logs', 'package:mine level:debug');
    await run(`document.querySelector('input[aria-label="Filter logs"]').blur()`);
    await waitFor(`document.body.innerText.includes('com.facebook.flipper.sample')`, 'Auto package did not resume');
    const oldPid = execFileSync(adb, ['shell', 'pidof', 'com.facebook.flipper.sample'], {encoding: 'utf8'}).trim();
    execFileSync(adb, ['shell', 'am', 'force-stop', 'com.facebook.flipper.sample'], {windowsHide: true});
    execFileSync(adb, ['shell', 'am', 'start', '-W', '-n', 'com.facebook.flipper.sample/.MainActivity'], {windowsHide: true});
    const newPid = execFileSync(adb, ['shell', 'pidof', 'com.facebook.flipper.sample'], {encoding: 'utf8'}).trim();
    assert.ok(newPid && newPid !== oldPid, 'Android assigned a new PID');
    await waitFor(`document.body.innerText.includes('PID: ${newPid}') && ${viewer}?.textContent.includes('${newPid}-')`, 'Package filter did not follow the restarted app');
    const packages = await run(`Array.from(${viewer}.children).map(row => row.children[3].textContent.trim())`);
    assert.ok(packages.length > 0 && packages.every(name => name === 'com.facebook.flipper.sample'), 'Only selected package logs are visible');
    result.packageRestart = {oldPid, newPid};
    result.packageColumn = true;
    await delay(3500);
    await click('Logcat Format');
    fs.writeFileSync(path.join(output, 'format.png'), (await desktop.window.webContents.capturePage()).toPNG());
    await click('Cancel');
  }
  if (process.env.FLIPPER_THEME_E2E === '1') {
    async function openSettings() {
      await run(`(() => { document.activeElement?.blur(); const more = Array.from(document.querySelectorAll('.ant-menu-submenu-title')).find(item => item.textContent.trim() === 'More'); more?.dispatchEvent(new MouseEvent('mouseover', {bubbles:true})); })()`);
      await waitFor(`Array.from(document.querySelectorAll('[role="menuitem"]')).some(item => item.textContent.trim() === 'Settings')`, 'Settings menu missing');
      await run(`Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.trim() === 'Settings').click()`);
      await run(`Array.from(document.querySelectorAll('.ant-menu-submenu-title')).find(item => item.textContent.trim() === 'More')?.dispatchEvent(new MouseEvent('mouseout', {bubbles:true,relatedTarget:document.body}))`);
      await waitFor(`!!document.querySelector('input[value="island-dark"]')`, 'Island Dark option missing');
    }
    async function chooseTheme(value) {
      await run(`document.querySelector('input[value="${value}"]').click()`);
      await waitFor(`document.getElementById('flipper-theme-import').getAttribute('href') === 'themes/${value}.css' && getComputedStyle(document.documentElement).getPropertyValue('--flipper-background-default').trim().toLowerCase() === '${value === 'island-dark' ? '#191a1c' : '#000'}'`, 'Theme palette did not load');
    }
    await openSettings();
    await chooseTheme('dark');
    await click('Apply');
    // Apply is disabled if the original preference was already Flipper Dark.
    if (await run(`!!document.querySelector('.ant-modal input[value="dark"]')`)) await click('Cancel');
    await openSettings();
    await chooseTheme('island-dark');
    await click('Cancel');
    await waitFor(`document.getElementById('flipper-theme-import').getAttribute('href') === 'themes/dark.css'`, 'Cancel did not restore Flipper Dark');
    result.themeCancelRestores = true;
    await openSettings();
    await chooseTheme('island-dark');
    fs.writeFileSync(path.join(output, 'themes.png'), (await desktop.window.webContents.capturePage()).toPNG());
    await click('Apply');
    desktop.window.webContents.reload();
    await delay(1500);
    await waitFor(`document.getElementById('flipper-theme-import')?.getAttribute('href') === 'themes/island-dark.css' && getComputedStyle(document.documentElement).getPropertyValue('--flipper-background-default').trim().toLowerCase() === '#191a1c'`, 'Saved Island Dark theme did not survive reload');
    await waitFor(`(() => {Array.from(document.querySelectorAll('.ant-menu-item')).find(item => item.textContent.trim() === 'Logs')?.click(); return !!${viewer};})()`, 'Logs did not reopen after window reload');
    result.themePersistence = true;
    await click('Logcat Format');
    await waitFor(`!!document.querySelector('[aria-label="Logcat format preview"]')`, 'Logcat color preview missing');
    const logcatPalette = await run(`Array.from(document.querySelector('[aria-label="Logcat format preview"]').children).map(row => ({message:getComputedStyle(row.lastElementChild).color, badge:getComputedStyle(row.children[row.children.length - 2]).backgroundColor}))`);
    assert.deepEqual(logcatPalette, [
      {message:'rgb(41, 153, 153)',badge:'rgb(48, 93, 120)'},
      {message:'rgb(171, 192, 35)',badge:'rgb(106, 135, 89)'},
      {message:'rgb(187, 181, 41)',badge:'rgb(187, 181, 41)'},
      {message:'rgb(255, 107, 104)',badge:'rgb(207, 91, 86)'},
    ], 'Android Studio Logcat message and level colors');
    fs.writeFileSync(path.join(output, 'format.png'), (await desktop.window.webContents.capturePage()).toPNG());
    await click('Cancel');
    result.logcatPalette = true;
    await input('Filter logs', 'package:mine level:debug -level:info');
    await run(`document.querySelector('input[aria-label="Filter logs"]').blur()`);
    await run(`document.fonts.load('13px "Flipper JetBrains Mono"').then(() => true)`);
    assert.ok(await run(`document.fonts.check('13px "Flipper JetBrains Mono"') && getComputedStyle(${viewer}).fontFamily.includes('Flipper JetBrains Mono')`), 'Bundled Logcat font not loaded');
    assert.equal(await run(`getComputedStyle(${viewer}, '::selection').backgroundColor`), 'rgb(33, 66, 131)', 'Island Dark selection is blue');
    result.logcatTypography = true;
    execFileSync(adb, ['shell', 'am', 'force-stop', 'com.facebook.flipper.sample'], {windowsHide: true});
    execFileSync(adb, ['shell', 'am', 'start', '-W', '-n', 'com.facebook.flipper.sample/.MainActivity'], {windowsHide: true});
    await input('Filter logs', 'package:mine level:debug');
    await run(`document.querySelector('input[aria-label="Filter logs"]').blur()`);
    await waitFor(`${viewer}.children.length >= 10`, 'Need app logs to preview selection');
    await run(`${viewer}.focus(); ${viewer}.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))`);
    await delay(200);
    await run(`(() => {
      const view = ${viewer}; view.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
      const range = document.createRange(); range.setStart(view.children[0], 0); range.setEndAfter(view.children[1]);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      view.parentElement.scrollTop = 0;
    })()`);
    await delay(100);
    assert.ok(await run('window.getSelection().toString().length > 0'), 'Text selection was lost');
    fs.writeFileSync(path.join(output, 'selection.png'), (await desktop.window.webContents.capturePage()).toPNG());
    await run('window.getSelection().removeAllRanges()');
    await input('Filter logs', 'package:mine level:debug -level:info');
    await run(`document.querySelector('input[aria-label="Filter logs"]').blur()`);
  }
  fs.writeFileSync(path.join(output, 'desktop.png'), (await desktop.window.webContents.capturePage()).toPNG());
  result.processId = process.pid;
  result.passed = true;
  desktop.window.show();
  desktop.window.focus();
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.FLIPPER_LEAVE_OPEN !== '1') desktop.window.close();
})().catch(error => {
  result.error = error.stack;
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.error(error);
  if (process.env.FLIPPER_LEAVE_OPEN !== '1') {
    app.once('will-quit', () => app.exit(1));
    app.quit();
  }
});
