# Hames Routing Matrix

학습이나 새 규칙을 추가할 때 **어느 파일로 가야 하는지** 결정하는 매트릭스.
모든 추가는 **kernel `CLAUDE.md` 에 inline 으로 들어가지 않는다.** 토픽에 맞는 모듈로 라우팅한다.

## 1. 토픽 → 목적지 매트릭스

| 추가하려는 내용의 토픽 | 목적지 파일 | 근거 섹션 |
|---|---|---|
| 시스템 정체성, 톤, 출력 스타일, 언어 규칙 | `.cursor/rules/prompt_engineering.md` | `[1] SYSTEM IDENTITY` / `[3] OUTPUT POLICY` |
| 내장 추론 / DEEP_TASK / 복잡도 루브릭 | `.cursor/rules/prompt_engineering.md` | `[2] DEEP_TASK_PROTOCOL` |
| 스킬 사용 윤리, 슬래시 커맨드 호출 정책 | `.cursor/rules/prompt_engineering.md` | `[4] SKILL USAGE ETHICS` |
| 워크스페이스 매핑, CWD 결정, 자연어 트리거 | `.cursor/rules/context_engineering.md` | `[2] CURRENT MODE` / `[3] WORKSPACE MAPPING` |
| 데이터 로딩 순서, FIXED LOAD ORDER | `.cursor/rules/context_engineering.md` | `[5] DATA 로딩 계층` |
| 에이전트 라우팅, COO ROUTER, spawn 규칙 | `.cursor/rules/agent_engineering.md` | `[1] COO ROUTER` / `[2.7] SPAWN PROTOCOL` |
| Level-1 / Level-2 에이전트 정의, AI_COMM | `.cursor/rules/agent_engineering.md` | `[3] AGENT ARCHITECTURE` / `[5] AI_COMM RULE` |
| Hook, 안전 검사, CRITICAL_ACTION, workspace lock | `.cursor/rules/harness_engineering.md` | `[1] DEFINED_CRITICAL_ACTIONS` / `[9] WORKSPACE LOCK` |
| 방어선 1/2/3, 강제 로딩, 시그니처 정책 | `.cursor/rules/enforcement.md` | `[1]~[5]` |
| Wrapper / 사전 주입 / hames_wrap.ps1 | `.cursor/rules/enforcement.md` | `[6] 방어선 4` |
| 새로운 Arsenal 도구 (스크립트, 호출 명령) | `arsenal/CLAUDE.md` | 해당 언어 섹션 (Python/PowerShell/JavaScript/Shell) |
| API 키, .env 변수 | `arsenal/CLAUDE.md` | `## API Keys` |
| 특정 워크스페이스(workspaces/) 운영 규칙 | 해당 워크스페이스의 `CLAUDE.md` | 워크스페이스별 |
| 격리 도메인(isolated domain examples) 자체 규칙 | 해당 도메인의 `CLAUDE.md` | 자체 contract |
| 개인 환경 설정, 공유 안 할 정보 | `.claude.local.md` | gitignored |

## 2. Kernel 에 들어가도 되는 것 / 안 되는 것

**Kernel (`./CLAUDE.md`) 허용**:
- `@`-import 라인 추가/제거
- 시스템 모델 다이어그램(전체 구조 한 눈에 보기 위한 짧은 표·리스트)
- AI_COMM 정의처럼 모듈 어느 곳에도 정확히 속하지 않는 시스템 전체 개요

**Kernel 금지**:
- 개별 모듈에 들어갈 수 있는 세부 규칙
- 워크스페이스 매핑 표 (→ `context_engineering.md`)
- 에이전트 정의 (→ `agent_engineering.md`)
- Hook 정책 (→ `harness_engineering.md`)
- 방어선 시그니처 (→ `enforcement.md`)
- Arsenal 도구 (→ `arsenal/CLAUDE.md`)

판단이 애매할 때 기본값: **모듈로 보낸다.** Kernel 은 비워두는 쪽이 안전.

## 3. 모듈 간 중복 정의 금지

같은 규칙은 **하나의 모듈에만**. 단일 정의 위치 (single source of truth) 원칙.

예외 — 다른 모듈에서 참조해야 할 때는 본문 복사 대신 한 줄 reference:
> 자세한 규칙은 `harness_engineering.md` `[9] WORKSPACE LOCK` 참조.

`enforcement.md` 가 명시적으로 "단일 정의 위치"라고 선언하고 있는 것이 이런 이유.

## 4. 격리 도메인 처리

격리 도메인의 `CLAUDE.md` 는 **자체 contract** 로 운영된다. 루트 모듈 규칙을 그쪽에 강제로 넣지 않는다.

격리 도메인에 추가할 학습은 그 도메인의 로컬 CLAUDE.md 에 넣되, 다음 사항을 검증:
- 격리 트리거 문구가 명시돼 있는가? (예: "유튜브 모드로 작업 시작")
- 자동 진입 금지 명시?
- 루트 에이전트 라우팅 대상에서 제외 명시?

## 5. 라우팅 결정 예시

### 예시 1
**학습**: "에이전트는 외부 도구 결과를 받으면 즉시 캐싱해야 한다."

**라우팅**: `.cursor/rules/agent_engineering.md` `[2.7] SPAWN PROTOCOL` 또는 `[3] AGENT ARCHITECTURE`. Kernel 에 inline 절대 금지.

### 예시 2
**학습**: "오늘 새로 만든 `transcript_diff.py` 스크립트는 Arsenal 에 등록해야 한다."

**라우팅**: `arsenal/CLAUDE.md` 의 Python Tools 섹션에 행 추가. 다른 곳에 쓰지 않는다.

### 예시 3
**학습**: "<DomainRoot> 워크스페이스에서 새 폴더를 운영한다."

**라우팅**: 격리 도메인의 자체 `CLAUDE.md` 만. 루트 / 모듈 어디에도 안 들어감 (격리 도메인은 자체 contract).

### 예시 4
**학습**: "방어선 5 를 새로 만들어서 git 커밋 직전에 시그니처 재확인."

**라우팅**: `.cursor/rules/enforcement.md` 새 섹션 `[7]`. Kernel 에 한 줄 import 만 (이미 import 되어 있으면 변경 없음).

## 6. 라우팅 결정 거부 (route blocked) 처리

다음 경우 자동 라우팅 없이 사용자 결정 요청:
- 어느 모듈에도 명확히 속하지 않는 규칙
- 모듈 분리 의도를 바꿀 가능성이 있는 규칙
- 여러 모듈 동시 수정이 필요한 규칙

이 때는 라벨 `update_routing_blocked` 로 보고하고 CEO 결정 대기.
