import http from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TOOLS = join(ROOT, '.local-tools');
const WHISPER_DIR = join(TOOLS, 'whisper');
const MODELS_DIR = join(TOOLS, 'models');
const PORT = Number(process.env.WHISPER_PROXY_PORT || 8080);
const HOST = '127.0.0.1';

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function webRequest(req) {
  const init = { method: req.method, headers: req.headers };
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }
  return new Request(new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`), init);
}

async function findFile(dir, target) {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(p, target);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === target.toLowerCase()) {
      return p;
    }
  }
  return null;
}

async function largestWhisperModel() {
  if (!existsSync(MODELS_DIR)) return null;
  const names = (await readdir(MODELS_DIR))
    .filter(n => /^ggml-.*\.bin$/i.test(n))
    .filter(n => !/silero/i.test(n));
  const rows = [];
  for (const name of names) {
    const p = join(MODELS_DIR, name);
    const s = await stat(p);
    rows.push({ path: p, size: s.size, name });
  }
  rows.sort((a, b) => b.size - a.size);
  return rows[0] || null;
}

async function vadModel() {
  if (!existsSync(MODELS_DIR)) return null;
  const names = (await readdir(MODELS_DIR)).filter(n => /^ggml-silero-.*\.bin$/i.test(n));
  return names.length ? join(MODELS_DIR, names.sort().at(-1)) : null;
}

function parseSrtTime(v) {
  const m = String(v).trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function parseSrt(text) {
  const blocks = String(text || '').replace(/\r/g, '').trim().split(/\n\s*\n/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(x => x.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timeIndex = lines.findIndex(x => x.includes('-->'));
    if (timeIndex < 0) continue;
    const [a, b] = lines[timeIndex].split('-->').map(x => x.trim());
    const body = lines.slice(timeIndex + 1).join(' ').replace(/^\[[^\]]+\]\s*/, '').trim();
    if (!body) continue;
    out.push({
      id: `local_${out.length + 1}`,
      start: parseSrtTime(a),
      end: parseSrtTime(b),
      speaker: '미지정',
      text: body,
    });
  }
  return out;
}

function run(cmd, args, timeoutMs = 2 * 60 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Whisper CLI timed out.'));
    }, timeoutMs);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => {
      stderr += d.toString();
      if (stderr.length > 200000) stderr = stderr.slice(-200000);
    });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`whisper-cli exited with code ${code}\n${stderr.slice(-5000)}`));
    });
  });
}

let cached = null;
async function resolveRuntime() {
  if (cached) return cached;
  const cli = await findFile(WHISPER_DIR, 'whisper-cli.exe');
  const model = await largestWhisperModel();
  const vad = await vadModel();
  cached = { cli, model, vad };
  return cached;
}

async function transcribe(file, prompt = '') {
  const runtime = await resolveRuntime();
  if (!runtime.cli) throw new Error('whisper-cli.exe was not found. Run the local setup again.');
  if (!runtime.model) throw new Error('Whisper model was not found. Run the local setup again.');

  const dir = await mkdtemp(join(tmpdir(), 'ade-whisper-'));
  const input = join(dir, `input${extname(file.name || '') || '.wav'}`);
  const outputBase = join(dir, 'result');
  try {
    await writeFile(input, Buffer.from(await file.arrayBuffer()));
    const threads = Math.max(4, Math.min(12, Math.max(1, availableParallelism() - 1)));
    const args = [
      '-m', runtime.model.path,
      '-f', input,
      '-l', 'ko',
      '-t', String(threads),
      '-bs', '5',
      '-bo', '5',
      '-sow',
      '-sns',
      '-ng',
      '-osrt',
      '-of', outputBase,
      '-np',
    ];

    if (runtime.vad) {
      args.push('--vad', '-vm', runtime.vad, '-vsd', '450', '-vp', '120');
    }

    const hint = String(prompt || process.env.WHISPER_PROMPT || '한국어 토론 수행평가. 찬성, 반대, 입론, 교차조사, 최종변론, 근거, 반박, 정복지, 문화, 통일, 동화 정책.').trim();
    if (hint) args.push('--prompt', hint.slice(0, 1000));

    await run(runtime.cli, args);
    const srtPath = `${outputBase}.srt`;
    const srt = await readFile(srtPath, 'utf8');
    const segments = parseSrt(srt);
    const text = segments.map(s => s.text).join(' ');
    const duration = segments.length ? segments.at(-1).end : 0;

    return {
      text,
      duration,
      segments,
      runtime: {
        cli: runtime.cli,
        model: runtime.model.name,
        vad: runtime.vad ? runtime.vad.split(/[\\/]/).at(-1) : null,
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === 'GET' && url.pathname === '/') {
    try {
      const runtime = await resolveRuntime();
      return json(res, 200, {
        ok: Boolean(runtime.cli && runtime.model),
        service: 'ade-whisper-cli-proxy',
        cli: runtime.cli,
        model: runtime.model?.name || null,
        vad: runtime.vad ? runtime.vad.split(/[\\/]/).at(-1) : null,
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/inference') {
    try {
      const form = await webRequest(req).formData();
      const file = form.get('file');
      const prompt = form.get('prompt') || '';
      if (!(file instanceof File) || !file.size) return json(res, 400, { error: 'Audio file is required.' });
      const result = await transcribe(file, prompt);
      return json(res, 200, result);
    } catch (e) {
      console.error(e);
      return json(res, 500, { error: e.message || 'Local transcription failed.' });
    }
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`ADE Whisper CLI proxy running on http://${HOST}:${PORT}`);
});
