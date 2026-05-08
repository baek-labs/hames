# Hames System

> Version: 5.5 [STRATEGIC_OS] | Last Updated: 2026-05-09

> **Reading order:** This file is a **narrative overview** — read it to grasp the whole system in one pass. For technical reference (per-module deep-dive, hook tables, spawn protocol details), see `docs/01_philosophy.md` through `docs/06_agent_architecture.md` and `docs/glossary.md`.
>
> The runtime sources of truth are `CLAUDE.md`, `.cursor/rules/*`, each workspace's `CLAUDE.md`/`AGENTS.md`, and the hook/config files.

---

## 1) 한 줄 정의

**Hames System**은 운영자(Operator)가 여러 AI 모델을 하나의 운영 원칙 아래에서 쓰기 위해 만든 **개인용 AI 운영체계**다.

Claude, Gemini, Codex를 따로따로 쓰는 것이 아니라, 같은 규칙, 같은 작업 구역, 같은 검증 절차 안에서 움직이게 만든다. 목표는 단순히 AI에게 일을 시키는 것이 아니라, AI가 반복적으로 좋은 결과를 내도록 **일하는 환경 자체를 설계**하는 것이다.

---

## 2) 왜 만들었는가

일반적인 AI 사용은 세션마다 품질이 흔들리기 쉽다. 모델이 바뀌면 말투와 판단 기준이 바뀌고, 작업 폴더가 섞이면 맥락이 오염되며, 파일 수정이나 쉘 실행 같은 위험한 작업은 실수로 이어질 수 있다.

Hames는 이 문제를 아래 방식으로 해결한다.

1. 모델이 달라도 같은 글로벌 룰을 읽게 한다.
2. 업무 영역을 워크스페이스로 분리해 컨텍스트 오염을 막는다.
3. COO Router가 요청을 해석하고 적절한 워크스페이스와 에이전트 팀을 선택한다.
4. 멀티 에이전트 팀이 역할을 나누어 병렬적이고 전문적으로 작업한다.
5. Harness가 위험 작업과 산출물을 검증한다.
6. 모델 전환이 필요할 때만 AI_COMM을 사용해 맥락을 handoff한다.

즉, Hames는 AI를 "똑똑한 채팅창"이 아니라 **운영 가능한 팀 시스템**으로 다루기 위한 구조다.

---

## 3) 핵심 철학

### 3.1 Manual Activation (운영자 수동 트리거)

Hames는 자동으로 모든 것을 실행하는 시스템이 아니다. 사용자가 명시적으로 `HamesSystem 적용`이라고 말하면 규칙 활성화를 확인한다.

- `HamesSystem 적용`: 규칙 활성화 확인만 수행
- 스크립트 실행 없음
- 파일 생성 없음
- 기본 상태는 `Session lock: OFF`

이 설계는 의도적이다. AI가 마음대로 모드를 바꾸거나, 세션을 고정하거나, handoff 파일을 만들지 못하게 하기 위해서다.

### 3.2 Advisory by Default, Lock by Intent

기본은 유연한 advisory 모드다. 강한 고정은 사용자가 `고정`을 명시했을 때만 적용한다.

- `<Workspace> 모드로`: 워크스페이스 전환만 수행
- `<Workspace> 모드로 고정`: 워크스페이스와 세션 고정
- `고정 해제`: 현재 맥락은 유지하되 lock 해제

핵심 규칙은 단순하다. `고정`이라는 의도가 없으면 절대 lock을 켜지 않는다.

---

## 4) 전체 구조

Hames는 6개 레이어로 구성된다.

| Layer | 역할 |
|---|---|
| Kernel | 모든 모델이 공유하는 최상위 운영 규칙 |
| Rules | Prompt, Context, Agent, Harness 세부 규칙 |
| COO Router | 요청을 해석하고 작업 방향을 결정하는 라우터 |
| Workspace | 업무 영역별 격리 실행 공간 |
| Multi-Agent Orchestration | 에이전트 팀 기반 실행 구조 |
| Harness | 위험 작업과 산출물 검증 장치 |

기본 실행 흐름은 아래와 같다.

`User Task -> COO Router -> Workspace Mode -> Agent Team -> Execute in Workspace -> Harness Validation`

모델 전환이 필요할 때만 아래 흐름을 사용한다.

`Workspace -> AI_COMM -> Next Model -> Same Workspace`

---

## 5) Kernel과 글로벌 룰

Hames의 중심은 루트 `CLAUDE.md`다. 이 파일은 Hames의 커널이며, 세부 규칙은 `.cursor/rules/*.md`로 분리되어 있다.

글로벌 룰 우선순위는 아래 순서로 적용한다.

1. `CLAUDE.md`
2. `.cursor/rules/*.md`
3. 각 워크스페이스 문서

이 구조의 목적은 큰 규칙을 한 파일에 모두 넣어 토큰을 낭비하지 않고, 필요한 세부 규칙만 단계적으로 읽게 하는 것이다.

---

## 6) 멀티 모델 운영

Hames는 여러 AI 클라이언트를 같은 시스템 안에 넣는다.

| 환경 | 진입점 | Hook 위치 | 비고 |
|---|---|---|---|
| Claude Code (CLI) | `CLAUDE.md` (`@import` 자동 펼침) | `.claude/settings.json` | 메인 작업 환경, 풀 hook 시스템 |
| Cursor IDE | `.cursorrules` + `.cursor/rules/` 자동 로드 | `.cursor/hooks.json` | 모델 무관 (Claude/Gemini 등 어떤 모델로도 사용) |
| Antigravity (Gemini IDE) | `.agent/rules/*.md` redirect → `.cursor/rules/` 본문 | (hook 시스템 없음) | Gemini 기반 IDE, 룰만 적용 |
| Codex App | `AGENTS.md` 자동 로드 → enforcement.md | `.codex/hooks.json` (Claude-style) | Codex 데스크톱 GUI, skills + sub-agent runtime |
| Gemini CLI | `~/.gemini/GEMINI.md` (CWD가 Hames일 때만) | `.gemini/settings.json` (BeforeTool/AfterTool) | 터미널, wrapper 권장 |
| Codex CLI | `AGENTS.md` | `.codex/config.toml` (pre_tool_use/post_tool_use 소문자) + `[agents.<name>]` 16개 등록 | 터미널, repo-root 기반 hook command |

모델마다 능력과 인터페이스는 다르지만, Hames 안에서는 같은 원칙을 따른다. 룰 모듈은 `.cursor/rules/`에 단일 소스로 보존하고, 다른 환경은 redirect나 자동 로드로 동일 룰을 공유한다. 모델이 바뀌어도 업무 구역, 위험 작업 기준, handoff 방식이 유지된다.

---

## 7) 멀티 에이전트 팀

Hames는 단일 페르소나 시스템이 아니다. 실제 운영 단위는 **Agent Team**이다.

기본 에이전트 팀 — Level 1(도메인) + Level 2(전문 sub-agent) 2단 구조:

| Level 1 | 도메인 | Level 2 파이프라인 |
|---|---|---|
| **CFO** | 투자, 재무, 비용, 숫자 판단 | cfo_analyst → cfo_auditor (분석 → VETO 게이트) |
| **CSO** | 전략, 의사결정, 우선순위 | cso_analyst → cso_planner (해석 → 플래닝) |
| **CBO** | 브랜드, 콘텐츠, 내러티브 | cbo_writer → cbo_auditor (생성 → 게이트) |
| **CTO** | 코드, 시스템, 자동화 | cto_architect → cto_coder → cto_reviewer (3-stage) |
| **Marketer** | 콘텐츠, SEO, 메시지, 채널 전략 | marketer_hunter → marketer_executor (인텔리전스 → 실행) |
| **Hames COO** | 요청 해석, 라우팅, 작업 안정화 | (직접 처리, 위임 결정) |

총 16개 sub-agent 정의 (Claude `.claude/agents/*.md`, Codex `.codex/agents/*.toml` + `.codex/config.toml` 등록). Codex 쪽 TOML은 `name`, `description`, `developer_instructions` 필수 키 기준으로 검증했고, 실제 `CFO` agent spawn까지 확인했다.

각 Level 2는 격리된 컨텍스트로 spawn되어 자기 시스템 프롬프트와 도구 권한을 갖는다. 특히 `_auditor` 류는 VETO 권한을 가져 같은 두뇌가 자기 작업을 비판하지 않는 구조를 유지한다.

워크스페이스는 특정 에이전트에 묶이지 않는다. 예를 들어 투자 워크스페이스에서도 CTO가 자동화 코드를 볼 수 있고, 비즈니스 워크스페이스에서도 CFO가 가격과 마진을 검토할 수 있다.

핵심은 `workspace + Level 1 agent + Level 2 sub-team` 조합이다.

---

## 8) 워크스페이스 격리

Hames는 업무를 워크스페이스로 나누어 컨텍스트 오염을 줄인다.

| Workspace | 경로 | 목적 |
|---|---|---|
| INVEST | `workspaces/Investment` | 투자 분석, 자산 관리, 시장 리서치 |
| BUSINESS | `workspaces/Business` | 개인사업, 세일즈, 패키징, 운영 |
| COMPANY | `workspaces/Company` | 회사 업무, 프로젝트, 보고 |
| HOBBY | `workspaces/Hobby` | 창작, 소설, 개인 프로젝트 |
| (선택) Isolated Domain | `<DomainRoot>/` | 자체 에이전트 팀·hook·트리거를 갖는 격리 도메인. 기본 설치엔 미포함. 패턴은 `docs/04_workspace_model.md` advanced 절 참조 |

작업은 원칙적으로 source workspace 안에서 끝난다. AI_COMM은 실행 공간이 아니며, 모델 간 handoff가 필요할 때만 사용한다.

---

## 9) Harness Engineering

Hames의 Harness는 AI가 잘못된 방향으로 움직이지 않도록 작업 환경에 안전장치와 검증 루프를 씌우는 구조다.

비개발자식으로 말하면, Harness는 AI 직원에게 주는 업무 매뉴얼이면서 동시에 검수 절차다. 어떤 파일을 건드려도 되는지, 위험 작업은 언제 승인이 필요한지, 작업 후 무엇을 확인해야 하는지를 정한다.

### 9.1 4중 방어선 — 모델 게으름 차단

AI는 "다 읽었다"고 말만 하고 실제로는 안 읽는 경우가 있다. Hames는 이를 막기 위해 4단계 방어선을 쌓는다.

- **방어선 1 — 텍스트 강제**: 모든 진입점(CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules)이 시동 시 핵심 룰 파일을 끝까지 읽으라고 명시한다. 운영상 로드 대상은 `CLAUDE.md` + 4개 룰 모듈 + `arsenal/CLAUDE.md` + `enforcement.md`다.
- **방어선 2 — 확인 응답 강제**: 모델은 첫 응답에 `Loaded: ...` + `Signatures: ...` 두 줄을 출력해야 한다. 현재 hook 검증 대상은 6개 시그니처이며, `enforcement.md`는 별도 필수 로드 규칙으로 적용한다.
- **방어선 3 — Hook 컨텍스트 검증**: `.claude/hooks/context_verifier.js` PreToolUse hook이 transcript를 스캔해서 6개 시그니처가 모두 있는지 확인. 하나라도 누락되면 Write/Edit/Bash를 인프라 레벨에서 차단(exit 2).
- **방어선 4 — Wrapper Script 사전 주입**: CLI 환경에서 `arsenal/hames_wrap.ps1`이 시동 시 모델에게 핵심 룰 read 지시를 사전 주입. 인터랙티브 모드는 짧은 사전 지시, Headless 모드는 핵심 파일 본문 전체를 주입한다.

방어선 1/2는 텍스트 약속이고, 3/4는 인프라 레벨 강제다. 두 층이 같이 있어야 모델이 우회를 못 한다.

### 9.2 핵심 검증 스크립트

**PreToolUse 체인 (실행 순서):**

- `.claude/hooks/context_verifier.js`: 방어선 3 시그니처 검증 — 6개 룰 파일 로드 미확인 시 Write/Edit/Bash 차단
- `.claude/hooks/workspace_guard.js`: 워크스페이스 lock 외부 쓰기 차단 (Lock ON 시)
- `arsenal/compliance_auditor.js`: 위험 작업 사전 점검 (overwrite, large edit, replace_all, dangerous bash 차단)
- `.claude/hooks/content_workflow_guard.js`: content pipeline phase gate (예: 영상/콘텐츠 워크플로) — script/prep → render/upload 무단 점프 차단. 로컬 `workflow/script_approved.json` / `render_approved.json` / `upload_approved.json` 게이트 파일 없으면 pipeline Bash 명령 실행 불가.
- `.claude/hooks/automation_workflow_guard.js`: automation pipeline phase gate (예: 영상 자동화 워크플로) — CP1(script) → CP2(render) → CP3(upload) 단계 강제. content_workflow_guard와 동일 gate 구조.
- `arsenal/verify_frontmatter_block.js`: Write 직전 frontmatter 블록 유효성 검증

**PostToolUse:**

- `arsenal/verify_edit_surgery.js`: 과도한 수정 방지 (수술적 Edit 강제)
- `arsenal/verify_tasks.js`: 산출물 규정 검증 (프론트매터, 푸터, 링크)
- `arsenal/update_arsenal_permissions.js`: 도구 권한 자동 갱신
- `arsenal/session_logger.js`: 세션 로그 기록

**SessionStart:**

- `.claude/hooks/session_capture.js`: Claude Code 세션 ID 자동 포착 → `.claude/sessions/<pid>.id` 저장. per-window 워크스페이스 lock이 어느 창에서 발동됐는지 추적하기 위한 식별자 기반 인프라. Claude Code 전용 (observability 목적).

**공용 인프라:**

- `.claude/hooks/hook_adapter.js`: Cross-CLI 입력 정규화 (Gemini/Codex/Cursor → Claude 형식)
- `arsenal/hames_wrap.ps1`: 방어선 4 시동 wrapper (인터랙티브/헤드리스 두 모드)
- `arsenal/sync_skills.ps1`: `.codex/skills` 정본 → `.agent/skills` 미러링, Codex hook surface 동기화

### 9.3 위험 작업 정의

위험 작업은 명시 승인 없이 진행하지 않는다.

- `DELETE_FILE`
- `OVERWRITE_EXISTING`
- `SEND_EMAIL`
- `DEPLOY_CODE`
- `EXECUTE_SHELL`
- `MOVE_FILE`

위 패턴이 감지되면 hook이 차단하거나 사용자에게 명시 승인을 요구한다.

---

## 10) 물리적 차단과의 차이

Hames는 Harness Engineering 시스템이다. 다만 OS 수준의 물리적 완전 차단 시스템은 아니다.

현재 Hames가 제공하는 인프라 레벨 차단:

- **시그니처 검증** — 모델이 6개 룰 파일 안 읽고 도구 호출 시도 시 Hook이 즉시 차단(exit 2). 단순 권고가 아니라 실제 BLOCK.
- **워크스페이스 쓰기 차단 (session-scoped)** — `/lock <workspace>` 활성화 시 `workspace_guard.js` PreToolUse Hook이 활성 워크스페이스 외부 파일 쓰기를 실제로 막는다. 읽기는 항상 허용, 공용 인프라(`.Arsenal`, `.claude`, `.codex`, `.gemini`, `.agents`)는 lock 무관 항상 열려 있음. `session_capture.js`가 각 Claude Code 창의 세션 ID를 포착해 lock을 창 단위(per-window)로 분리한다 — 창 A에서 건 lock이 창 B에 영향을 주지 않는다.
- **파이프라인 phase gate** — 격리 도메인의 production 명령(render, upload 등)을 실행하려면 로컬 gate 파일(`workflow/script_approved.json`, `render_approved.json`, `upload_approved.json`)이 있어야 한다. 없으면 `content_workflow_guard.js` / `automation_workflow_guard.js`가 Bash를 차단. Claude와 Codex 양쪽에서 동일 gate를 통과해야 한다.
- **Cross-CLI 정규화** — `hook_adapter.js`가 Gemini(BeforeTool/AfterTool)·Codex(pre_tool_use)·Cursor(beforeShellExecution/afterFileEdit) 입력을 Claude Code 형식으로 통일해서 같은 hook 스크립트가 어디서 발동하든 동일하게 작동하도록 함.
- **Codex hook surface 동기화** — `.codex/hooks.json`과 `.codex/config.toml`은 포맷이 다르지만 같은 managed hook command set을 공유한다. `/sync`가 두 파일을 repo-root 기반 경로로 정규화해 Codespaces에서도 깨지지 않게 한다.
- **exit 2 강제 BLOCK** — 모든 차단 hook이 exit 2 코드로 종료. Claude/Gemini/Codex 모두 이 코드를 BLOCK 신호로 인식.

이것은 OS 권한 분리나 컨테이너 샌드박스 수준은 아니다. 물리적 완전 차단은 파일시스템 권한, read-only mount, 전용 shell proxy, OS 계정 분리까지 가는 더 강한 단계다. AI가 시스템 자체를 우회하는 상황까지 막으려면 그 수준이 필요하다.

Hames의 목표는 보안 제품을 만드는 것이 아니라, 개인 AI 업무 시스템을 안정적으로 운영하는 것이다. Hook 수준 집행은 실수와 경계 이탈을 막기에 충분하며, 현재 설계는 **실용적 Harness Engineering**에 초점을 둔다.

**검증된 환경의 솔직한 범위**: Claude Code는 메인 hook 시스템이 실사용 기준으로 검증됐다. Codex는 `.codex/hooks.json`/`.codex/config.toml` JSON·TOML 파싱, 절대경로 제거, context verifier `exit 2` 차단, 16개 custom agent schema, `CFO` sub-agent runtime spawn까지 검증됐다. Cursor / Antigravity / Gemini CLI는 설정과 파일 배치는 완료되어 있고, 장기 실사용 검증은 계속 누적한다.

---

## 11) Handoff와 오염 방지

Hames에서 AI_COMM은 실행 공간이 아니다. AI_COMM은 모델을 바꿀 때만 사용하는 handoff 공간이다.

handoff에는 두 가지 형태가 있다.

**1. 모델 전환용 부트스트랩 (덮어쓰기)**

- Codex: `ai_comm/Memory/.hames_start_codex.md`
- Gemini: `ai_comm/Memory/.hames_start_gemini.md`

이 파일들은 handoff 시점의 최신 상태를 담기 위해 덮어쓴다. 이전 상태를 계속 누적하면 오히려 컨텍스트가 오염되기 때문이다.

**2. 세션 인수인계용 핸드오프 문서 (`SESSION-YYYYMMDD-X.md`)**

세션이 길어져 다음 세션으로 작업을 이어야 할 때 사용한다. `_Inbox` → `_Archive` 흐름.

- 작성: `ai_comm/_Inbox/Handoff_SESSION-2026-05-05-A.md`
- 작업 완료 후: `_Archive/`로 이동

핸드오프 본문은 다음을 담는다: task summary / current state / constraints / referenced files / open questions / next step. 슬래시 커맨드 `/handoff`로 작성하고 `/close-handoff`로 archive 이동.

중요한 구분:

- `HamesSystem 적용`: 규칙 활성화 확인, 파일 생성 없음
- `/handoff <model>`: 대상 모델용 부트스트랩 + 세션 핸드오프 문서 생성
- `/close-handoff`: 완료된 핸드오프를 `_Archive`로 정리

---

## 12) 실제 사용 예시

### 예시 1: 비즈니스 문서 작성

1. 사용자가 `HamesSystem 적용`이라고 말한다.
2. Hames는 글로벌 룰이 활성 상태임을 확인한다.
3. 사용자가 BUSINESS 관련 작업을 요청한다.
4. COO Router가 BUSINESS 워크스페이스를 선택한다.
5. CBO와 Marketer 팀이 오퍼, 가격, 메시지를 나누어 본다.
6. 결과물은 `workspaces/Business` 안에 작성된다.
7. 필요하면 Harness 검증 후 완료한다.

### 예시 2: 모델 전환

1. Claude가 작업하다가 Codex로 코드 작업을 넘겨야 한다.
2. Claude가 handoff를 명시적으로 생성한다.
3. `.hames_start_codex.md`가 최신 상태로 덮어써진다.
4. Codex는 해당 부트스트랩을 읽고 같은 워크스페이스에서 이어받는다.
5. AI_COMM은 작업장이 아니라 전달 메모 역할만 한다.

---

## 13) 이 시스템의 강점

Hames의 강점은 화려한 자동화가 아니라, AI가 반복적으로 일할 수 있는 운영 질서다.

1. 모델이 바뀌어도 기준이 유지된다 — 6환경(Claude Code, Cursor, Antigravity, Codex App, Gemini CLI, Codex CLI) 모두 같은 룰 모듈(`.cursor/rules/`)을 단일 소스로 공유한다.
2. 워크스페이스가 분리되어 컨텍스트 오염이 줄어든다.
3. 멀티 에이전트 팀(Level 1 도메인 5개 + Level 2 sub-agent 11개 = 총 16개)으로 전문성과 병렬성이 생긴다. `_auditor`류 VETO 게이트로 자기 작업 자기 비판 구조 방지.
4. 4중 방어선이 모델 게으름을 텍스트(1, 2)와 인프라(3, 4) 두 층에서 차단한다.
5. Hook 시스템이 위험 작업과 산출물을 자동 검증한다 — overwrite, large edit, replace_all, dangerous bash 등 사전 차단.
6. 반복 운영 작업은 슬래시 커맨드와 스킬로 추상화되어, 모델이나 클라이언트가 바뀌어도 같은 업무 의도로 실행할 수 있다.
7. handoff는 필요할 때만 발생하고, 최신 상태만 전달한다. SESSION 단위 인수인계로 긴 작업 보존.
8. 거대한 단일 지침 파일 대신 모듈형 룰을 사용해 토큰을 아낀다.

---

## 14) 현재 한계

Hames는 개인 AI 운영체계로 설계되었고, 보안 제품이나 완전한 샌드박스가 아니다.

### 14.1 설계상 한계 (의도된 범위)

- 모든 모델이 동일한 런타임 훅을 물리적으로 공유하는 것은 아니다. 각 환경별 hook 시스템에 등록하는 방식.
- CLI 환경의 wrapper(`hames_wrap.ps1`)는 사용자가 명시 호출해야 작동. 호출 없이 그냥 `gemini` 치면 wrapper 미적용.
- OS 권한 수준에서 모든 쓰기/삭제를 차단하는 구조는 아니다. Hook 회피 시 차단 못 함.
- Antigravity는 hook 시스템 docs에 명시 없음. 룰만 적용되고 hook 차단은 없음.

### 14.2 검증 일정 한계 (시간 문제)

본 시점에서 Claude Code와 Codex 계열은 핵심 경로 검증을 통과했다. Codex는 hook surface와 agent runtime까지 확인됐다. Cursor / Antigravity / Gemini CLI는 파일 배치와 룰 redirect는 끝났지만, hook/명령 런타임은 각 도구의 실제 사용 시점에 계속 검증한다.

이 한계는 실패가 아니라 설계 범위다. 현재 목표는 물리적 완전 차단이 아니라, 개인 업무에서 충분히 강력한 운영 통제와 검증 체계를 만드는 것이다.

---

## 15) 유지보수 원칙

Hames 문서는 이상적 비전이 아니라 현재 운영 사실을 기준으로 갱신한다.

문서 유지보수 규칙:

1. 런처, 가드, 검증 스크립트가 바뀌면 같은 날 반영한다.
2. `CLAUDE.md`, `GEMINI.md`, `HamesSystem_Public.md`의 용어를 맞춘다.
3. `Agent Frame` 같은 과거 용어가 남지 않게 한다.
4. AI_COMM은 handoff-only 원칙을 유지한다.
5. 날짜만 바꾸는 형식적 업데이트를 금지한다.
6. 룰 모듈은 `.cursor/rules/`에서만 수정 — 다른 환경(`.agent/rules/` 등)은 redirect라 건들지 않는다.

---

## 16) 운영 커맨드 — 반복 작업의 추상화

Hames는 자주 쓰는 반복 작업을 슬래시 커맨드와 SKILL.md 표면으로 추상화한다. 목적은 단순한 단축키가 아니라, 모델이 바뀌어도 같은 작업을 같은 절차로 시작하게 만드는 것이다.

아래는 대표 운영 커맨드다. 환경별 구현 형식은 각 클라이언트의 명령/스킬 시스템에 맞춰 다르지만, 운영 의도는 같은 표면으로 맞춘다. Codex 계열은 `.codex/skills/`를 정본으로 쓰고 Antigravity는 이를 미러링한다.

| 커맨드 | 역할 | 백엔드 |
|---|---|---|
| `/save` | Hames 루트 전체 변경분 커밋 → main push. 서브모듈 dirty/unpushed/upstream 미설정 감지 시 즉시 중단. 커밋 메시지 자동 생성. | git 명령 묶음 |
| `/subpush <submodule> [msg]` | 서브모듈 push + Hames gitlink 갱신 + Hames push 자동화 | git 명령 묶음 |
| `/sync [--dry-run]` | Codex 스킬 정본과 Antigravity 미러 동기화 + Gemini CLI TOML 커맨드 누락 검증/생성 + Codex hook surface 정규화 | `sync_skills.ps1` |
| `/lock <workspace>` | 워크스페이스 lock 활성화 | `.claude/.workspace_lock` 갱신 + workspace_guard hook |
| `/doctor` | HamesSystem 무결성 점검 (권한·Arsenal 레지스트리·룰 모듈·워크스페이스 격리) | `hames_doctor.py` |
| `/index` | 워크스페이스 콘텐츠 품질 + 인덱스 무결성 감사 | `manager.py` |
| `/handoff` | 모델 전환 핸드오프 작성 + 검증 | `create_handoff.ps1` + `validate_handoff.ps1` |
| `/close-handoff` | 완료 핸드오프 → `_Archive` 이동 | `close_handoff.ps1` |
| `/search <검색어>` | Perplexity 실시간 웹 검색 | `perplexity_tool.js` |

> **도메인 특화 커맨드는 사용자 본인이 추가한다.** 본 기본 셋(9개)은 시스템 운영(`save`, `subpush`, `sync`, `lock`, `doctor`, `index`, `handoff`, `close-handoff`, `search`)에 한정된다. 콘텐츠 outreach·일일/주간 보고·도메인 자동화 같은 워크플로 커맨드는 워크스페이스별로 사용자가 정의한다 — `docs/04_workspace_model.md`의 isolated domain pattern 참조.

환경별 표면:

| 환경 | 위치 |
|---|---|
| Claude Code | `.claude/commands/*.md` |
| Cursor | `.cursor/rules/` 룰 통합 |
| Antigravity | `.agent/skills/source-command-*/SKILL.md` (Codex 정본 미러) |
| Codex App | `.codex/skills/source-command-*/SKILL.md` |
| Gemini CLI | `.gemini/commands/*.toml` (TOML 형식 커맨드) |
| Codex CLI | `.codex/skills/source-command-*/SKILL.md` (Codex App과 같은 정본 사용) |

`/verify`는 PostToolUse hook이 자동 발동하는 `verify_tasks.js`와 중복이라 슬래시 커맨드에서 제거됐다.

### 스킬 동기화 정책 (drift 방지)

SKILL.md 형식을 쓰는 현재 운영 표면은 `.codex/skills/`와 `.agent/skills/`다. 단일 소스는 `.codex/skills/`로 정한다 — Codex App/CLI가 함께 쓰는 정본이다. `.agent/skills/`는 Antigravity 미러다. 예전 중복 skill 경로는 사용하지 않는다.

편집 규칙:
1. SKILL.md 변경은 **항상 `.codex/skills/`에서만** 수행
2. 변경 후 `/sync` 호출 → `.agent/skills/` 자동 갱신
3. `.agent/skills/`에 직접 편집 금지 (sync 시 덮어쓰여짐)

`.claude/commands/*.md`(Claude Code 형식)와 `.gemini/commands/*.toml`(Gemini 형식)은 SKILL.md와 형식이 달라 byte-level 미러 관계가 아니다. 다만 `/sync`는 Codex 정본의 `source-command-*` 목록을 기준으로 Gemini CLI TOML 커맨드 누락을 검증하고, 생성 가능한 누락 항목은 만든다.

Codex hook 설정은 별도 sync 정책을 따른다. `.codex/hooks.json`과 `.codex/config.toml`은 파일 포맷이 달라 byte-level 미러가 아니라, managed hook command set만 `/sync`가 동일하게 맞춘다. `config.toml`의 `[agents.<name>]` registry는 유지하고, hook command는 모두 `$(git rev-parse --show-toplevel)` 기반으로 정규화한다.

---

## 17) 결론

Hames는 개인이 여러 AI 모델을 실무에 안정적으로 투입하기 위해 만든 AI 운영체계다.

핵심은 AI에게 더 많은 지시를 욱여넣는 것이 아니다. 작업 구역을 나누고, 읽을 문서를 정리하고, 에이전트 팀을 구성하고, 위험 작업을 검증하고, 모델 전환 시 맥락을 깨끗하게 넘기는 것이다.

이것이 Hames의 핵심이다.

**AI를 잘 쓰는 것이 아니라, AI가 잘 일할 수 있는 환경을 설계한다.**

---

*Hames System v5.5 — Updated 2026-05-09*
