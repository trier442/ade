import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const NATIVE_FETCH = globalThis.fetch.bind(globalThis);
const TRANSCRIBE_HOST = '127.0.0.1';
const TRANSCRIBE_PORT = '8080';

function unique(values) {
  return [...new Set(values.filter(Boolean).map(value => resolve(String(value))))];
}

function candidateExecutables() {
  const resourceRoot = process.env.ADE_RESOURCE_ROOT || '';
  return unique([
    process.env.ADE_TRANSCRIBER_EXE,
    resourceRoot && join(resourceRoot, 'runtime', 'transcriber', 'ade-transcriber.exe'),
    join(ROOT, 'runtime', 'transcriber', 'ade-transcriber.exe'),
  ]);
}

function candidateModels() {
  const resourceRoot = process.env.ADE_RESOURCE_ROOT || '';
  const userData = process.env.ADE_USER_DATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  return unique([
    process.env.ADE_WHISPER_MODEL,
    userData && join(userData, 'models', 'faster-whisper-large-v3'),
    localAppData && join(localAppData, 'ADE', 'models', 'faster-whisper-large-v3'),
    resourceRoot && join(resourceRoot, 'runtime', 'models', 'faster-whisper-large-v3'),
    join(ROOT, 'runtime', 'models', 'faster-whisper-large-v3'),
  ]);
}

function resolveRuntime() {
  const executable = candidateExecutables().find(path => existsSync(path)) || null;
  const model = candidateModels().find(path => existsSync(path)) || null;
  return { executable, model };
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function runWorker(command, args, timeoutMs = 4 * 60 * 60 * 1000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      env: { ...process.env, PYTHONUTF8: '1' },
    });

    let stdout = '';
    let stderr = '';
    let lineBuffer = '';

    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error('ADE transcription worker timed out.'));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 100_000) stdout = stdout.slice(-100_000);
    });

    child.stderr.on('data', chunk => {
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
          if (event.event === 'segment') {
            console.log(`[ADE faster-whisper] ${event.index}: ${event.start}-${event.end} ${event.text || ''}`);
          } else {
            console.log(`[ADE faster-whisper] ${value}`);
          }
        } catch {
          console.log(`[ADE faster-whisper] ${value}`);
        }
      }
    });

    child.on('error', error => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (lineBuffer.trim()) console.log(`[ADE faster-whisper] ${lineBuffer.trim()}`);
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(`ADE transcription worker exited with code ${code}.\n${stderr.slice(-12_000)}`));
    });
  });
}

async function transcribe(file, form) {
  const runtime = resolveRuntime();
  if (!runtime.executable) {
    throw new Error('ADE 전사 엔진이 설치되지 않았습니다. 설치형 프로그램 또는 전사 엔진 팩을 설치해 주세요.');
  }
  if (!runtime.model) {
    throw new Error('ADE large-v3 모델 팩이 설치되지 않았습니다. 모델 팩을 설치한 뒤 다시 실행해 주세요.');
  }

  const temp = await mkdtemp(join(tmpdir(), 'ade-faster-whisper-'));
  const extension = extname(file.name || '') || '.wav';
  const input = join(temp, `input${extension}`);
  const output = join(temp, 'result.json');

  try {
    await writeFile(input, Buffer.from(await file.arrayBuffer()));

    const language = String(form.get('language') || 'ko');
    const profile = String(form.get('profile') || process.env.ADE_TRANSCRIBE_PROFILE || 'classroom');
    const prompt = String(form.get('prompt') || '').trim();
    const device = String(process.env.ADE_TRANSCRIBE_DEVICE || 'auto');
    const computeType = String(process.env.ADE_TRANSCRIBE_COMPUTE_TYPE || 'auto');

    const args = [
      '--input', input,
      '--output', output,
      '--model', runtime.model,
      '--language', language,
      '--profile', profile,
      '--device', device,
      '--compute-type', computeType,
      '--beam-size', String(process.env.ADE_TRANSCRIBE_BEAM_SIZE || '5'),
    ];
    if (prompt) args.push('--initial-prompt', prompt.slice(0, 1000));

    await runWorker(runtime.executable, args);
    const result = JSON.parse(await readFile(output, 'utf8'));
    if (!result.ok) throw new Error(result.error || 'Faster-Whisper transcription failed.');

    return {
      provider: 'local',
      model: result.model,
      engine: result.engine,
      duration: result.duration,
      text: result.text,
      segments: result.segments || [],
      speakerMode: 'manual',
      runtime: {
        engineVersion: result.engine_version,
        device: result.device,
        computeType: result.compute_type,
        profile: result.profile,
        elapsedSeconds: result.elapsed_seconds,
      },
    };
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

globalThis.fetch = async function adeDesktopFetch(input, init = {}) {
  const raw = typeof input === 'string' ? input : input?.url || String(input);
  let url;
  try {
    url = new URL(raw);
  } catch {
    return NATIVE_FETCH(input, init);
  }

  const isLocalTranscriber = url.hostname === TRANSCRIBE_HOST && url.port === TRANSCRIBE_PORT;
  if (!isLocalTranscriber) return NATIVE_FETCH(input, init);

  const runtime = resolveRuntime();
  if (url.pathname === '/' && String(init.method || 'GET').toUpperCase() === 'GET') {
    const ready = Boolean(runtime.executable && runtime.model);
    return response({
      ok: ready,
      service: 'ade-faster-whisper-worker',
      executable: runtime.executable,
      model: runtime.model,
      engineInstalled: Boolean(runtime.executable),
      modelInstalled: Boolean(runtime.model),
    }, ready ? 200 : 503);
  }

  if (url.pathname === '/inference' && String(init.method || 'GET').toUpperCase() === 'POST') {
    try {
      const form = init.body;
      const file = form?.get?.('file');
      if (!(file instanceof Blob) || !file.size) return response({ error: 'Audio file is required.' }, 400);
      const result = await transcribe(file, form);
      return response(result);
    } catch (error) {
      console.error('[ADE faster-whisper]', error);
      return response({ error: error.message || 'Local transcription failed.' }, 500);
    }
  }

  return response({ error: 'Not found' }, 404);
};

const runtime = resolveRuntime();
console.log('[ADE] Faster-Whisper desktop integration enabled.');
console.log(`[ADE] Transcriber: ${runtime.executable || 'not installed'}`);
console.log(`[ADE] Model: ${runtime.model || 'not installed'}`);
