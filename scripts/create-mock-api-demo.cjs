// Local sample fixtures only. The private key is written under ignored work/.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const forge = require('../desktop/plugins/public/node_modules/node-forge');
const {BuildEnvironment} = require('../desktop/plugins/public/node_modules/@mockoon/commons');
const directory = path.join(root, 'work', 'mock-api-demo');
const keyPath = path.join(directory, 'localhost-key.pem');
const certPath = path.join(directory, 'localhost-cert.pem');
fs.mkdirSync(directory, {recursive:true, mode:0o700});
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01' + crypto.randomBytes(15).toString('hex');
  certificate.validity.notBefore = new Date(Date.now() - 86400000);
  certificate.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  certificate.setSubject([{name:'commonName',value:'Flipper local Mock API development'}]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.setExtensions([
    {name:'basicConstraints', cA:true},
    {name:'keyUsage', digitalSignature:true, keyEncipherment:true, keyCertSign:true},
    {name:'extKeyUsage',serverAuth:true},
    {name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'}]},
  ]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  fs.writeFileSync(keyPath,forge.pki.privateKeyToPem(keys.privateKey),{mode:0o600});
  fs.writeFileSync(certPath,forge.pki.certificateToPem(certificate));
}
const raw = path.join(root,'android/sample/src/debug/res/raw');
fs.mkdirSync(raw,{recursive:true});
// Only this PUBLIC certificate is included in the debug APK, never the key.
fs.copyFileSync(certPath,path.join(raw,'mock_api_dev_ca.pem'));
for (const tls of [false,true]) {
  const env = JSON.parse(JSON.stringify(BuildEnvironment({hasDefaultRoute:true,hasContentTypeHeader:true,port:tls?3001:3000})));
  env.hostname='127.0.0.1';env.name=`Android sample ${tls?'HTTPS':'HTTP'}`;
  env.routes[0].endpoint='hello';
  env.routes[0].responses[0].body=JSON.stringify({message:'Hello from Flipper Mock API',protocol:tls?'https':'http',status:'ok'},null,2);
  if(tls)env.tlsOptions={...env.tlsOptions,enabled:true,certPath:'localhost-cert.pem',keyPath:'localhost-key.pem'};
  fs.writeFileSync(path.join(directory,tls?'https.json':'http.json'),JSON.stringify(env,null,2));
}
console.log(`Import http.json and https.json from ${directory}, then press Start on both.`);
console.log('Rebuild the debug sample after running this script. No keys or environments were uploaded.');
