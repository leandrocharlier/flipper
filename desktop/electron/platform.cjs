const path = require('node:path');

function serverDirectory() {
  return path.resolve(__dirname, '../../dist', `flipper-server-${
    process.platform === 'win32' ? 'windows' : `${process.platform}-${process.arch}`
  }`);
}

module.exports = {serverDirectory};
