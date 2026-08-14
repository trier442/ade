# ADE Desktop Runtime

이 디렉터리는 Windows 데스크톱 빌드에 포함되는 로컬 AI 실행 파일과 모델 팩의 배치 위치입니다.

최종 배포 구조:

```text
runtime/
├─ asr/          # faster-whisper 실행 환경 및 Whisper large-v3-turbo 모델
├─ diarization/  # sherpa-onnx 화자 분리 실행 환경과 모델
├─ llm/          # llama.cpp 실행 파일
├─ models/       # Qwen3-8B GGUF 평가 모델
└─ ffmpeg/       # 오디오 변환 및 정규화 도구
```

대용량 모델 파일은 Git 저장소에 직접 커밋하지 않습니다. 빌드 과정 또는 별도 모델 팩 제작 과정에서 이 위치에 배치합니다.
