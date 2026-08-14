# ADE Desktop Runtime

이 디렉터리는 Windows 설치형 ADE에 포함되거나 별도 모델 팩으로 설치되는 로컬 AI 실행 파일과 모델의 배치 위치입니다.

```text
runtime/
├─ transcriber/
│  ├─ ade-transcriber.exe
│  └─ _internal/                  # PyInstaller가 묶은 Faster-Whisper 실행 환경
├─ models/
│  └─ faster-whisper-large-v3/
│     ├─ model.bin
│     ├─ config.json
│     ├─ tokenizer.json
│     ├─ vocabulary.json
│     └─ preprocessor_config.json
├─ diarization/                   # 다음 단계: sherpa-onnx 화자 분리 엔진
└─ llm/                           # 다음 단계: llama.cpp + Qwen 평가 엔진
```

## 현재 구현

- `desktop/transcriber/ade_transcriber.py`: Faster-Whisper 기반 장문 한국어 전사 워커
- `scripts/desktop/build-transcriber.ps1`: Python 설치 없이 실행되는 `ade-transcriber.exe` 폴더 빌드
- `scripts/desktop/download-model-pack.ps1`: `Systran/faster-whisper-large-v3` 모델 팩 다운로드
- Electron 앱은 위 워커를 직접 호출하며 PowerShell·localhost Whisper 서버를 요구하지 않습니다.

## 배포 원칙

3GB가 넘는 모델 가중치는 Git 저장소에 커밋하지 않습니다. GitHub Actions의 수동 빌드에서 `include_model_pack`을 선택하거나, 별도 모델 팩 설치 과정에서 내려받습니다.
