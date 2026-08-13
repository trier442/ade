# ADE — AI Debate Evaluator

토론 녹음·영상 파일을 전사하고 실제 발언을 근거로 **입론 40점 · 교차조사 35점 · 최종변론 25점**을 평가하는 웹 기반 토론 평가기입니다.

ADE는 두 가지 평가 방식을 지원합니다.

- **무료 로컬 평가**: 선생님 Windows PC에서 `whisper.cpp + Ollama` 실행. 외부 AI API 사용료 없음.
- **OpenAI 정밀 평가**: OpenAI 화자 분리 전사와 평가 모델 사용. API 사용량에 따라 비용 발생.

## 평가 배점

| 영역 | 배점 |
|---|---:|
| 입론 | 40 |
| 교차조사 | 35 |
| 최종변론 | 25 |
| **합계** | **100** |

세부 루브릭은 `config/rubric.json`에서 관리합니다.

## 주요 기능

- 논제·수업 정보·찬반 참가자 입력
- 브라우저 마이크 녹음 및 음성/영상 파일 업로드
- 무료 로컬 Whisper 전사
- OpenAI 화자 분리 전사 선택 가능
- 전사 구간과 학생 이름 확인·매핑
- Ollama 또는 OpenAI를 이용한 100점 토론 평가
- 평가 항목별 실제 발언·타임스탬프 근거
- 핵심 쟁점, 강점, 개선점, 학생별 기여도 출력
- JSON 저장 및 인쇄

## 무료 로컬 모드 — Windows

Node.js 22 이상과 Ollama가 필요합니다.

### 1. 저장소 받기

```powershell
git clone https://github.com/trier442/ade.git
cd ade
```

이미 저장소를 받은 경우에는 다음 명령으로 최신 버전을 받습니다.

```powershell
git pull
```

### 2. Ollama 설치

Ollama가 설치되어 있지 않으면 PowerShell에서 공식 설치 명령을 실행합니다.

```powershell
irm https://ollama.com/install.ps1 | iex
```

### 3. 무료 AI 엔진 설치

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-windows.ps1
```

기본 설치값:

- 평가 모델: `qwen3:8b`
- 음성 전사: `whisper.cpp`
- Whisper 모델: `small` 다국어 모델

### 4. 실행

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-windows.ps1
```

브라우저에서 `http://localhost:3000`을 열고 **무료 로컬 평가**를 선택합니다.

자세한 설명은 [`docs/LOCAL_MODE.md`](docs/LOCAL_MODE.md)를 참고하세요.

## 무료 로컬 모드의 화자 확인

일반적인 교실 녹음처럼 여러 학생의 목소리가 하나의 마이크에 녹음된 한국어 단일 채널 파일은 1차 무료 버전에서 전사 후 화자를 확인하도록 설계했습니다.

- Whisper가 발언 구간과 내용을 자동 전사
- 각 발언 구간에 실제 학생 이름을 지정
- 지정된 화자 정보와 전사문을 Ollama 평가 모델에 전달
- 평가 결과를 고정 루브릭으로 서버가 다시 합산

향후 무료 화자 분리 엔진을 별도로 추가할 예정입니다.

## OpenAI 정밀 모드 로컬 실행

`.env`에 API 키를 설정합니다.

```env
DEFAULT_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize
OPENAI_EVAL_MODEL=gpt-5
```

그 다음 실행합니다.

```bash
npm start
```

## Render 배포

저장소 루트의 `render.yaml`을 이용해 Blueprint 방식으로 배포할 수 있습니다. Render 배포는 선생님 PC의 로컬 Whisper/Ollama에 접근할 수 없으므로 **OpenAI 모드가 기본값**입니다.

1. Render Dashboard에서 **New → Blueprint**를 선택합니다.
2. GitHub에서 `trier442/ade`를 선택합니다.
3. Branch가 `main`인지 확인합니다.
4. `OPENAI_API_KEY`를 비밀 환경변수로 입력합니다.
5. **Deploy Blueprint**를 실행합니다.

## 환경 변수

```env
# 무료 로컬
DEFAULT_PROVIDER=local
WHISPER_CPP_URL=http://127.0.0.1:8080
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b

# 선택: OpenAI 정밀 모드
OPENAI_API_KEY=
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize
OPENAI_EVAL_MODEL=gpt-5

PORT=3000
MAX_UPLOAD_MB=100
```

실제 API 키가 들어 있는 `.env`, `.env.local`은 GitHub에 올리지 않습니다. Whisper 바이너리와 모델을 저장하는 `.local-tools/`도 Git에서 제외합니다.

## 처리 흐름

1. 논제와 참가자 입력
2. 녹음 또는 파일 업로드
3. 선택한 엔진으로 전사
4. 화자·학생 이름 확인
5. 고정 루브릭으로 평가
6. 서버가 세부 점수를 다시 합산하여 총점 검증
7. 실제 발언·타임스탬프를 포함한 평가 결과 출력

## 개인정보 원칙

무료 로컬 모드에서는 음성과 평가 처리를 선생님 PC에서 수행할 수 있습니다. ADE MVP 자체는 업로드 원본을 별도 DB에 자동 저장하지 않습니다. 실제 학교·학원 운영 전에는 녹음 동의, 보관 기간, 접근 권한, 삭제 정책을 별도로 확정해야 합니다.
