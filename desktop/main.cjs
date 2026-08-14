const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

let mainWindow = null;
let serverProcess = null;
let serverPort = null;

function appRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.resolve(__dirname, '..');
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  throw new Error(`ADE backend did not start in time: ${lastError?.message || 'unknown error'}`);
}

function startBackend(port) {
  const root = appRoot();
  const serverFile = path.join(root, 'server.mjs');
  const shimFile = path.join(root, 'scripts', 'local-fetch-shim.mjs');

  const args = ['--import', shimFile, serverFile];
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ADE_DESKTOP: '1',
    ADE_RESOURCE_ROOT: process.resourcesPath,
    PORT: String(port),
  };

  serverProcess = spawn(process.execPath, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', data => console.log(`[ADE backend] ${data}`.trimEnd()));
  serverProcess.stderr.on('data', data => console.error(`[ADE backend] ${data}`.trimEnd()));
  serverProcess.on('exit', (code, signal) => {
    console.log(`[ADE backend] exited code=${code} signal=${signal}`);
    serverProcess = null;
  });
}

function stopBackend() {
  if (!serverProcess) return;
  serverProcess.kill();
  serverProcess = null;
}

async function createWindow() {
  serverPort = await reservePort();
  startBackend(serverPort);
  await waitForServer(serverPort);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    title: 'ADE 토론 평가기',
    backgroundColor: '#f7f9fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(console.error);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(createWindow).catch(error => {
    console.error(error);
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', stopBackend);
