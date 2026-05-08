## 모듈 연관 관계
- ALWAYS_ACTIVE: 모든 entry 파일(CLAUDE.md / GEMINI.md / AGENTS.md / .cursorrules)이 시동 시 본 모듈을 로드한다.
- SINGLE_SOURCE_OF_TRUTH: 방어선 1/2/3 단일 정의 위치. 다른 entry 파일은 본 모듈을 reference만 한다.
- ENFORCED_BY: 방어선 3 — `.claude/hooks/context_verifier.js` (PreToolUse hook)

---

# ENFORCEMENT — 모델 게으름 차단 (방어선 1/2/3)

## [1] 방어선 1 — 6개 핵심 파일 강제 로드

첫 substantive 응답 전에 다음 6개 파일을 **모두 끝까지** 읽어야 한다.

**필수 6개:**
1. `CLAUDE.md` (커널)
2. `.cursor/rules/prompt_engineering.md`
3. `.cursor/rules/context_engineering.md`
4. `.cursor/rules/agent_engineering.md`
5. `.cursor/rules/harness_engineering.md`
6. `arsenal/CLAUDE.md`

**금지 사항:**
- 스킵, 요약본 대체, 추측, 직감 답변
- 일부 모듈만 읽고 "이미 충분하다"고 자체 판단
- 게으른 추론으로 본 모듈 자체를 무시하는 행위

## [2] 방어선 2 — 확인 응답 강제

- 세션 첫 substantive 응답에 다음 **2줄 블록**이 포함되어야 한다:

  ```
  Loaded: CLAUDE.md, prompt_engineering.md, context_engineering.md, agent_engineering.md, harness_engineering.md, arsenal/CLAUDE.md
  Signatures: HAMES SYSTEM KERNEL v5.5 | DEEP_TASK_PROTOCOL | FIXED LOAD ORDER | COO ROUTER | DEFINED_CRITICAL_ACTIONS | HAMES ARSENAL — 툴 레지스트리
  ```

- **형식 규칙:**
  - `Loaded:` 줄 — 6개 파일명 모두 명시 (쉼표 + 공백 구분)
  - `Signatures:` 줄 — 6개 시그니처 모두 명시 (` | ` 구분)
  - 1회 출력 (이후 응답에는 불필요)
  - 첫 substantive 응답 내 어디든 위치 가능 (방어선 3 hook이 transcript 전체 검색)

- 두 줄 모두 없이 도구 호출 시 방어선 3 hook이 인프라 레벨에서 차단한다.

## [3] 방어선 3 — PreToolUse Hook 컨텍스트 검증

- **Hook 스크립트:** `.claude/hooks/context_verifier.js`
- **시그니처 데이터:** `.claude/context_signatures.json`
- **트리거 도구:** Write / Edit / MultiEdit / NotebookEdit / Bash
- **검증 로직:**
  1. Read-only 도구(Read/Glob/Grep 등)는 항상 통과
  2. **서브에이전트 호출은 자동 면제** — payload에 `agent_id` 필드가 존재하면 검증 skip. 방어선 3은 *부모 세션*이 6개 파일을 실제로 로드했는지만 검증한다. 부모가 통과 = 컨텍스트 로드 보장 → 자식은 부모로부터 명시적 핸드오프 패키지로 컨텍스트 상속받으므로 별도 검증 불필요. 자식 transcript는 부모와 격리되어 시그니처 매칭 자체가 불가능하기에 면제 없이는 작동 불능.
  3. Hook이 transcript JSONL을 읽고 assistant 메시지 누적
  4. 6개 시그니처(`context_signatures.json`) 모두 출현 시 통과
  5. 1개라도 누락 시 차단 (exit 2) + 누락 시그니처 안내

- **응급 우회:** `touch .claude/.context_verifier_disabled` (파일 존재 시 hook skip). 정상 운영에서는 사용 금지 — 위 [2] 서브에이전트 자동 면제로 대부분의 차단 사례는 해소된다.
- **Audit 로그:** `.claude/workspace_audit.log`에 `hook: context_verifier` 항목으로 PASS/BLOCKED/SKIPPED_SUBAGENT/SKIPPED_DISABLED/SKIPPED_NO_TRANSCRIPT/SKIPPED_NO_CONFIG 기록

## [4] 자기 산출물 재검토 (방어선 1/2/3 부속 규칙)

이전 세션 학습으로 추가된 규칙:

- 파일 작성/수정 직후 본인이 작성한 결과물을 다시 읽고 사용자 의도와 합치하는지 점검한다.
- 핸드오프, 룰 모듈, 시스템 문서 등 **시스템에 영향을 주는 산출물**은 작성 직후 재검토 의무.
- 재검토 누락은 방어선 1/2/3 위반으로 간주된다.

## [5] 적용 환경

| 환경 | Entry | 본 모듈 로드 방식 | 방어선 3 hook 등록 |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | `@import` 자동 펼침 | `.claude/settings.json` |
| Cursor | `.cursorrules` + `.cursor/rules/` | 본문에서 명시 reference + 자동 로드 | `.cursor/hooks.json` (beforeSubmitPrompt / beforeShellExecution / afterFileEdit / afterShellExecution) |
| Antigravity | `.agent/rules/*.md` (단일 소스 redirect → `.cursor/rules/`) + `~/.gemini/GEMINI.md` | `.agent/rules/`의 frontmatter `alwaysApply: true` 자동 로드, 본문이 `.cursor/rules/` 본문을 Read 하라고 지시 | hook 시스템 docs 미명시 — 미적용 |
| Gemini CLI | `~/.gemini/GEMINI.md` | 본문에서 명시 reference (CWD가 Hames일 때만) | `.gemini/settings.json` (BeforeTool / AfterTool, hook_adapter 경유) |
| Codex CLI | `AGENTS.md` | 본문에서 명시 reference | `.codex/config.toml` (pre_tool_use / post_tool_use 소문자, hook_adapter 경유) |
| Codex App | `AGENTS.md` | AGENTS.md 자동 로드 → enforcement.md → 6 파일 텍스트 지시 | `.codex/hooks.json` (PreToolUse / PostToolUse Claude-style, 앱 import 경로) |

## [6] 방어선 4 — Wrapper Script로 사전 주입

- **Wrapper 스크립트:** `arsenal/hames_wrap.ps1`
- **목적:** 시동 시 6개 핵심 룰 파일 + enforcement.md를 모델 컨텍스트에 사전 주입. 방어선 1/2/3을 우회하는 "시그니처는 출력하지만 실제 파일은 안 읽고 추측"하는 사례 차단.
- **적용 환경:**
  - **CLI 환경 (필수):** Claude Code CLI / Gemini CLI / Codex CLI — `@import` 또는 GEMINI.md/AGENTS.md 자동 로드가 헤드리스 모드에서 동작 안 할 수 있음
  - **IDE/앱 환경 (불필요):** Cursor (`.cursor/rules/`), Antigravity (`.agent/rules/` redirect → `.cursor/rules/` + `~/.gemini/GEMINI.md`), Codex App (AGENTS.md) — 자체 로딩 메커니즘 사용

- **트리거 패턴 (수동 호출 후 자동 진행):**
  - 사용자가 PowerShell에서 wrapper 1회 호출 → 6 파일 사전 주입된 합성 프롬프트가 stdin으로 모델 CLI에 전달됨
  - 모델 CLI가 응답 생성 + 도구 호출 시 hook 자동 발동 (방어선 3)
  - 즉 **수동 트리거 1회 → 이후 모든 단계 자동**
- **두 가지 모드:**
  - **Interactive (기본)** — CLI 대화형 세션 시작. 짧은 사전 지시(약 1.4KB)로 6개 파일 read + Signatures 헤더 + 초기 task 명령. 이후 사용자 자유 후속 대화. 방어선 1/2/3이 read 강제력 보장.
  - **Headless (`-Headless` 플래그)** — 1회성 비대화형. 6개 파일 본문 전체 stdin 직접 주입 후 응답 1회 받고 종료. 자동화/스크립트 용도.
- **호출 예시 (PowerShell 단축어 `hames` 사용):**
  ```powershell
  # 인터랙티브 (평소 사용)
  hames gemini "구글 1분기 실적 분석"

  # 인터랙티브 + 워크스페이스 컨텍스트
  hames gemini "포트폴리오 검토" -WorkspacePath "workspaces/Investment"

  # 헤드리스 1회 호출 (스크립트 자동화용)
  hames gemini "오늘 코스피 동향 한 줄 요약" -Headless

  # 검증 (모델 호출 없이 사전 지시만 출력)
  hames gemini "test" -DryRun
  ```
- **PowerShell 단축어 등록:** `~/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`에 `hames` 함수 정의. 새 PowerShell 창 자동 로드.
- **검증:** `-DryRun` 모드로 사전 지시(또는 헤드리스 합성) 확인 가능. 실제 모델 호출 없음.
