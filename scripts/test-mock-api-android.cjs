// Requires the debug sample installed and the two local demo mocks running.
// Reads only the sample's generated response dialogs; no user captures.
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const adb = process.env.ADB || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe')
  : 'adb');
const command = (...args) => execFileSync(adb,args,{encoding:'utf8'});
function nodes() {
  command('shell','uiautomator','dump','/sdcard/mock-api-sample-test.xml');
  return command('shell','cat','/sdcard/mock-api-sample-test.xml').match(/<node\b[^>]*>/g) || [];
}
function tap(node) {
  assert.ok(node,'Sample control was not found');
  const bounds=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert.ok(bounds);
  command('shell','input','tap',String(Math.floor((+bounds[1]+ +bounds[3])/2)),String(Math.floor((+bounds[2]+ +bounds[4])/2)));
}
(async()=>{
  command('reverse','tcp:3000','tcp:3000');
  command('reverse','tcp:3001','tcp:3001');
  command('shell','am','force-stop','com.facebook.flipper.sample');
  command('shell','am','start','-W','-n','com.facebook.flipper.sample/.MainActivity');
  for(const protocol of ['HTTP','HTTPS']) {
    tap(nodes().find(node=>node.includes(`content-desc="Test Mock API ${protocol}"`) && node.includes('package="com.facebook.flipper.sample"')));
    let response;
    for(let attempt=0;attempt<5;attempt++) {
      response=nodes().find(node=>node.includes('resource-id="android:id/message"') && node.includes('package="com.facebook.flipper.sample"'));
      if(response?.includes('HTTP 200'))break;
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    assert.ok(response?.includes('HTTP 200') && response.includes('Hello from Flipper Mock API'),`${protocol} sample request failed`);
    tap(nodes().find(node=>node.includes('resource-id="android:id/button1"') && node.includes('package="com.facebook.flipper.sample"')));
    console.log(`${protocol}: 200 with expected synthetic response`);
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
