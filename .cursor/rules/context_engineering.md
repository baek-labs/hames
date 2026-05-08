---
description: 워크스페이스 매핑, 모드 결정, 데이터 로딩 계층, 시간 인지, 컨텍스트 격리
globs:
alwaysApply: true
---

## 모듈 연관 관계
- PREREQUISITE_FOR: agent_engineering.md — 에이전트 선택 전 반드시 현재 모드(워크스페이스) 확인.
- FEEDS_INTO: agent_engineering.md — LOAD_DATA_HIERARCHY 결과를 DRAFT 단계에 전달.
- GATED_BY: harness_engineering.md — 워크스페이스 전환 시 CRITICAL_ACTION 여부 확인.

---

# CONTEXT ENGINEERING — 워크스페이스 & 데이터 로딩

## [1] TEMPORAL CONTEXT

- 오늘 날짜는 Claude Code 세션 컨텍스트에서 자동 주입됨.
- 모든 마감일/일정은 오늘 날짜 기준으로 정렬.

## [2] CURRENT MODE 결정

현재 작업 디렉토리(CWD)와 아래 WORKSPACE_MAPPING의 LOCAL_PATH를 비교하여 모드 확정.
CWD가 루트(`{{HAMES_ROOT}}`)와 일치하면 → **HAMES ROOT 모드**.

루트 모드에서는 특정 워크스페이스를 자동 가정하지 않는다.
먼저 task 또는 명시된 target path를 기준으로 active workspace를 결정한 뒤, 해당 workspace 규칙을 로드한다.

모델별 세션 부트스트랩 파일(`ai_comm/Memory/.hames_start_codex.md`, `ai_comm/Memory/.hames_start_gemini.md`)은 핸드오프/재개 아티팩트이며 기본 작업 소스가 아니다.
사용자가 handoff/resume 연속성을 명시적으로 요청하거나, 부트스트랩에 `Session lock: ON`이 명시된 경우에만 읽고 적용한다.
`Session lock: ON`이 명시된 경우에만 active workspace / agent / task 고정을 현재 세션의 최우선 입력으로 사용한다.
`Session lock: OFF`(또는 누락)인 경우 일반 명령에서는 부트스트랩을 읽거나 적용하지 않는다. 사용자 지시, 명시된 target path, 현재 커맨드 라우팅이 우선한다.
오래된 부트스트랩 task 문구가 `/lock`, `HamesSystem 적용`, 워크스페이스 전환, 일반 slash-command 실행에 개입하면 안 된다.
부트스트랩 파일은 모델 간 핸드오프 시에만 생성된다. `HamesSystem 적용`은 규칙 활성화 확인이며 파일 생성을 트리거하지 않는다.

자연어 해석 규칙 (단일 정의 위치):
- `HamesSystem 적용` → 규칙 활성화 확인만. 스크립트 실행·파일 생성 없음. advisory mode (lock OFF) 유지.
- `<Workspace> 모드로` → workspace 전환만 수행 (lock OFF). `<Workspace>`: INVEST / BUSINESS / COMPANY / HOBBY
- `<Workspace> 모드로 고정` → advisory lock 선언 (문서 수준). 실제 hook 차단은 `/lock <workspace>` 커맨드로만 활성화됨.
- `/lock <workspace>` → `.claude/.workspace_lock` 갱신 + 워크스페이스 컨텍스트 로드 + PreToolUse hook 차단 활성화. 격리 도메인 패턴은 `docs/04_workspace_model.md` 참조.
- `고정 해제` / `lock 해제` / `unlock` → 에이전트가 `.claude/.workspace_lock`을 `{"workspace": null, "locked": false}`로 업데이트. hook 차단 비활성화.
- `고정` 키워드가 없는 경우 절대 lock ON으로 해석하지 않는다.

## [3] WORKSPACE MAPPING

워크스페이스는 `workspaces/<NAME>/` 형태로 사용자가 정의한다.
아래는 **starting suggestions** — 본인 도메인에 맞게 자유롭게 변경.

| MODE | LOCAL_PATH | CONTEXT |
|---|---|---|
| Investment | `{{HAMES_ROOT}}/workspaces/Investment` | example: 투자 분석, 자산 관리 |
| Business | `{{HAMES_ROOT}}/workspaces/Business` | example: 개인사업(SOHO), 전략, 영업 |
| Company | `{{HAMES_ROOT}}/workspaces/Company` | example: 고용주(day-job) 프로젝트 |
| Hobby | `{{HAMES_ROOT}}/workspaces/Hobby` | example: 개인 창작, 학습, 사이드 프로젝트 |

**격리 도메인 (advanced):** 자체 에이전트 팀·hook·트리거를 가지는 격리 도메인 패턴은 `docs/04_workspace_model.md` 참조. 기본 설치에는 격리 도메인이 포함되지 않는다.

**SYSTEM 경로:**
- ARSENAL: `{{HAMES_ROOT}}/arsenal` — Hames 도구 모음 (스크립트, hook, 플러그인)
- AI_COMM: 사용자가 핸드오프 운영 시 임의 위치에 정의 (`docs/06_agent_architecture.md` 참조)
- ARCHIVE: 사용자 워크스페이스 내부 `_Archive/` 또는 임의 정책

## [4] CONTEXT ISOLATION

- 워크스페이스 격리는 **디렉토리별 CLAUDE.md**로 구현.
- ~~MEMORY_MCP 태그 방식~~ → **폐기됨.** 디렉토리 CLAUDE.md 방식으로 완전 대체.
- 디렉토리 스캔 시 항상 제외: `node_modules`, `.next`, `.git`, `dist`, `build`, `.Arsenal`
- 한 세션은 하나의 active workspace를 기준으로 유지한다.
- 명시적 지시 없이는 다른 workspace를 기본 탐색 대상으로 삼지 않는다.
- 세션 부트스트랩이 workspace를 고정한 경우(`Session lock: ON`), 명시적 사용자 재지정 없이는 그 고정을 유지한다.

## [5] DATA 로딩 계층 (Step 2~3)

루트 모드이든 워크스페이스 내부 모드이든, substantive work 전에는 항상 동일한 워크스페이스 로딩 순서를 따른다.

**FIXED LOAD ORDER:**

1. `[WORKSPACE]/CLAUDE.md`
2. `[WORKSPACE]/_Master`
3. `[WORKSPACE]/_Index.md`
4. task-specific files only

세부 규칙:

- `CLAUDE.md`는 해당 workspace의 local operating rules를 제공한다.
- `_Master`는 core context를 제공한다.
- `_Index.md`는 현재 파일 지도로 사용한다.
- task-specific files는 위 세 층을 확인한 뒤 필요한 것만 선별적으로 로드한다.
- 전체 파일 소진적 로드 금지.
- `00_Inbox`는 기본 로딩 우선순위가 아니다.
- AI_COMM handoff는 사용자가 명시적으로 모델 전환을 요구한 경우에만 별도로 로드한다.
- final output path는 active workspace 내부여야 한다.
- verifier 통과 전에는 어떤 산출물도 정식 완료로 간주하지 않는다.

**MOC_RULE:** `*_MOC.md` 파일은 Obsidian Dataview 전용 네비게이션. AI 네비게이션은 CLAUDE.md와 _Index.md 사용.

## [6] DRAFT 생성 (Step 3)

- Agent == [Marketer] OR [CSO]: KPI 먼저 정의 후 산출물 생성.
- 나머지: 로딩 데이터 기반 초안 즉시 생성.
