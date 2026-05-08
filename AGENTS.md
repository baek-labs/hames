# HAMES SYSTEM CODEX ENTRY [STRATEGIC_OS — Redirect to CLAUDE.md]

> Created: 2026-05-05
> Codex CLI의 자동 로드 진입 파일. **단일 진실 출처는 `CLAUDE.md`**이다.

---

## Entry Redirect

이 워크스페이스의 모든 운영 규칙은 `CLAUDE.md`에 정의되어 있다.
시동 시 아래 6개 파일을 순서대로 읽어 컨텍스트를 구성한다:

1. `CLAUDE.md` (커널)
2. `.cursor/rules/prompt_engineering.md`
3. `.cursor/rules/context_engineering.md`
4. `.cursor/rules/agent_engineering.md`
5. `.cursor/rules/harness_engineering.md`
6. `arsenal/CLAUDE.md`

> Codex CLI는 `@import` 자동 펼침이 없다. `CLAUDE.md`의 `@경로` 라인을 보면 그 파일들도 명시적으로 추가 로드한다.

---

## ⚠ MANDATORY ENFORCEMENT

방어선 1/2의 단일 정의 위치는 `.cursor/rules/enforcement.md`다.
시동 시 위 6개 파일에 더해 **`enforcement.md`도 명시적으로 읽고** 그 안의 규칙을 따른다.

---

## Codex 전용 보충

- 시동 시 본 파일(`AGENTS.md`)이 자동 로드되며, 그 결과로 위 redirect를 수행해야 한다.
- `HamesSystem 적용` = 규칙 활성화 확인 트리거. 별도 스크립트 실행 없음.
- 자연어 트리거 해석은 `context_engineering.md` [2] CURRENT MODE 섹션의 단일 정의를 따른다.
- Windows PowerShell에서 한글/이모지 파일 내용을 출력하기 전에는 `arsenal/set_hames_utf8.ps1` 부트스트랩 적용을 우선한다. 적용 여부가 불명확하면 `Get-Content` 출력만으로 파일 손상을 판단하지 말고 UTF-8 명시 읽기 또는 verifier로 확인한다.

---

## Hard Constraints (요약 — 상세는 `harness_engineering.md`)

- **Scope:** Hames root(`{{HAMES_ROOT}}`) 내부에서 작업. 외부 파일 수정 금지.
- **Critical Actions:** `DELETE_FILE`, `OVERWRITE_EXISTING`, `SEND_EMAIL`, `DEPLOY_CODE`, `EXECUTE_SHELL`, `MOVE_FILE` — 명시적 사용자 승인 필요.
- **Workspace Lock:** `.claude/.workspace_lock`이 ON일 때 lock된 워크스페이스 외부 쓰기 금지. Codex 환경에 hook이 미설치되어 있다면 모델 자율 준수로 동일 규칙 적용.
- **Verifier:** 산출물은 verifier 통과 전 정식 완료로 간주하지 않음.

---

## 핸드오프 처리

- `ai_comm/Memory/.hames_start_codex.md`는 핸드오프/재개 부트스트랩이다. 기본 작업 소스가 아니다.
- 사용자가 handoff/resume 연속성을 명시적으로 요청하거나, 파일에 `Session lock: ON`이 명시된 경우에만 읽고 적용한다.
- `Session lock: ON` 명시 시 active workspace/agent/task를 현재 세션의 최우선 입력으로 고정한다.
- `Session lock: OFF` 또는 누락 시 일반 명령에서는 부트스트랩을 읽거나 적용하지 않는다. 사용자 지시와 현재 커맨드 라우팅이 우선이다.
- 오래된 부트스트랩 task 문구가 `/lock`, `HamesSystem 적용`, 일반 워크스페이스 명령에 개입하면 안 된다.

---

## Activation 흐름

```
Codex CLI 시동
  ↓
AGENTS.md 자동 로드 (이 파일)
  ↓
CLAUDE.md → 4개 룰 모듈 → arsenal/CLAUDE.md 명시적 추가 로드
  ↓
HamesSystem 활성화 완료
  ↓
사용자 task 처리 시작
```
