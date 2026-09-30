// Native packaged-app validation. All imported logs are synthetic test data.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'work', 'packaged-smoke');
fs.mkdirSync(output, {recursive: true});
const version = require('../package.json').version;
const directory = path.join(root, 'dist', 'electron');
const executable = process.platform === 'win32'
  ? path.join(directory, 'win-unpacked', 'Flipper.exe')
  : process.platform === 'darwin'
    ? path.join(directory, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Flipper.app', 'Contents', 'MacOS', 'Flipper')
    : path.join(directory, 'linux-unpacked', 'flipper');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const log = fs.openSync(path.join(output, 'process.log'), 'w');
const profile = fs.mkdtempSync(path.join(output,'profile-'));
const child = spawn(executable, ['--remote-debugging-port=19342', `--user-data-dir=${profile}`], {stdio:['ignore',log,log], windowsHide:true, env: {...process.env, FLIPPER_MOCK_API_DATA_DIR: path.join(profile, 'mock-api')}});
let socket;
const result = {platform:process.platform,arch:process.arch,version};
let processError;
child.once('error', error => {processError=error;});
const exited = new Promise(resolve=>child.once('exit',resolve));
const pending = new Map();
let nextId=0;
function send(method,params={}) {
  const id=++nextId;
  return new Promise((resolve,reject)=> {
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},20000);
    pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function run(expression) {
  const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result?.value;
}
async function wait(expression,label) {
  for(let i=0;i<100;i++) {if(await run(expression))return;await delay(300);}
  throw new Error(label);
}
(async()=>{
  let target;
  for(let i=0;i<120;i++) {
    if(processError)throw processError;
    if(child.exitCode!==null)throw new Error(`Packaged app exited: ${child.exitCode}`);
    try {target=(await (await fetch('http://127.0.0.1:19342/json')).json()).find(t=>t.type==='page' && t.url.startsWith('http://localhost:52342'));}catch{}
    if(target)break;
    await delay(500);
  }
  assert.ok(target,'Packaged application did not start its renderer');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message',({data})=> {
    const m=JSON.parse(data);const request=pending.get(m.id);if(!request)return;
    pending.delete(m.id); m.error?request.reject(new Error(m.error.message)):request.resolve(m.result);
  });
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  await wait(`(() => {Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('Skip Setup Wizard'))?.click();return !!Array.from(document.querySelectorAll('.ant-menu-submenu-title')).find(e=>e.textContent.trim()==='More');})()`, 'Main UI did not load');
  await run(`Array.from(document.querySelectorAll('.ant-modal button')).find(e=>e.textContent.trim()==='Close')?.click()`);
  assert.equal(await run(`(() => {try{return typeof window.require('node:fs').readFileSync==='function'}catch{return false}})()`),false);
  result.rendererIsolation=true;
  await require('./mock-api.cjs')({run, wait, send, profile});
  result.mockApi=true;
  const rows=Array.from({length:4100},(_,i)=>({date:new Date(1700000000000+i).toISOString(),pid:4242,tid:4243,tag:'ReleaseTest',type:i%2?'debug':'info',message:`Synthetic event ${i}\n`,count:1,pidStr:'4242',processName:'com.example.release'}));
  const fixture={fileVersion:'0.273.0',clients:[],pluginStates2:{},deviceScreenshot:null,store:{activeNotifications:[]},device:{deviceType:'physical',os:'Android',serial:'synthetic-release-test',title:'Synthetic release fixture',pluginStates:{DeviceLogs:{logs:rows}}}};
  await run(`(() => {const fixture=${JSON.stringify(fixture)};HTMLInputElement.prototype.click=function(){if(this.type==='file'){const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(fixture)],'synthetic.flipper',{type:'application/json'}));this.files=transfer.files;this.dispatchEvent(new Event('change',{bubbles:true}));}};})()`);
  await run(`Array.from(document.querySelectorAll('.ant-menu-submenu-title')).find(e=>e.textContent.trim()==='More').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
  await wait(`!!Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Import Flipper file')`,'Import menu missing');
  await run(`Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='Import Flipper file').click()`);
  await wait(`(() => {
    Array.from(document.querySelectorAll('.ant-modal button')).find(e=>e.textContent.trim()==='Close')?.click();
    const selector=document.querySelector('button[title="Select the device / app to inspect"]');
    if (!selector?.textContent.includes('Synthetic release fixture')) {
      const device=Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.includes('Synthetic release fixture'));
      if(device) device.click(); else selector?.click();
      return false;
    }
    const item=Array.from(document.querySelectorAll('.ant-menu-item .ant-typography')).find(e=>e.textContent==='Logs');
    item?.closest('.ant-menu-item')?.click();
    return !!document.querySelector('[aria-label="Logcat text"]') && document.querySelector('[role="status"]')?.textContent.includes((4100).toLocaleString());
  })()`,'Synthetic logs did not import');
  const viewer=`document.querySelector('[aria-label="Logcat text"]')`;
  assert.equal(await run(`getComputedStyle(${viewer}).whiteSpace`),'pre');
  assert.ok(await run(`Array.from(${viewer}.children).every(row=>!row.lastElementChild.textContent.endsWith(String.fromCharCode(10,10)))`));
  await run(`document.querySelector('button[aria-label="Older logs"]').click()`);
  const anchor=await run(`(() => {const text=${viewer};const row=text.children[150];row.scrollIntoView({block:'start'});text.parentElement.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,bubbles:true}));return {text:row.textContent,offset:row.getBoundingClientRect().top-text.parentElement.getBoundingClientRect().top};})()`);
  async function query(value,count) {
    await run(`(() => {const e=document.querySelector('input[aria-label="Filter logs"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(`document.querySelector('[role="status"]').textContent.includes((${count}).toLocaleString()+' matching')`,'Filtered count mismatch');
    await delay(150);
  }
  await query('package:com.example.release level:debug -level:info',2050);
  await query('message:__no_synthetic_match__',0);
  await query('',4100);
  assert.equal(await run(`(() => {const t=${viewer};const row=Array.from(t.children).find(e=>e.textContent===${JSON.stringify(anchor.text)});return row ? row.getBoundingClientRect().top-t.parentElement.getBoundingClientRect().top : null;})()`),anchor.offset);
  result.syntheticImport=true;result.queryContext=true;result.spacing=true;result.softWrapDefault=true;
  await run('window.close()');
  let timer;
  const code=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Packaged shutdown timed out')),15000);})]).finally(()=>clearTimeout(timer));
  assert.equal(code,0);
  result.shutdown=true;result.passed=true;
})().catch(async error=>{
  result.error=error.message;process.exitCode=1;
  if(socket?.readyState===WebSocket.OPEN) {
    try {fs.writeFileSync(path.join(output,'synthetic-ui.txt'),await run('document.body.innerText'));}catch{}
  }
  child.kill();
}).finally(()=>{
  socket?.close();fs.closeSync(log);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
});
