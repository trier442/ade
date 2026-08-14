import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TOOLS = join(ROOT, '.local-tools');
const WHISPER_DIR = join(TOOLS, 'whisper');
const MODELS_DIR = join(TOOLS, 'models');
const NATIVE_FETCH = globalThis.fetch.bind(globalThis);

async function findFile(dir, target) {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = await findFile(p, target);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === target.toLowerCase()) {
      return p;
    }
  }
  return null;
}

async function largestModel() {
  if (!existsSync(MODELS_DIR)) return null;
  const names = (await readdir(MODELS_DIR))
    .filter(n => /^ggml-.*\.bin$/i.test(n))
    .filter(n => !/silero/i.test(n));
  const rows = [];
  for (const name of names) {
    const path = join(MODELS_DIR, name);
    const s = await stat(path);
    rows.push({ name, path, size: s.size });
  }
  rows.sort((a, b) => b.size - a.size);
  return rows[0] || null;
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
    const ti = lines.findIndex(x => x.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->').map(x => x.trim());
    const body = lines.slice(ti + 1).join(' ').replace(/^\[[^\]]+\]\s*/, '').trim();
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
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Whisper CLI timed out.'));
    }, timeoutMs);
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
      if (code === 0) resolve();
      else reject(new Error(`whisper-cli exited with code ${code}\n${stderr.slice(-6000)}`));
    });
  });
}

let runtimeCache;
async function runtime() {
  if (runtimeCache) return runtimeCache;
  const cli = await findFile(WHISPER_DIR, 'whisper-cli.exe');
  const model = await largestModel();
  runtimeCache = { cli, model };
  return runtimeCache;
}

async function directTranscribe(file) {
  const rt = await runtime();
  if (!rt.cli) throw new Error('whisper-cli.exe was not found. Run setup-local-windows.ps1 again.');
  if (!rt.model) throw new Error('Whisper model was not found. Run setup-local-windows.ps1 again.');

  const dir = await mkdtemp(join(tmpdir(), 'ade-direct-whisper-'));
  const input = join(dir, 'input.wav');
  const outputBase = join(dir, 'result');
  try {
    await writeFile(input, Buffer.from(await file.arrayBuffer()));
    const threads = Math.max(4, Math.min(12, Math.max(1, availableParallelism() - 1)));
    const beamSize = String(Math.max(5, Math.min(10, Number(process.env.WHISPER_BEAM_SIZE || 8))));

    // Accuracy-first defaults for classroom debate recordings:
    // - no VAD by default: quiet student speech is less likely to be cut off
    // - no fixed prompt: prevents topic-word hallucination in silence/noise
    // - no suppress-nst: preserves ambiguous but potentially meaningful speech
    const args = [
      '-m', rt.model.path,
      '-f', input,
      '-l', 'ko',
      '-t', String(threads),
      '-bs', beamSize,
      '-bo', '5',
      '-sow',
      '-ng',
      '-osrt',
      '-of', outputBase,
      '-np',
    ];

    const customPrompt = String(process.env.WHISPER_PROMPT || '').trim();
    if (customPrompt) args.push('--prompt', customPrompt.slice(0, 600));

    await run(rt.cli, args);
    const srt = await readFile(`${outputBase}.srt`, 'utf8');
    const segments = parseSrt(srt);
    return {
      text: segments.map(s => s.text).join(' '),
      duration: segments.length ? segments.at(-1).end : 0,
      segments,
      runtime: {
        model: rt.model.name,
        vad: null,
        beamSize: Number(beamSize),
        profile: 'accuracy-conservative',
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

globalThis.fetch = async function adeFetch(input, init = {}) {
  const raw = typeof input === 'string' ? input : input?.url || String(input);
  let url;
  try { url = new URL(raw); } catch { return NATIVE_FETCH(input, init); }

  const localWhisper = url.hostname === '127.0.0.1' && url.port === '8080';
  if (!localWhisper) return NATIVE_FETCH(input, init);

  try {
    const rt = await runtime();
    if (url.pathname === '/' && (!init.method || init.method === 'GET')) {
      return response({
        ok: Boolean(rt.cli && rt.model),
        service: 'ade-direct-whisper',
        model: rt.model?.name || null,
        profile: 'accuracy-conservative',
      });
    }

    if (url.pathname === '/inference' && String(init.method || 'GET').toUpperCase() === 'POST') {
      const form = init.body;
      const file = form?.get?.('file');
      if (!(file instanceof Blob) || !file.size) return response({ error: 'Audio file is required.' }, 400);
      const result = await directTranscribe(file);
      return response(result);
    }

    return response({ error: 'Not found' }, 404);
  } catch (e) {
    console.error('[ADE direct Whisper]', e);
    return response({ error: e.message || 'Direct Whisper transcription failed.' }, 500);
  }
};

console.log('[ADE] Direct Whisper CLI integration enabled (accuracy-conservative profile).');
