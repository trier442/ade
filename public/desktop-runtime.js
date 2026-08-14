(() => {
  'use strict';

  if (!window.ADEDesktop?.isDesktop) return;

  const nativeFetch = window.fetch.bind(window);
  let originalAudioFile = null;
  let localEvaluationReady = false;
  let removeProgressListener = null;

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

  function showToast(message, duration = 5000) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), duration);
  }

  function installFileCapture() {
    const input = document.querySelector('#file');
    if (!input) return;
    input.addEventListener('change', event => {
      originalAudioFile = event.target?.files?.[0] || null;
    }, true);
  }

  function installEvaluationGuard() {
    const button = document.querySelector('#evaluateBtn');
    if (!button) return;
    button.addEventListener('click', event => {
      const provider = document.querySelector('#provider')?.value;
      if (provider === 'local' && !localEvaluationReady) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showToast('설치형 전사 엔진은 준비되었습니다. 로컬 평가 엔진은 다음 개발 단계에서 프로그램에 내장됩니다.');
      }
    }, true);
  }

  function modelManagerMarkup(status) {
    if (!status.engineInstalled) {
      return '<b>전사 엔진 오류</b><span>설치 파일에 전사 엔진이 없습니다. ADE를 다시 설치해 주세요.</span>';
    }
    if (status.modelInstalled) {
      return '<b>설치형 오프라인 모드 준비됨</b><span>Faster-Whisper large-v3 모델이 설치되어 있습니다. 원본 음성 파일을 로컬에서 직접 전사합니다.</span><span class="modelReady">● 모델 준비 완료</span>';
    }
    return '<b>large-v3 모델 설치 필요</b><span>최초 한 번 약 3GB의 전사 모델을 설치합니다. 완료 후에는 인터넷 없이 전사할 수 있습니다.</span><button id="installModel" class="primary" type="button">전사 모델 설치</button><span id="modelProgress" class="modelProgress">설치 전</span>';
  }

  async function refreshModelManager() {
    const guide = document.querySelector('#localGuide');
    if (!guide || typeof window.ADEDesktop.modelStatus !== 'function') return;

    try {
      const status = await window.ADEDesktop.modelStatus();
      guide.innerHTML = modelManagerMarkup(status);
      const button = document.querySelector('#installModel');
      if (!button) return;

      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = '모델 설치 중…';
        const progress = document.querySelector('#modelProgress');
        if (progress) progress.textContent = '다운로드를 준비하고 있습니다.';
        try {
          await window.ADEDesktop.downloadModel();
          if (progress) progress.textContent = '설치 완료. 프로그램을 새로 고칩니다.';
          showToast('large-v3 모델 설치가 완료되었습니다.');
          setTimeout(() => window.location.reload(), 1000);
        } catch (error) {
          button.disabled = false;
          button.textContent = '전사 모델 다시 설치';
          if (progress) progress.textContent = error.message || '모델 설치 실패';
          showToast(error.message || '모델 설치에 실패했습니다.', 8000);
        }
      });
    } catch (error) {
      guide.innerHTML = `<b>모델 상태 확인 실패</b><span>${String(error.message || error)}</span>`;
    }
  }

  function installModelProgress() {
    if (typeof window.ADEDesktop.onModelProgress !== 'function') return;
    removeProgressListener = window.ADEDesktop.onModelProgress(event => {
      const progress = document.querySelector('#modelProgress');
      if (!progress) return;
      const message = event?.message || event?.stage || '모델 설치 중';
      progress.textContent = String(message).replace(/\s+/g, ' ').slice(-260);
    });
    window.addEventListener('beforeunload', () => removeProgressListener?.(), { once: true });
  }

  function decorateDesktop() {
    document.documentElement.classList.add('ade-desktop');
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
    localEvaluationReady = Boolean(local.ollama);
    local.evaluationReady = localEvaluationReady;
    // Transcription and evaluation are independent in the desktop build.
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
  installEvaluationGuard();
  installModelProgress();
  decorateDesktop();
  refreshModelManager();
})();
