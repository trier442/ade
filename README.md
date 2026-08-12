# ADE — AI Debate Evaluator

토론 녹음·영상 파일을 화자별로 전사하고, 실제 발언과 타임스탬프를 근거로 **입론 40점 · 교차조사 35점 · 최종변론 25점**을 평가하는 웹 기반 AI 토론 평가기입니다.

## MVP 기능

- 논제·수업 정보·찬반 참가자 입력
- 브라우저 마이크 녹음 및 음성/영상 파일 업로드
- OpenAI `gpt-4o-transcribe-diarize` 기반 화자 분리 전사
- Speaker ↔ 실제 학생 이름 매핑
- 찬성·반대 팀별 100점 평가
- 평가 항목별 실제 발언·타임스탬프 근거 제시
- 핵심 쟁점, 강점, 개선점, 학생별 기여도 출력
- JSON 결과 저장 및 인쇄

## 평가 배점

| 영역 | 배점 |
|---|---:|
| 입론 | 40 |
| 교차조사 | 35 |
| 최종변론 | 25 |
| **합계** | **100** |

세부 루브릭은 `config/rubric.json`에서 관리합니다.

## 로컬 실행

Node.js 22 이상이 필요합니다.

```bash
cp .env.example .env
# .env에 OPENAI_API_KEY 입력
npm start
```

브라우저에서 `http://localhost:3000`을 엽니다.

## Render 배포

저장소 루트의 `render.yaml`을 이용해 Blueprint 방식으로 배포할 수 있습니다.

1. Render Dashboard에서 **New → Blueprint**를 선택합니다.
2. GitHub 계정을 연결하고 `trier442/ade` 저장소를 선택합니다.
3. Blueprint 이름은 `ade`로 지정합니다.
4. Branch가 `main`인지 확인합니다.
5. `OPENAI_API_KEY` 입력란에 실제 OpenAI API 키를 입력합니다.
6. **Deploy Blueprint**를 실행합니다.
7. 배포가 끝나면 생성된 `*.onrender.com` 주소로 접속합니다.

현재 Blueprint 기본값:

- Runtime: Node
- Region: Singapore
- Plan: Free (MVP 테스트용)
- Build: `npm install`
- Start: `npm start`
- Health check: `/api/health`
- `main` 커밋 시 자동 재배포

> 실제 API 키는 `render.yaml`이나 GitHub 소스에 기록하지 않습니다. `OPENAI_API_KEY`는 Render의 비밀 환경변수로만 입력합니다.

## 환경 변수

```env
OPENAI_API_KEY=
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize
OPENAI_EVAL_MODEL=gpt-5
PORT=3000
MAX_UPLOAD_MB=100
```

> 실제 API 키가 들어 있는 `.env` 파일은 GitHub에 올리지 않습니다.

## 처리 흐름

1. 논제와 참가자 입력
2. 녹음 또는 파일 업로드
3. 화자 분리 전사
4. Speaker를 학생 이름에 연결
5. 고정 루브릭으로 AI 평가
6. 서버가 세부 점수를 다시 합산하여 총점 검증
7. 실제 발언·타임스탬프를 포함한 평가 결과 출력

## 개인정보 원칙

MVP는 업로드된 원본 파일을 서버 디스크나 DB에 자동 저장하지 않습니다. 실제 학교·학원 운영 전에는 녹음 동의, 보관 기간, 접근 권한, 삭제 정책을 별도로 확정해야 합니다.
