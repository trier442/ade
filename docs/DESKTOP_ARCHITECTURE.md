# ADE Desktop 전환 설계

## 목표

기존의 PowerShell·Node.js·Ollama·localhost 실행 절차를 사용자가 직접 다루지 않도록 하고, Windows에서 일반 프로그램처럼 설치·실행하는 오프라인 토론 수행평가 도구를 만든다.

최종 사용 흐름은 다음과 같다.

1. `ADE-Setup.exe` 설치
2. 바탕화면의 **ADE 토론 평가기** 실행
3. 녹음 또는 음성 파일 선택
4. 찬성·반대·사회자 화자 확인
5. 입론·교차조사·최종변론 평가
6. 학생별 Word/PDF 수행평가표 저장

## 데스크톱 구성

### 1. 화면 및 설치 프로그램

- Electron 기반 Windows x64 애플리케이션
- 기존 ADE 웹 UI를 데스크톱 창 안에서 재사용
- electron-builder NSIS 설치형과 Portable 실행형 제공
- 내부 백엔드는 사용자에게 주소나 콘솔을 노출하지 않고 자동 실행·종료

### 2. 음성 전사

최종 배포판에서는 브라우저 AudioContext와 단순 whisper.cpp 장문 전사에 의존하지 않는다.

- faster-whisper `large-v3-turbo`
- FFmpeg/PyAV 기반 오디오 디코딩
- 장문 파일 분할 및 겹침 병합
- 단어 단위 타임스탬프
- 보수적 VAD
- 전사문 직접 수정

### 3. 화자 분리

- sherpa-onnx 오프라인 speaker diarization
- 예상 화자 수를 사용자가 지정할 수 있도록 구성
- `SPEAKER_00`, `SPEAKER_01`, `SPEAKER_02`를 실제 이름에 한 번만 연결
- 찬성·반대·사회자 역할 지원
- 사회자 발언은 진행 구조 분석에는 사용하되 수행평가 점수에서는 제외

### 4. 로컬 평가

- llama.cpp 실행 환경 내장
- Qwen3-8B Q4_K_M GGUF 모델 사용
- 입론 40점, 교차조사 35점, 최종변론 25점의 세부 점수는 프로그램이 다시 합산
- 모든 평가 문장에 근거 발언 및 타임스탬프 연결
- 교사의 점수 수정 후 평가 문장 재생성 지원

### 5. 결과 문서

- 학생별 가정 발송용 Word 파일
- 교사용 종합평가표
- PDF 출력
- JSON 원본 보관
- 상대 학생의 점수와 우열은 개인 가정통신문에서 자동 제외

## 배포 형태

대용량 모델을 Git 저장소에 직접 넣지 않고 다음 두 형태로 제공한다.

### 일반 설치형

- `ADE-Setup.exe`: 프로그램 본체
- 첫 실행 시 모델 팩을 한 번 내려받음
- 설치 이후 인터넷 없이 사용 가능

### 완전 오프라인형

- `ADE-Setup.exe`
- `ADE-Full-ModelPack.7z`
- 두 파일을 같은 폴더에 두면 설치 프로그램이 모델을 자동 인식

예상 총 설치 용량은 약 7~10GB이며, 모델 선택에 따라 달라진다.

## 개발 단계

### 1단계 — 데스크톱 셸

- Electron 창
- 기존 백엔드 자동 기동
- NSIS/Portable 빌드

### 2단계 — 전사 엔진 교체

- faster-whisper sidecar
- 장문 전사 안정화
- 오디오 정규화

### 3단계 — 화자 분리

- sherpa-onnx diarization
- 사회자 포함 3인 이상 화자 매핑

### 4단계 — 평가 엔진 내장

- Ollama 의존 제거
- llama.cpp + Qwen3 GGUF

### 5단계 — 공식 평가 문서

- 학생별 DOCX/PDF 자동 생성
- 교사 수정·확정 화면

### 6단계 — 배포 및 업데이트

- Windows 설치형/Portable
- GitHub Releases 기반 앱 업데이트
- 대용량 모델 팩 별도 버전 관리
