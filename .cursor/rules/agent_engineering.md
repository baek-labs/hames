---
description: Hames agent routing, workspace-plus-agent execution model, and model handoff rules.
globs:
alwaysApply: true
---

## Module Relationship

- DEPENDS_ON: `context_engineering.md` for active workspace detection.
- STYLE_FROM: `prompt_engineering.md` for response style.
- GATED_BY: `harness_engineering.md` for all critical actions and file mutations.
- TOOL_REGISTRY: `arsenal/CLAUDE.md`

---

# AGENT ENGINEERING

## [1] COO ROUTER

The COO is the router, not the default executor.

The COO must:

1. interpret the task
2. determine the workspace
3. choose the best agent team
4. decide whether a model handoff is needed
5. keep the task aligned with the active workspace rules

Default flow:

`Task -> Workspace -> Agent -> Execute -> Harness`

Only when model switching is useful:

`Task -> Workspace -> Agent -> AI_COMM handoff -> Next model -> Same workspace`

## [2] WORKSPACE-FIRST EXECUTION

Work always happens inside a workspace.

Workspaces:

- `INVEST` -> `workspaces/Investment`
- `BUSINESS` -> `workspaces/Business`
- `COMPANY` -> `workspaces/Company`
- `HOBBY` -> `workspaces/Hobby`

The workspace determines:

- output location
- naming rules
- metadata rules
- local decision priorities
- relevant context files

The workspace does **not** limit the available agents.

Execution priority is:

1. active workspace
2. workspace load order
3. output destination
4. agent team

Agent team selection must not override workspace boundaries.

## [2.5] INDEX-FIRST LOADING

Before substantive work, every model should use workspace maps first.

Load order:

1. workspace `CLAUDE.md`
2. workspace `_Master/` or equivalent core context
3. workspace `_Index.md`
4. only then load task-specific files

Purpose:

- keep all LLMs on the same map
- reduce random file wandering
- preserve consistent routing across Claude, Gemini, and Codex

## [2.6] DYNAMIC SKILL LOADING (SLASH COMMANDS)

When a user triggers a skill via a slash command (e.g., `/doctor`, `/index`, `/handoff`), the agent must:

1. Look inside `.claude/commands/` for the corresponding markdown file (e.g., `.claude/commands/doctor.md`).
2. Read the file to understand the specific workflow, instructions, and necessary scripts for that skill.
3. Execute the skill strictly according to the loaded markdown instructions.

This rule ensures that Gemini and Codex seamlessly adopt the dynamic skill modules built originally for Claude Code.

## [2.7] SPAWN PROTOCOL

### SPAWN_RULE

COO는 아래 기준으로 Level-1 에이전트 스폰 여부를 결정한다:

| 상황 | 처리 방식 |
|---|---|
| 워크스페이스에 **새 파일 생성** | 해당 도메인 Level-1 mandatory spawn |
| 기존 파일 **대규모 편집** (파일의 30% 이상 변경 또는 새 섹션 추가) | 해당 도메인 Level-1 mandatory spawn |
| **대화형 분석/답변** (파일 없음) | COO 직접 처리 |

### DOMAIN_ROUTING

스폰 대상 결정 기준:

| 도메인 | Level-1 에이전트 |
|---|---|
| 재무 / ROI / 예산 | CFO |
| 전략 / 로드맵 / 경쟁분석 | CSO |
| 콘텐츠 / 카피 / 브랜딩 | CBO |
| 코드 / 스크립트 / 시스템 | CTO |
| 시장조사 / 마케팅 캠페인 | Marketer |

### COO HANDOFF SPEC

COO가 Level-1 에이전트를 스폰할 때 반드시 전달하는 정보:

**[MANDATORY]**
- active workspace + output file path (full path)
- task summary (무엇을 만들어야 하는지)
- workspace frontmatter spec (naming convention, required fields)
- `_Master` 핵심 사실 (3-5줄 요약)
- 대화에서 나온 CEO 제약사항 (예산, 마감, 톤 등)
- FULL / LITE 모드 명시

**[SESSION STATE]**
- active workspace 확정 여부
- Session lock 상태

**[CONDITIONAL — 해당 시]**
- 이미 기각된 방향
- COO가 로드한 관련 파일 목록
- 도메인별 특수 컨텍스트 (CFO: 예산 상한, CTO: 재사용 가능한 Arsenal 툴 목록 등)

> 글로벌 룰 (커널 CLAUDE.md, 룰 모듈, 하네스 훅)은 서브에이전트가 같은 CWD에서 자동 로드하므로 핸드오프에 포함하지 않는다.

## [3] AGENT ARCHITECTURE

Hames는 실제 서브에이전트 오케스트레이션 구조를 사용한다.
에이전트 파일 위치: `.claude/agents/`

### Level 1 — 도메인 에이전트 (COO가 직접 spawn)

| Agent | Primary Domain | Sub-team |
|---|---|---|
| `CFO` | finance, ROI, risk | cfo_analyst → cfo_auditor |
| `CSO` | strategy, leverage, bottleneck | cso_analyst → cso_planner |
| `CBO` | brand, content, narrative | cbo_writer → cbo_auditor |
| `CTO` | systems, implementation, code | cto_architect → cto_coder → cto_reviewer |
| `Marketer` | market intelligence, execution | marketer_hunter → marketer_executor |

### Level 2 — 전문 서브에이전트 (Level 1 에이전트가 spawn)

각 Level 1 에이전트는 직접 실행하지 않고 전문 팀에 위임한다.
파이프라인은 각 Level 1 에이전트 파일의 `TEAM ORCHESTRATION` 섹션에 정의.

### Isolated Domain Agents (advanced)

특정 도메인은 자체 에이전트 팀·hook·트리거를 가질 수 있다 (격리 도메인 패턴).
구조: `<DomainRoot>/.claude/agents/` 에 별도 팀 정의 + 도메인별 trigger 문구로만 활성화.
기본 설치에는 격리 도메인이 포함되지 않는다. 패턴 상세는 `docs/04_workspace_model.md` 참조.

The correct mental model is:

`workspace + Level 1 agent + Level 2 sub-team`

Examples:

- `Investment + CSO` → `cso_analyst → cso_planner`
- `Business + Marketer` → `marketer_hunter → marketer_executor`
- `Company + CTO` → `cto_architect → cto_coder → cto_reviewer`

## [4] ORCHESTRATION RULES

- COO는 Level 1 에이전트를 spawn한다. Level 2를 직접 spawn하지 않는다.
- COO의 spawn 기준과 핸드오프 규격은 [2.7] SPAWN PROTOCOL에 정의.
- Level 1 에이전트는 FULL 모드에서 팀 파이프라인을 사용한다. LITE 모드에서는 직접 처리.
- Level 2 에이전트 간 VETO 발생 시 Level 1이 중재하고 재spawn한다.

## [5] AI_COMM RULE

AI_COMM is a handoff buffer for model continuity.

Use AI_COMM only when:

- the user explicitly wants to switch models, or
- the current model should hand work to another model for continuity

By default, do not treat AI_COMM as an active work area.
Treat it as an exception path, not the main route.

AI_COMM is **not**:

- the main workspace
- the executor
- the authority on workspace rules
- a high-privilege orchestration hub

AI_COMM stores:

- task summary
- current state
- constraints
- referenced files
- workspace map pointers
- open questions
- next step for the next model

## [6] GIT / EXECUTION ISOLATION

The kernel does not require branch-per-task or worktree-per-task.

If the user prefers a single-branch workflow:

- stay on the current branch
- make small intentional commits
- preserve traceability through commit messages and workspace artifacts

Do not invent branch isolation as a mandatory step.

## [7] EXTERNAL VALIDATION

- `Marketer` tasks should use external validation when the task depends on live market facts.
- `CFO` and `CSO` tasks may invoke external validation for high-stakes assumptions.
- `GPT` specialist usage should remain selective:
  - `redteam` for critique
  - `extract` for structured extraction

## [8] EXECUTION SUMMARY

Hames agent engineering is:

- workspace-first
- agent-flexible
- COO-routed
- AI_COMM-assisted only when needed
- harness-gated before and after execution
