---
description: Safety gates, overwrite blocking, metadata rules, and workspace integrity checks.
globs:
alwaysApply: true
---

## Module Relationship

- GATES_ALL: this module is the final execution gate.
- OVERRIDES: when another module conflicts with safety, this module wins.
- ENFORCED_BY: Claude Code PreToolUse/PostToolUse hooks in `.claude/settings.json`
- REFERENCES: `arsenal/CLAUDE.md`

---

# HARNESS ENGINEERING

## [1] DEFINED_CRITICAL_ACTIONS

The following actions require explicit user approval before execution:

`DELETE_FILE` / `OVERWRITE_EXISTING` / `SEND_EMAIL` / `DEPLOY_CODE` / `EXECUTE_SHELL` / `MOVE_FILE`

### CEO 명시 승인 우회 (Bash hook 한정)

CEO 가 명시적으로 위험 명령 실행을 지시한 경우, Bash 명령 본문에 `CEO:OK` 토큰을 포함시켜 `compliance_auditor` 차단을 우회한다.

- **형식:** `rm important.md  # CEO:OK` 또는 `mv a b  # CEO:OK`
- **토큰 인식:** `\bCEO:OK\b` 정규식 일치 (대소문자 구분, 공백/구두점 경계)
- **감사 추적:** 우회 발생 시 `.claude/workspace_audit.log` 에 `{result: "BYPASS", bypass_reason: "CEO:OK_token", matched_pattern: ...}` 기록 — 차단 안 하지만 흔적은 남음
- **사용 원칙:** CEO 가 직접 "삭제해/지워/옮겨" 등 명시 지시한 경우에만 토큰 부착. 모델 자율 판단으로 토큰 부착 금지

### 자동 카브아웃 (토큰 불필요)

- `git rm`, `git mv` — git history 로 복구 가능하므로 위험 목록에서 자동 제외. BYPASS 감사 로그는 동일하게 기록

## [2] HARD ENFORCEMENT

Rules:

- `Write` may create a new file, but must not overwrite an existing file.
- `Edit` must be surgical and targeted.
- dangerous overwrite-style Bash patterns are blocked.
- large near-total rewrites through `Edit` are blocked.

These rules are enforced by hook scripts, not just by documentation.

## [3] WORKSPACE INTEGRITY

Harness protects the actual source workspace.

That means:

- final outputs belong in the active workspace
- naming and metadata must follow workspace rules
- AI_COMM handoff files do not replace workspace outputs

## [4] AI_COMM BOUNDARY

AI_COMM is not exempt from harness rules.

However, AI_COMM has a narrower role:

- store handoff context
- store result summaries
- preserve model continuity

AI_COMM should not silently become a high-privilege execution layer.

## [5] PRE-OUTPUT CHECKLIST

Before saving a final workspace output, confirm:

- the active workspace is correct
- the chosen agent team matches the task
- the output path belongs to the workspace
- naming and metadata are valid
- critical actions were not bypassed
- the right Arsenal tool was used when needed

## [6] METADATA AND NAMING

For workspace markdown outputs:

- use the workspace destination path
- use the required naming scheme
- use valid frontmatter fields and tags

Exceptions remain governed by the verifier scripts.

## [7] ENFORCEMENT SCRIPTS & SKILLS

Primary scripts (located in `arsenal/`):

- `compliance_auditor.js` — 전역 규정 준수 감사
- `verify_tasks.js` — 워크스페이스 산출물 검증
- `verify_edit_surgery.js` — 파일 수정 수술 적합성 검토
- `update_arsenal_permissions.js` — 도구 권한 자동 업데이트

`verify_tasks.js`, `verify_edit_surgery.js`, `update_arsenal_permissions.js`는 PostToolUse hook으로 자동 실행되며 (`compliance_auditor.js`는 PreToolUse), 별도 슬래시 커맨드는 두지 않습니다. 시스템 무결성 점검은 `/doctor`, 콘텐츠·인덱스 감사는 `/index`로 통합되어 있습니다.

## [8] DESIGN INTENT

Hames harness exists to keep the system:

- safe
- auditable
- workspace-consistent
- resistant to accidental overwrite or uncontrolled drift

## [9] WORKSPACE LOCK

파일 쓰기를 활성 워크스페이스로 강제하는 실시간 차단 레이어.

**관련 파일:**
- `.claude/.workspace_lock` — 현재 잠금 상태 (`{"workspace": "MyDomain", "locked": true}`)
- `.claude/workspace_paths.json` — 워크스페이스 이름 → 절대경로 매핑
- `.claude/hooks/workspace_guard.js` — PreToolUse 집행 스크립트
- `.claude/workspace_audit.log` — 차단/허용 이력 (런타임)

**동작 원칙:**
- Lock OFF: 모든 쓰기 통과
- Lock ON: 활성 워크스페이스 외부 Write/Edit/MultiEdit/NotebookEdit 차단
- 읽기(Read/Glob/Grep)는 lock 상태와 무관하게 항상 통과
- SYSTEM_ADMIN 경로(`arsenal/`, `ai_comm/`, `.claude/`)는 lock 무관 항상 허용
- Bash: 외부 워크스페이스 절대경로 + 쓰기 패턴 동시 탐지 시 차단 (best-effort)

**활성화:** `/lock <workspace>` 슬래시 커맨드
**해제:** "고정 해제" / "lock 해제" / "unlock" → 에이전트가 `.workspace_lock`을 `{"workspace": null, "locked": false}`로 업데이트

## [10] NEGATIVE CLAIM VERIFICATION

모델이 "변경 없음 / 비어있음 / 깨끗함 / 이상 없음 / 통과 / 일치 / 누락 없음" 같은 **부정형 결론**을 내릴 때 적용되는 글로벌 룰.

**원칙:** 부정형 주장은 모델이 가장 쉽게 hallucination으로 만드는 카테고리. 모델 자체 판단을 신뢰하지 않는다.

**규칙:**

1. 부정형 결론을 내리기 직전, 그 결론의 근거가 되는 명령(또는 스크립트)의 **raw 출력을 화면에 그대로 표시**한다.
2. 요약·재해석·줄임 금지. 원본 출력을 사용자가 동시에 눈으로 확인할 수 있게 한다.
3. raw 출력이 진짜로 비어있을 때만 부정형 결론을 낸다.
4. 외부 스크립트(`/doctor`, `/index`, `/handoff` 등)의 결과를 보고할 때도 동일 — 스크립트 raw 출력을 최소 1회 그대로 표시한 뒤에 요약한다.

**적용 대상:** 모든 슬래시 커맨드, 모든 검증 단계, 모든 단계별 분기 결정 지점.

**근거:** 본 모듈 [8] DESIGN INTENT — "resistant to accidental overwrite or uncontrolled drift". 부정형 거짓 보고는 silent drift의 가장 흔한 진입로.
