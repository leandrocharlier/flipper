// Copyright (c) Meta Platforms, Inc. and affiliates. MIT license.
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function serverEnvironment(env = process.env) {
  const result = {...env};
  // Windows environment names are case-insensitive. Avoid duplicate PATH keys.
  const pathKey = Object.keys(result).find(
    (key) => key.toUpperCase() === 'PATH',
  );
  const inherited = pathKey ? result[pathKey] : '';
  if (pathKey) delete result[pathKey];
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools'),
          path.join(
            env.ProgramFiles || 'C:\\Program Files',
            'Git',
            'usr',
            'bin',
          ),
        ].filter((directory) => fs.existsSync(directory))
      : [];
  result.PATH = [...candidates, inherited].filter(Boolean).join(path.delimiter);
  delete result.ELECTRON_RUN_AS_NODE;
  return result;
}

class ServerProcess {
  constructor({
    directory,
    logFile,
    port = 52342,
    onUnexpectedExit = () => {},
    timeout = 60000,
  }) {
    Object.assign(this, {directory, logFile, port, onUnexpectedExit, timeout});
    this.stopping = false;
  }

  async start() {
    const runtime = path.join(
      this.directory,
      process.platform === 'win32' ? 'flipper-runtime.exe' : 'flipper-runtime',
    );
    if (
      !fs.existsSync(runtime) ||
      !fs.existsSync(path.join(this.directory, 'server.js'))
    ) {
      throw new Error(
        'Flipper server bundle is missing. Run yarn build:flipper-server --desktop before packaging Electron.',
      );
    }
    fs.mkdirSync(path.dirname(this.logFile), {recursive: true});
    // Truncate on each launch, so a long history cannot grow without limit.
    this.log = fs.createWriteStream(this.logFile, {flags: 'w'});
    this.child = spawn(
      runtime,
      [
        'server.js',
        '--no-open',
        '--fail-fast',
        '--desktop-shell',
        `--port=${this.port}`,
      ],
      {
        cwd: this.directory,
        env: serverEnvironment(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    this.child.stdout.pipe(this.log, {end: false});
    this.child.stderr.pipe(this.log, {end: false});
    // On Windows an explicitly disconnected IPC handle can delay `close` even
    // after the process exits. Process lifetime is determined by `exit`.
    this.exited = new Promise((resolve) => {
      this.child.once('exit', resolve);
      this.child.once('error', resolve);
    });
    await new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `Flipper server did not become ready within ${this.timeout / 1000} seconds.`,
            ),
          ),
        this.timeout,
      );
      this.child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.child.on('message', (message) => {
        if (message?.type === 'desktop-ready' && message.port === this.port) {
          ready = true;
          clearTimeout(timer);
          resolve();
        }
      });
      this.child.once('close', (code, signal) => {
        clearTimeout(timer);
        this.log.end();
        const error = new Error(
          `Flipper server stopped (${signal || code}). See ${this.logFile}`,
        );
        if (!ready) reject(error);
        else if (!this.stopping) this.onUnexpectedExit(error);
      });
    });
  }

  async stop() {
    if (!this.child || this.stopping) return;
    this.stopping = true;
    if (
      !this.child.pid ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    )
      return;
    if (this.child.connected)
      this.child.send({type: 'desktop-shutdown'}, () => {});
    let timer;
    const stopped = await Promise.race([
      this.exited.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 5000);
      }),
    ]);
    clearTimeout(timer);
    if (!stopped) {
      this.child.kill();
      await this.exited;
    }
  }
}

module.exports = {ServerProcess, serverEnvironment};
