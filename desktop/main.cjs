const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const MODEL_REPOSITORY = 'Systran/faster-whisper-large-v3';
const MODEL_FOLDER = 'faster-whisper-large-v3';

let mainWindow = null;
let serverProcess = null;
let serverPort = null;
let modelDownloadProcess = null;

function appRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.resolve(__dirname, '..');
}

function runtimeRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'runtime')
    : path.resolve(__dirname, '..', 'runtime');
}

function transcriberPath() {
  return path.join(runtimeRoot(), 'transcriber', 'ade-transcriber.exe');
}

function bundledModelPath() {
  return path.join(runtimeRoot(), 'models', MODEL_FOLDER);
}

function userModelPath() {
  return path.join(app.getPath('userData'), 'models', MODEL_FOLDER);
}

function modelReady(modelPath) {
  return Boolean(
    modelPath
    && existsSync(path.join(modelPath, 'config.json'))
    && existsSync(path.join(modelPath, 'model.bin'))
    && existsSync(path.join(modelPath, 'tokenizer.json'))
  );
}

function installedModelPath() {
  if (modelReady(userModelPath())) return userModelPath();
  if (modelReady(bundledModelPath())) return bundledModelPath();
  return userModelPath();
}

function modelStatus() {
  const executable = transcriberPath();
  const userModel = userModelPath();
  const bundledModel = bundledModelPath();
  const selectedModel = installedModelPath();
  return {
    engineInstalled: existsSync(executable),
    modelInstalled: modelReady(selectedModel),
    downloading: Boolean(modelDownloadProcess),
    executable,
    modelPath: selectedModel,
    userModelPath: userModel,
    bundledModelPath: bundledModel,
    repository: MODEL_REPOSITORY,
  };
}

function emitModelProgress(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('ade:model-progress', payload);
}

function downloadModel() {
  if (modelDownloadProcess) {
    throw new Error('모델을 이미 설치하고 있습니다.');
  }

  const executable = transcriberPath();
  if (!existsSync(executable)) {
    throw new Error('ADE 전사 엔진이 설치되지 않았습니다. 프로그램을 다시 설치해 주세요.');
  }
  if (modelReady(userModelPath()) || modelReady(bundledModelPath())) {
    return Promise.resolve(modelStatus());
  }

  return new Promise((resolve, reject) => {
    const args = [
      '--download-model',
      '--model-repo', MODEL_REPOSITORY,
      '--model-output', userModelPath(),
      '--download-workers', '4',
    ];

    emitModelProgress({ stage: 'starting', message: 'large-v3 모델 설치를 시작합니다.' });
    modelDownloadProcess = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        HF_HUB_DISABLE_XET: '1',
      },
    });

    let stderr = '';
    let stdout = '';
    let lineBuffer = '';

    modelDownloadProcess.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 100_000) stdout = stdout.slice(-100_000);
    });

    modelDownloadProcess.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (stderr.length > 500_000) stderr = stderr.slice(-500_000);
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        const value = line.trim();
        if (!value) continue;
        try {
          const event = JSON.parse(value);
          emitModelProgress(event);
        } catch {
          const cleaned = value.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').slice(-240);
          if (cleaned) emitModelProgress({ stage: 'downloading', message: cleaned });
        }
      }
    });

    modelDownloadProcess.on('error', error => {
      modelDownloadProcess = null;
      emitModelProgress({ stage: 'error', message: error.message });
      reject(error);
    });

    modelDownloadProcess.on('close', code => {
      modelDownloadProcess = null;
      if (code === 0 && modelReady(userModelPath())) {
        const status = modelStatus();
        emitModelProgress({ stage: 'complete', message: 'large-v3 모델 설치가 완료되었습니다.', status });
        resolve(status);
      } else {
        const message = `모델 설치에 실패했습니다. 종료 코드 ${code}.\n${stderr.slice(-8000) || stdout.slice(-3000)}`;
        emitModelProgress({ stage: 'error', message });
        reject(new Error(message));
      }
    });
  });
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
  const runtime = runtimeRoot();
  const serverFile = path.join(root, 'server.mjs');
  const shimFile = path.join(root, 'scripts', 'local-fetch-shim.mjs');

  const args = ['--import', shimFile, serverFile];
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ADE_DESKTOP: '1',
    ADE_RESOURCE_ROOT: process.resourcesPath,
    ADE_RUNTIME_ROOT: runtime,
    ADE_USER_DATA: app.getPath('userData'),
    ADE_TRANSCRIBER_EXE: transcriberPath(),
    ADE_WHISPER_MODEL: installedModelPath(),
    DEFAULT_PROVIDER: 'local',
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

function registerDesktopHandlers() {
  ipcMain.handle('ade:model-status', () => modelStatus());
  ipcMain.handle('ade:model-download', () => downloadModel());
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

  app.whenReady().then(async () => {
    registerDesktopHandlers();
    await createWindow();
  }).catch(error => {
    console.error(error);
    dialog.showErrorBox(
      'ADE 실행 오류',
      `ADE 백엔드를 시작하지 못했습니다.\n\n${error.message}`,
    );
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  stopBackend();
  if (modelDownloadProcess) modelDownloadProcess.kill();
});
