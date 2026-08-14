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
const CHUNK_SECONDS = Math.max(120, Math.min(600, Number(process.env.WHISPER_CHUNK_SECONDS || 240)));

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

function parseSrt(text, offsetSec = 0, idOffset = 0) {
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
      id: `local_${idOffset + out.length + 1}`,
      start: parseSrtTime(a) + offsetSec,
      end: parseSrtTime(b) + offsetSec,
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

function readAscii(buf, start, len) {
  return buf.subarray(start, start + len).toString('ascii');
}

function parsePcmWav(buf) {
  if (buf.length < 44 || readAscii(buf, 0, 4) !== 'RIFF' || readAscii(buf, 8, 4) !== 'WAVE') {
    throw new Error('Local transcription expects a WAV file.');
  }

  let pos = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (pos + 8 <= buf.length) {
    const id = readAscii(buf, pos, 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ' && size >= 16) {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        byteRate: buf.readUInt32LE(body + 8),
        blockAlign: buf.readUInt16LE(body + 12),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = Math.min(size, buf.length - body);
      break;
    }
    pos = body + size + (size % 2);
  }

  if (!fmt || dataOffset < 0) throw new Error('Invalid WAV: fmt/data chunk not found.');
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error('Local chunking requires 16-bit PCM WAV.');
  }
  if (!fmt.blockAlign || !fmt.sampleRate) throw new Error('Invalid WAV format.');

  return { ...fmt, dataOffset, dataSize };
}

function makeWavHeader(dataBytes, fmt) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(fmt.channels, 22);
  h.writeUInt32LE(fmt.sampleRate, 24);
  h.writeUInt32LE(fmt.sampleRate * fmt.blockAlign, 28);
  h.writeUInt16LE(fmt.blockAlign, 32);
  h.writeUInt16LE(fmt.bitsPerSample, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

function splitWav(buf, seconds = CHUNK_SECONDS) {
  const fmt = parsePcmWav(buf);
  const data = buf.subarray(fmt.dataOffset, fmt.dataOffset + fmt.dataSize);
  const framesPerChunk = Math.max(1, Math.floor(fmt.sampleRate * seconds));
  const bytesPerChunk = framesPerChunk * fmt.blockAlign;
  const chunks = [];

  for (let startByte = 0; startByte < data.length; startByte += bytesPerChunk) {
    let endByte = Math.min(data.length, startByte + bytesPerChunk);
    endByte -= (endByte - startByte) % fmt.blockAlign;
    if (endByte <= startByte) break;
    const payload = data.subarray(startByte, endByte);
    const wav = Buffer.concat([makeWavHeader(payload.length, fmt), payload]);
    const startFrame = startByte / fmt.blockAlign;
    const frameCount = payload.length / fmt.blockAlign;
    chunks.push({
      wav,
      offsetSec: startFrame / fmt.sampleRate,
      durationSec: frameCount / fmt.sampleRate,
    });
  }

  return { fmt, chunks, durationSec: data.length / fmt.blockAlign / fmt.sampleRate };
}

async function transcribeChunk(rt, dir, chunk, index, threads) {
  const input = join(dir, `input-${String(index + 1).padStart(2, '0')}.wav`);
  const outputBase = join(dir, `result-${String(index + 1).padStart(2, '0')}`);
  await writeFile(input, chunk.wav);

  const beamSize = String(Math.max(5, Math.min(10, Number(process.env.WHISPER_BEAM_SIZE || 8))));
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
  return { srt, beamSize: Number(beamSize) };
}

async function directTranscribe(file) {
  const rt = await runtime();
  if (!rt.cli) throw new Error('whisper-cli.exe was not found. Run setup-local-windows.ps1 again.');
  if (!rt.model) throw new Error('Whisper model was not found. Run setup-local-windows.ps1 again.');

  const dir = await mkdtemp(join(tmpdir(), 'ade-direct-whisper-'));
  try {
    const source = Buffer.from(await file.arrayBuffer());
    const split = splitWav(source, CHUNK_SECONDS);
    const threads = Math.max(4, Math.min(12, Math.max(1, availableParallelism() - 1)));
    const all = [];
    let beamSize = 8;

    console.log(`[ADE Whisper] ${split.durationSec.toFixed(1)}s audio -> ${split.chunks.length} chunks of up to ${CHUNK_SECONDS}s`);

    for (let i = 0; i < split.chunks.length; i++) {
      const chunk = split.chunks[i];
      console.log(`[ADE Whisper] chunk ${i + 1}/${split.chunks.length}: ${chunk.offsetSec.toFixed(1)}s - ${(chunk.offsetSec + chunk.durationSec).toFixed(1)}s`);
      const result = await transcribeChunk(rt, dir, chunk, i, threads);
      beamSize = result.beamSize;
      const parsed = parseSrt(result.srt, chunk.offsetSec, all.length);
      all.push(...parsed);
    }

    return {
      text: all.map(s => s.text).join(' '),
      duration: split.durationSec,
      segments: all,
      runtime: {
        model: rt.model.name,
        vad: null,
        beamSize,
        profile: 'accuracy-chunked',
        chunkSeconds: CHUNK_SECONDS,
        chunkCount: split.chunks.length,
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
        profile: 'accuracy-chunked',
        chunkSeconds: CHUNK_SECONDS,
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

console.log(`[ADE] Direct Whisper CLI integration enabled. Chunk size: ${CHUNK_SECONDS}s`);
