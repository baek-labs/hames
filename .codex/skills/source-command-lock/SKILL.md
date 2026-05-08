---
name: "source-command-lock"
description: "워크스페이스 Lock 설정 및 작업 환경 준비"
---

# source-command-lock

Use this skill when the user asks to run the migrated source command `lock`.

## Command Template

# /lock

사용법: `/lock <workspace>`

사용자는 workspace만 고른다. 세션 키는 Hames launcher/app runtime이 자동 주입한다 (`HAMES_SESSION_ID`, `CODEX_THREAD_ID` 등).
같은 모델을 여러 창/세션으로 띄워도 각 세션의 lock은 독립적으로 적용된다.

유효한 워크스페이스 (사용자 정의):

- **Tier 1 (entry 파일 보유):** `workspaces/<NAME>/` 아래 자체 CLAUDE.md/AGENTS.md를 둔 정식 워크스페이스. 사용자 본인의 워크스페이스 이름을 직접 사용.
- **Tier 2 (lock-only, entry 파일 없음):** 단순 편집 범위 제한만 필요한 디렉토리. entry 파일 없이도 lock 가능.

**범위 선택 패턴:**
- 컨테이너 전체 lock: 상위 디렉토리 이름 — 하위 자유 이동
- 개별 프로젝트만 lock: 정확한 디렉토리 이름 — 형제 디렉토리 차단

---

## 실행 순서

`/lock` 실행 시 `.hames_start_codex.md` / `.hames_start_gemini.md`는 사용자가 handoff/resume 연속성을 명시적으로 요청했거나 해당 부트스트랩에 `Session lock: ON`이 있을 때만 읽고 적용한다. `Session lock: OFF` 부트스트랩은 lock 명령을 지연하거나 덮어쓸 수 없다.

### Step 1 — Lock 파일 갱신

PowerShell로 lock helper를 실행합니다. 이 helper가 `.claude/.workspace_lock` 안의 현재 세션 항목만 갱신합니다.

```powershell
powershell -ExecutionPolicy Bypass -File arsenal/set_workspace_lock.ps1 -Workspace <입력값>
```

예: `/lock MyDomain` → 현재 `HAMES_SESSION_ID`에만 MyDomain lock 적용

`.claude/.workspace_lock`은 세션별 map을 사용한다. 기존 전역 lock 형식도 하위 호환으로 유지된다.

### Step 2 — 워크스페이스 컨텍스트 로드

해당 워크스페이스의 entry 파일을 읽어 로컬 규칙 적용. 환경별 우선순위:

- **Codex 앱 / Codex CLI:** `AGENTS.md` 우선, 없으면 `CLAUDE.md`
- **Claude Code / Cursor:** `CLAUDE.md` 우선, 없으면 `AGENTS.md`
- **Gemini CLI / Cursor (Gemini 모델):** `CLAUDE.md` 또는 `AGENTS.md` 중 존재하는 것
- **entry 파일 없는 Tier 2 워크스페이스:** 이 단계를 스킵하고 lock-only 모드로 진행

| 워크스페이스 종류 | entry 경로 |
|---|---|
| 일반 워크스페이스 | `workspaces/<NAME>/CLAUDE.md` (또는 `AGENTS.md`) |
| 격리 도메인 (advanced) | `<DomainRoot>/CLAUDE.md` + `<DomainRoot>/AGENTS.md` (선택) |
| Lock-only 디렉토리 | (없음 — Step 2 스킵) |

### Step 3 — 격리 도메인 전용 준비 (해당 시)

격리 도메인은 자체 에이전트 팀과 hook을 가진다. Lock 시 해당 도메인의 `<Root>/.claude/agents/` 디렉토리를 확인. 패턴은 `docs/04_workspace_model.md` 참조.

### Step 4 — 상태 보고

```
[WORKSPACE LOCK] Active: <workspace> | Lock: ON
쓰기 차단 범위: 현재 세션에서 <workspace> 외부 모든 경로
읽기: 전체 허용 (Read/Glob/Grep 무조건 통과)
SYSTEM_ADMIN 경로 (arsenal, .claude, .codex, .gemini, .agents): 항상 허용
해제: "고정 해제" 입력
```

---

## 고정 해제

사용자가 "고정 해제", "lock 해제", "unlock" 중 하나를 입력하면:

에이전트는 아래 helper를 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File arsenal/set_workspace_lock.ps1 -Unlock
```

이후 현재 세션만 루트 모드로 복귀하고 상태를 보고합니다.
