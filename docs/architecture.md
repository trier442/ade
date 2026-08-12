# ADE 아키텍처 메모

## MVP 구조

```text
브라우저
  ├─ 참가자/논제 입력
  ├─ MediaRecorder 녹음
  ├─ 파일 업로드
  ├─ Speaker ↔ 학생 이름 매핑
  └─ 평가 결과 렌더링
        │
        ▼
Node.js 22 서버
  ├─ POST /api/transcribe
  │    └─ OpenAI Audio Transcriptions
  │       gpt-4o-transcribe-diarize
  │       response_format=diarized_json
  │       chunking_strategy=auto
  │
  ├─ POST /api/evaluate
  │    └─ OpenAI Responses API
  │       고정 rubric.json + 전사문
  │
  └─ GET /api/rubric, /api/health
```

## API 키 보안

브라우저 JavaScript에 API 키를 넣으면 개발자 도구와 네트워크 요청을 통해 노출될 수 있습니다. 모든 OpenAI 호출은 서버에서만 실행합니다.

## 평가 일관성을 높이는 장치

1. 루브릭을 `config/rubric.json` 한 파일에 고정합니다.
2. 모든 세부 점수에는 실제 전사문 증거를 요구합니다.
3. 확인할 수 없는 억양·시선·자세 등의 요소를 추정하지 않습니다.
4. AI가 반환한 총점을 그대로 믿지 않고 서버가 세부 점수를 다시 합산합니다.
5. 찬성/반대 모두 동일한 항목과 배점을 강제합니다.
6. 추후 기준 토론 샘플과 교사 정답 점수를 만들어 모델/프롬프트 변경 때 회귀 평가를 실시합니다.

## Phase 2

실제 학원·학교 운영에서는 긴 녹음과 동시 평가를 고려해 Object Storage + Queue + Worker + DB 구조로 확장합니다.

```text
웹 프런트
  ├─ 녹음 파일 → Object Storage
  └─ 평가 작업 생성
           │
           ▼
        작업 Queue
           │
           ▼
      Worker / Backend
      ├─ 전사
      ├─ 화자 매핑 대기
      ├─ 평가
      └─ 결과 DB 저장
```

## 데이터 모델 초안

- `users`: 교사 계정
- `classes`: 반/수업
- `students`: 학생
- `debates`: 논제, 일시, 진행 방식
- `participants`: 토론과 학생, 찬반, 역할 연결
- `recordings`: 원본 녹음 저장 위치/상태
- `transcript_segments`: start, end, speaker, student_id, text
- `evaluations`: 모델, 루브릭 버전, 총점, 생성 시점
- `criterion_scores`: 평가 기준별 점수, 판단, 개선점
- `evidence`: criterion_score와 transcript_segment 연결

## 평가 버전 관리

평가 결과에는 rubric version, prompt version, transcription model, evaluation model, 생성 시각, 전사문 hash를 함께 저장하는 구조로 확장합니다.
