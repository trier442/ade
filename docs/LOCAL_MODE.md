# ADE 무료 로컬 모드

ADE의 무료 로컬 모드는 외부 유료 AI API 대신 **선생님 Windows PC에서 직접 음성 전사와 토론 평가를 실행**합니다.

## 구성

- 음성 전사: `whisper.cpp`
- 토론 평가: `Ollama` + 로컬 언어모델
- 기본 평가 모델: `qwen3:8b`
- 기본 Whisper 모델: `small` (다국어)
- ADE 웹앱: Node.js 22+

API 사용료는 발생하지 않습니다. 다만 모델 다운로드를 위한 인터넷 연결과 PC의 저장공간·연산 자원이 필요합니다.

## 1. 준비

Windows PowerShell을 사용합니다.

### Node.js

Node.js 22 이상이 필요합니다.

```powershell
node -v
```

### Ollama

Ollama가 설치되어 있지 않으면 공식 Windows 설치 방식으로 설치합니다.

```powershell
irm https://ollama.com/install.ps1 | iex
```

설치 후 Ollama가 실행 중인지 확인합니다.

```powershell
ollama --version
```

## 2. ADE 무료 엔진 설치

저장소 폴더에서 다음 명령을 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-windows.ps1
```

이 스크립트는 다음 작업을 수행합니다.

1. Node.js 버전 확인
2. `qwen3:8b` Ollama 모델 다운로드
3. 최신 Windows x64용 `whisper.cpp` 바이너리 다운로드
4. `ggml-small.bin` 다국어 Whisper 모델 다운로드
5. `.env.local` 생성

설치 파일과 Whisper 모델은 저장소의 `.local-tools` 아래에 보관되며 GitHub에는 올라가지 않습니다.

## 3. ADE 실행

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-windows.ps1
```

정상적으로 실행되면 브라우저에서 다음 주소가 열립니다.

```text
http://localhost:3000
```

화면의 **평가 방식**에서 `무료 로컬 평가`를 선택합니다.

## 4. 사용 순서

1. 논제와 참가자를 입력합니다.
2. 토론 녹음 파일을 선택하거나 브라우저에서 직접 녹음합니다.
3. `전사 시작`을 누릅니다.
4. 전사된 각 발언 구간의 학생 이름을 확인·지정합니다.
5. `평가 시작`을 누릅니다.
6. 입론 40점, 교차조사 35점, 최종변론 25점 결과를 확인합니다.

## 5. 현재 무료 모드의 화자 처리

일반적인 교실·학원 토론 녹음은 **한 개 마이크에 여러 학생의 목소리가 섞인 단일 채널 음성**인 경우가 많습니다. 현재 1차 무료 로컬 모드에서는 한국어 전사의 정확성을 우선하고, 전사 후 각 발언 구간에 학생 이름을 직접 지정하는 방식으로 운영합니다.

이는 평가 전에 한 번만 확인하면 되며, 지정된 학생 이름은 평가 입력에 그대로 반영됩니다.

향후 버전에서는 별도의 무료 화자 분리 모델을 추가하여 이 단계도 자동화할 예정입니다.

## 6. PC 사양에 따른 모델 조정

기본값은 다음과 같습니다.

```text
Ollama: qwen3:8b
Whisper: small
```

PC가 느리거나 메모리가 부족하면 평가 모델을 가볍게 바꿀 수 있습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-windows.ps1 -OllamaModel "qwen3:4b"
```

전사 품질을 더 높이고 PC 성능이 충분하다면 Whisper 모델을 `medium`으로 설치할 수 있습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-windows.ps1 -WhisperModel medium
```

## 7. OpenAI 정밀 모드와 병행

무료 로컬 모드를 설치해도 기존 OpenAI 모드는 삭제되지 않습니다.

- 무료 로컬 평가: 선생님 PC의 Whisper.cpp + Ollama 사용
- OpenAI 정밀 평가: OpenAI 화자 분리 전사 + OpenAI 평가 모델 사용

필요한 토론만 OpenAI 정밀 모드로 다시 평가할 수 있습니다.

## 8. Render 배포와의 차이

Render 서버에서는 선생님 PC의 `localhost`에 있는 Whisper.cpp와 Ollama에 직접 접근할 수 없습니다. 따라서 `render.yaml`은 OpenAI 모드를 기본값으로 사용합니다.

무료 로컬 모드는 Windows PC에서 ADE를 직접 실행할 때 사용합니다.
