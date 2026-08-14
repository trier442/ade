(() => {
  'use strict';

  if (!window.ADEDesktop?.isDesktop) return;

  const nativeFetch = window.fetch.bind(window);
  let originalAudioFile = null;

  function participantSummary() {
    return [...document.querySelectorAll('.person')]
      .map(row => {
        const role = row.querySelector('select')?.value?.trim();
        const name = row.querySelector('input')?.value?.trim();
        return name ? `${name}(${role || '참가자'})` : '';
      })
      .filter(Boolean)
      .join(', ');
  }

  function transcriptionPrompt() {
    const topic = document.querySelector('#topic')?.value?.trim() || '';
    const participants = participantSummary();
    const parts = [
      '한국어 토론 수업 녹음이다.',
      topic ? `논제: ${topic}.` : '',
      participants ? `참가자: ${participants}.` : '',
      '주요 진행 단계: 입론, 교차조사, 반론, 최종변론.',
      '고유명사와 토론 용어를 문맥에 맞게 정확히 전사한다.',
    ];
    return parts.filter(Boolean).join(' ');
  }

  function installFileCapture() {
    const input = document.querySelector('#file');
    if (!input) return;
    input.addEventListener('change', event => {
      originalAudioFile = event.target?.files?.[0] || null;
    }, true);
  }

  function decorateDesktop() {
    document.documentElement.classList.add('ade-desktop');
    const guide = document.querySelector('#localGuide');
    if (guide) {
      guide.innerHTML = '<b>설치형 오프라인 모드</b><span>원본 음성 파일을 Faster-Whisper large-v3 엔진으로 직접 처리합니다. 브라우저 WAV 재변환과 PowerShell 실행이 필요하지 않습니다.</span>';
    }

    const hero = document.querySelector('.hero');
    if (hero && !document.querySelector('#desktopBadge')) {
      const badge = document.createElement('div');
      badge.id = 'desktopBadge';
      badge.className = 'desktopBadge';
      badge.textContent = 'Windows 설치형 ADE';
      hero.querySelector('div')?.prepend(badge);
    }
  }

  function normalizeRequestUrl(input) {
    try {
      return new URL(typeof input === 'string' ? input : input?.url || String(input), window.location.href);
    } catch {
      return null;
    }
  }

  function replaceAudioWithOriginal(form) {
    if (!(form instanceof FormData)) return;
    if (String(form.get('provider') || '') !== 'local') return;

    if (originalAudioFile) {
      form.set('audio', originalAudioFile, originalAudioFile.name || 'debate-audio');
    }
    form.set('language', 'ko');
    form.set('profile', 'classroom');
    form.set('prompt', transcriptionPrompt());
  }

  async function desktopHealthResponse(response) {
    const data = await response.clone().json().catch(() => null);
    if (!data?.providers?.local) return response;

    const local = data.providers.local;
    local.evaluationReady = Boolean(local.ollama);
    // The desktop transcription worker and evaluation engine are independent.
    // Allow transcription whenever the packaged Faster-Whisper worker is ready.
    local.ready = Boolean(local.whisper);
    local.desktop = true;

    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  window.fetch = async function adeDesktopFetch(input, init = {}) {
    const url = normalizeRequestUrl(input);
    if (url?.pathname === '/api/transcribe' && String(init.method || 'GET').toUpperCase() === 'POST') {
      replaceAudioWithOriginal(init.body);
    }

    const response = await nativeFetch(input, init);
    if (url?.pathname === '/api/health' && response.ok) {
      return desktopHealthResponse(response);
    }
    return response;
  };

  installFileCapture();
  decorateDesktop();
})();
