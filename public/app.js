const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let mediaRecorder;
let chunks = [];
let timerId;
let seconds = 0;
let audioFile = null;
let segments = [];
let evaluation = null;
let rubric = null;
let health = null;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3600);
}

function esc(s = '') {
  return String(s).replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));
}

function time(s) {
  s = Math.max(0, Number(s || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function provider() {
  return $('#provider')?.value === 'openai' ? 'openai' : 'local';
}

function people() {
  return $$('.person').map(r => ({
    side: r.querySelector('select').value,
    name: r.querySelector('input').value.trim(),
  })).filter(x => x.name);
}

function roleOptions(selected = '찬성') {
  return ['찬성', '반대', '사회자'].map(x => `<option${selected === x ? ' selected' : ''}>${x}</option>`).join('');
}

function addPerson(side = '찬성', name = '') {
  const d = document.createElement('div');
  d.className = 'person';
  d.innerHTML = `<select>${roleOptions(side)}</select><input placeholder="참가자 이름" value="${esc(name)}"><button title="삭제">×</button>`;
  d.querySelector('button').onclick = () => {
    commitSegmentEdits();
    d.remove();
    renderSegments();
  };
  d.querySelector('input').onchange = () => { commitSegmentEdits(); renderSegments(); };
  d.querySelector('select').onchange = () => { commitSegmentEdits(); renderSegments(); };
  $('#people').append(d);
}

function roleOf(name) {
  return people().find(p => p.name === name)?.side || '';
}

function automaticSpeakers() {
  return [...new Set(segments.map(s => s.speaker).filter(s => s && !['미지정', '?'].includes(s)))];
}

function participantOptions(selected = '') {
  return `<option value="">화자 지정</option>${people().map(p =>
    `<option value="${esc(p.name)}"${selected === p.name ? ' selected' : ''}>${esc(p.name)} · ${p.side}</option>`
  ).join('')}`;
}

function commitSegmentEdits() {
  $$('.segmentEdit').forEach(el => {
    const i = Number(el.dataset.index);
    if (segments[i]) segments[i].text = el.value.trim();
  });
  $$('.segmentPerson').forEach(el => {
    const i = Number(el.dataset.index);
    if (segments[i]) segments[i].assignedName = el.value;
  });
}

function bulkAssignHtml() {
  if (!segments.length || automaticSpeakers().length) return '';
  return `<div class="bulkAssign">
    <b>화자 범위 일괄 지정</b>
    <input id="rangeStart" type="number" min="1" max="${segments.length}" placeholder="시작" value="1">
    <span>~</span>
    <input id="rangeEnd" type="number" min="1" max="${segments.length}" placeholder="끝" value="${segments.length}">
    <select id="rangePerson">${participantOptions('')}</select>
    <button id="applyRange" class="ghost" type="button">범위 지정</button>
  </div>`;
}

function speakerMap() {
  const names = people();
  const speakers = automaticSpeakers();
  if (!speakers.length) {
    $('#speakerMap').innerHTML = `<span class="hint">각 발언을 찬성·반대·사회자 중 실제 화자에게 지정하세요. 사회자는 평가 점수에서 제외됩니다.</span>${bulkAssignHtml()}`;
    $('#applyRange')?.addEventListener('click', () => {
      commitSegmentEdits();
      const start = Math.max(1, Number($('#rangeStart').value || 1));
      const end = Math.min(segments.length, Number($('#rangeEnd').value || segments.length));
      const name = $('#rangePerson').value;
      if (!name) return toast('범위에 지정할 참가자를 선택해 주세요.');
      if (end < start) return toast('구간 범위를 확인해 주세요.');
      for (let i = start - 1; i <= end - 1; i++) segments[i].assignedName = name;
      renderSegments();
      toast(`${start}~${end}번 구간을 ${name} 화자로 지정했습니다.`);
    });
    return;
  }

  $('#speakerMap').innerHTML = speakers.map(sp => `
    <label>${esc(sp)}
      <select data-speaker="${esc(sp)}">
        <option value="">미지정</option>
        ${names.map(p => `<option value="${esc(p.name)}">${esc(p.name)} · ${p.side}</option>`).join('')}
      </select>
    </label>`).join('');
}

function renderSegments() {
  if (!segments.length) {
    $('#segments').innerHTML = '<div class="empty">전사 결과가 아직 없습니다.</div>';
    $('#segCount').textContent = '0개 구간';
    $('#speakerMap').innerHTML = '';
    return;
  }

  $('#segCount').textContent = `${segments.length}개 구간`;
  const needsManual = segments.some(s => ['미지정', '?'].includes(s.speaker));

  $('#segments').innerHTML = segments.map((s, i) => {
    const manual = ['미지정', '?'].includes(s.speaker);
    return `<div class="segment">
      <div class="time"><b>${i + 1}</b><br>${time(s.start)}–${time(s.end)}</div>
      <div class="who">${manual ? '화자 미지정' : esc(s.speaker)}</div>
      <textarea class="segmentEdit" data-index="${i}" rows="3" spellcheck="false">${esc(s.text)}</textarea>
      ${manual ? `<select class="segmentPerson" data-index="${i}">${participantOptions(s.assignedName || '')}</select>` : ''}
    </div>`;
  }).join('');

  $('#manualHint').classList.toggle('hidden', !needsManual);
  $$('.segmentEdit').forEach(el => {
    el.onchange = () => { if (segments[Number(el.dataset.index)]) segments[Number(el.dataset.index)].text = el.value.trim(); };
  });
  $$('.segmentPerson').forEach(sel => {
    sel.onchange = () => { if (segments[Number(sel.dataset.index)]) segments[Number(sel.dataset.index)].assignedName = sel.value; };
  });
  speakerMap();
}

function getSpeakerMap() {
  return Object.fromEntries($$('#speakerMap select[data-speaker]').filter(x => x.value).map(x => [x.dataset.speaker, x.value]));
}

function evalName(name) {
  return roleOf(name) === '사회자' ? `${name} (사회자·평가 제외)` : name;
}

function segmentsForEval() {
  commitSegmentEdits();
  return segments.map(s => ({
    ...s,
    assignedName: s.assignedName ? evalName(s.assignedName) : '',
  }));
}

function progress(on, msg = '처리 중입니다.') {
  const p = $('#progress');
  p.textContent = msg;
  p.classList.toggle('hidden', !on);
}

function encodeWav16(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buffer;
}

async function convertToWav16k(file) {
  if (/\.wav$/i.test(file.name) && file.type.includes('wav')) return file;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !window.OfflineAudioContext) return file;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
    const sampleRate = 16000;
    const length = Math.ceil(decoded.duration * sampleRate);
    const offline = new OfflineAudioContext(1, length, sampleRate);
    const src = offline.createBufferSource();
    src.buffer = decoded; src.connect(offline.destination); src.start(0);
    const rendered = await offline.startRendering();
    const wav = encodeWav16(rendered.getChannelData(0), sampleRate);
    const base = (file.name || 'debate').replace(/\.[^.]+$/, '');
    return new File([wav], `${base}.wav`, { type: 'audio/wav' });
  } catch (e) {
    console.warn('WAV 변환 생략:', e);
    return file;
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function transcribe() {
  if (!audioFile) return toast('먼저 녹음하거나 파일을 선택해 주세요.');
  const mode = provider();
  if (mode === 'local' && health && !health.providers?.local?.ready) return toast('무료 로컬 엔진이 준비되지 않았습니다.');
  if (mode === 'openai' && health && !health.providers?.openai?.ready) return toast('OpenAI API 키가 설정되지 않았습니다.');

  progress(true, mode === 'local' ? '정확도 우선 로컬 전사를 준비하고 있습니다.' : 'OpenAI로 음성을 화자별 전사하고 있습니다.');
  try {
    let upload = audioFile;
    if (mode === 'local') {
      progress(true, '로컬 전사용 16kHz WAV를 준비하고 있습니다.');
      upload = await convertToWav16k(audioFile);
      progress(true, 'Whisper 정확도 우선 모드로 전사하고 있습니다. 긴 파일은 시간이 걸릴 수 있습니다.');
    }

    const fd = new FormData();
    fd.append('audio', upload, upload.name || 'debate.wav');
    fd.append('provider', mode);

    const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '전사 실패');
    segments = d.segments || [];
    renderSegments();
    toast(mode === 'local'
      ? '로컬 전사가 완료되었습니다. 전사문을 확인·수정하고 찬성·반대·사회자 화자를 지정해 주세요.'
      : '화자 분리 전사가 완료되었습니다.');
    location.hash = 'transcript';
  } catch (e) {
    toast(e.message);
  } finally {
    progress(false);
  }
}

async function demo() {
  const r = await fetch('/api/demo');
  const d = await r.json();
  segments = d.segments || [];
  renderSegments();
  toast('데모 전사문을 불러왔습니다.');
  location.hash = 'transcript';
}

function evidenceHtml(e = []) {
  return e.map(x => `<div class="evidence"><b>${esc(x.time || '')}</b> ${esc(x.name || '')} — “${esc(x.quote || '')}”</div>`).join('');
}

function teamHtml(t) {
  return `<article class="team">
    <div class="teamHead"><h3>${t.side} 측</h3><div><span class="total">${t.total_score}</span>/100 · <b>${t.grade}</b></div></div>
    ${t.sections.map(s => `<div class="section">
      <div class="sectionTitle"><span>${s.name}</span><span>${s.score}/${s.max_score}</span></div>
      ${s.summary ? `<p>${esc(s.summary)}</p>` : ''}
      ${s.criteria.map(c => `<div class="criterion">
        <div><span>${esc(c.name)}</span><span>${c.score}/${c.maxScore}</span></div>
        <p>${esc(c.judgment)}</p>${evidenceHtml(c.evidence)}
        ${c.improvement ? `<p><b>개선:</b> ${esc(c.improvement)}</p>` : ''}
      </div>`).join('')}
    </div>`).join('')}
    <div class="section"><div class="feedback">
      <div><b>강점</b><ul>${(t.strengths || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><b>개선점</b><ul>${(t.improvements || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    </div></div>
  </article>`;
}

function renderResult(d) {
  evaluation = d;
  $('#resultBody').innerHTML = `
    <div class="resultMeta">${d.provider === 'local' ? '무료 로컬 평가' : 'OpenAI 정밀 평가'} · ${esc(d.model || '')}</div>
    <div class="teamGrid">${d.teams.map(teamHtml).join('')}</div>
    ${d.clashes?.length ? `<div class="clashes"><h3>핵심 충돌 쟁점</h3>${d.clashes.map(x => `<div class="clash"><b>${esc(x.issue)}</b><p><b>찬성:</b> ${esc(x.pro)}</p><p><b>반대:</b> ${esc(x.con)}</p><p>${esc(x.assessment)}</p></div>`).join('')}</div>` : ''}
    ${d.participants?.length ? `<div class="peopleResults"><h3>학생별 기여</h3>${d.participants.map(x => `<div class="personResult"><b>${esc(x.name)} · ${esc(x.side)}</b><p>${esc(x.contribution)}</p><p><b>강점:</b> ${esc(x.strength)}</p><p><b>개선:</b> ${esc(x.improvement)}</p></div>`).join('')}</div>` : ''}
    <div class="overall"><b>종합 평가</b><p>${esc(d.overall_comment)}</p></div>`;
  location.hash = 'result';
}

async function evaluate() {
  const topic = $('#topic').value.trim();
  if (!topic) return toast('논제를 입력해 주세요.');
  if (!segments.length) return toast('먼저 전사를 완료해 주세요.');

  const ps = people();
  const debaters = ps.filter(p => p.side === '찬성' || p.side === '반대');
  if (!debaters.length) return toast('찬성 또는 반대 토론자를 입력해 주세요.');

  const mode = provider();
  const evalSegments = segmentsForEval();
  const auto = automaticSpeakers();
  const rawMap = getSpeakerMap();
  const map = Object.fromEntries(Object.entries(rawMap).map(([speaker, name]) => [speaker, evalName(name)]));

  if (auto.length && Object.keys(map).length === 0) return toast('화자를 최소 한 명 이상 참가자와 연결해 주세요.');
  if (!auto.length) {
    const unassigned = evalSegments.filter(s => !s.assignedName);
    if (unassigned.length) return toast(`화자가 지정되지 않은 발언이 ${unassigned.length}개 있습니다.`);
  }

  $('#evaluateBtn').disabled = true;
  $('#evaluateBtn').textContent = mode === 'local' ? '로컬 평가 중…' : 'AI 평가 중…';
  try {
    const r = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: mode,
        topic,
        className: $('#className').value,
        date: $('#date').value,
        participants: debaters,
        speakerMap: map,
        segments: evalSegments,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '평가 실패');
    renderResult(d);
    toast(mode === 'local' ? '무료 로컬 평가가 완료되었습니다.' : 'OpenAI 정밀 평가가 완료되었습니다.');
  } catch (e) {
    toast(e.message);
  } finally {
    $('#evaluateBtn').disabled = false;
    $('#evaluateBtn').textContent = '평가 시작';
  }
}

function updateProviderInfo() {
  if (!health) return;
  const mode = provider();
  const info = $('#providerInfo');
  const h = health.providers?.[mode];
  if (mode === 'local') {
    info.innerHTML = h?.ready
      ? `<b>무료 로컬 모드 준비됨</b><span>Whisper.cpp 정확도 우선 전사 + Ollama ${esc(h.ollamaModel || '')} 평가 · API 비용 0원</span>`
      : `<b>무료 로컬 모드 설치 필요</b><span>Whisper ${h?.whisper ? '준비됨' : '미준비'} · Ollama ${h?.ollama ? '연결됨' : '미연결'}</span>`;
    $('#health').textContent = h?.ready ? '무료 로컬 준비됨' : '로컬 엔진 미설치';
  } else {
    info.innerHTML = h?.ready
      ? '<b>OpenAI 정밀 모드 준비됨</b><span>화자 분리 전사와 정밀 평가에 API 사용료가 발생합니다.</span>'
      : '<b>OpenAI API 키 미설정</b><span>OPENAI_API_KEY를 설정해야 합니다.</span>';
    $('#health').textContent = h?.ready ? 'OpenAI 준비됨' : 'API 키 미설정';
  }
  $('#localGuide').classList.toggle('hidden', mode !== 'local');
}

async function init() {
  $('#date').value = new Date().toISOString().slice(0, 10);
  addPerson('찬성');
  addPerson('반대');
  addPerson('사회자');

  $('#addPerson').onclick = () => addPerson('찬성');
  $('#file').onchange = e => {
    audioFile = e.target.files[0] || null;
    $('#fileName').textContent = audioFile ? `${audioFile.name} · ${(audioFile.size / 1024 / 1024).toFixed(1)}MB` : '선택된 파일 없음';
  };

  $('#transcribeBtn').onclick = transcribe;
  $('#demo').onclick = demo;
  $('#evaluateBtn').onclick = evaluate;
  $('#print').onclick = () => print();
  $('#saveJson').onclick = () => {
    if (!evaluation) return toast('저장할 평가 결과가 없습니다.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(evaluation, null, 2)], { type: 'application/json' }));
    a.download = `ADE-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $$('.steps button').forEach(b => b.onclick = () => document.getElementById(b.dataset.go).scrollIntoView({ behavior: 'smooth' }));

  $('#record').onclick = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => e.data.size && chunks.push(e.data);
      mediaRecorder.onstop = () => {
        audioFile = new File([new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' })], `debate-${Date.now()}.webm`, { type: mediaRecorder.mimeType || 'audio/webm' });
        $('#fileName').textContent = `직접 녹음 · ${(audioFile.size / 1024 / 1024).toFixed(1)}MB`;
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start(1000);
      seconds = 0; $('#timer').textContent = '00:00';
      timerId = setInterval(() => $('#timer').textContent = time(++seconds), 1000);
      $('#record').disabled = true; $('#stop').disabled = false;
    } catch { toast('마이크 권한을 확인해 주세요.'); }
  };

  $('#stop').onclick = () => {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    clearInterval(timerId); $('#record').disabled = false; $('#stop').disabled = true;
  };

  try {
    health = await fetch('/api/health').then(r => r.json());
    $('#provider').value = health.defaultProvider || (health.providers?.local?.ready ? 'local' : 'openai');
    $('#provider').onchange = updateProviderInfo;
    updateProviderInfo();
    const rr = await fetch('/api/rubric').then(r => r.json());
    rubric = rr;
    $('#rubric').innerHTML = rr.sections.map(s => `<article><b>${s.name} ${s.maxScore}점</b>${s.criteria.map(c => `<p>• ${esc(c.name)} ${c.maxScore}점</p>`).join('')}</article>`).join('');
  } catch {
    $('#health').textContent = '서버 연결 실패';
  }
}

init();
