---
name: claude-md-improver
description: Audit and improve CLAUDE.md files in repositories. Use when user asks to check, audit, update, improve, or fix CLAUDE.md files. Hames-aware fork — recognizes the v5.x kernel + .cursor/rules/* module separation, isolated domains, defense-line signatures, and workspace lock. In non-Hames repos this falls back to standard upstream behavior.
tools: Read, Glob, Grep, Bash, Edit
---

# CLAUDE.md Improver (Hames-aware)

Audit, evaluate, and improve CLAUDE.md files across a codebase. **Hames 저장소에서는** kernel과 모듈을 구분하고, 학습을 올바른 모듈로 라우팅한다.

**This skill can write to CLAUDE.md files.** After presenting a quality report and getting user approval, it proposes targeted edits — but only via surgical `Edit`, never via wholesale rewrites.

## Phase 0: Detect Hames root

가장 먼저 저장소가 Hames 시스템인지 확인한다.

```bash
grep -l "HAMES SYSTEM KERNEL" CLAUDE.md 2>/dev/null && echo "HAMES_DETECTED"
```

`HAMES_DETECTED` 출력 시 → **Hames 모드**로 동작 (이 SKILL.md 의 모든 규칙 적용).
출력 없음 → **upstream 모드**로 fallback (일반 CLAUDE.md 감사 동작).

이하 내용은 Hames 모드 기준이다.

## Hames 파일 분류 (taxonomy)

| 분류 | 위치 | 역할 | 수정 정책 |
|---|---|---|---|
| **Kernel** | `./CLAUDE.md` | `@`-import 진입점. 5개 룰 모듈 + Arsenal 레지스트리만 펼침 | inline 추가 금지. import 외 내용 추가 시 모듈로 라우팅 |
| **Rule modules** | `.cursor/rules/{prompt,context,agent,harness,enforcement}_engineering.md` | 단일 정의 위치 (single source of truth) | 학습은 토픽에 맞는 모듈로만 |
| **Tool registry** | `arsenal/CLAUDE.md` | Arsenal 도구 명단 | 새 도구 추가 시만 갱신 |
| **Workspace local** | `workspaces/Investment/CLAUDE.md`, `workspaces/Business/CLAUDE.md`, `workspaces/Company/CLAUDE.md`, `workspaces/Hobby/CLAUDE.md` | Anti 워크스페이스별 로컬 컨텍스트 | 로컬 학습만, 시스템 규칙 금지 |
| **Isolated domains** | `<DomainRoot>/CLAUDE.md` | 격리된 자체 시스템 | 자체 contract — 루트 규칙 강제 금지 |
| **Personal local** | `.claude.local.md` | 개인 설정 (gitignored) | 팀 공유 안 됨 |

## 절대 손대지 않는 영역

- 루트 `CLAUDE.md` 의 `@`-import 라인들 (`@.cursor/rules/...`, `@arsenal/CLAUDE.md`)
- 방어선 2 시그니처 형식 영역 (Loaded / Signatures 두 줄 블록 — `enforcement.md` `[2]` 정의)
- `ai_comm/` 의 핸드오프 파일들 (CLAUDE.md 가 아님)
- Workspace lock ON 시 lock 외부 파일 (어차피 PreToolUse hook 이 차단함)

## 스캔 제외 디렉토리

`node_modules`, `.next`, `.git`, `dist`, `build`, `_vendor`, `output`, `cache`, `.turbo`, `.vercel`, `.cache`, `_Archive`, `98_Archive`, `999_AI_Communication`, `01_Novel`

단 `arsenal/CLAUDE.md` 는 레지스트리 대상이므로 평가에 포함.

## Workflow

### Phase 1: Discovery

Hames 파일 분류에 따라 발견:

```bash
# Kernel
ls CLAUDE.md AGENTS.md GEMINI.md 2>/dev/null

# Rule modules
ls .cursor/rules/*.md 2>/dev/null

# Workspace + isolated domain
find Anti -maxdepth 3 -name "CLAUDE.md" 2>/dev/null
find <your-isolated-domains> <your-submodules> -maxdepth 3 -name "CLAUDE.md" 2>/dev/null

# Personal local
ls .claude.local.md 2>/dev/null

# Tool registry
ls arsenal/CLAUDE.md 2>/dev/null
```

각 결과를 분류표에 매핑하여 **분류별로** 평가 대상 목록 작성.

### Phase 2: Quality Assessment

분류별로 다른 기준 적용. 일반 기준은 [references/quality-criteria.md](references/quality-criteria.md), 라우팅 결정은 [references/hames-routing.md](references/hames-routing.md) 참조.

| 분류 | 핵심 평가 항목 |
|---|---|
| Kernel | `@`-import 라인이 정확하고 무결한가. inline 본문이 모듈로 빠질 수 있는 내용을 포함하고 있지 않은가 |
| Rule module | 토픽 일관성 (이 모듈이 다룰 영역 외 내용이 섞여 있지 않은가). 모듈 간 중복 정의 |
| Tool registry | 등록된 파일 실존 여부 (`/doctor` 가 자동 검사 — 여기서는 형식만 검토) |
| Workspace local | 워크스페이스 운영 규칙. 시스템-wide 규칙 누수 없는지 |
| Isolated domain | 격리 트리거 / 자체 contract — 루트 규칙 누수 없는지 |
| Personal local | gitignore 등록 여부, 공유 정보 노출 위험 |

> 시스템 무결성(파일 실존, 권한, hook surface)은 `/doctor` 영역. 여기서는 **콘텐츠 품질** 만 본다.

### Phase 3: Quality Report

분류별로 점수와 이슈를 묶어 보고:

```
## CLAUDE.md Quality Report (Hames)

### Kernel
- ./CLAUDE.md — Score X/100
  - import 무결성: PASS / FAIL
  - inline 본문 누수 의심: <항목>

### Rule Modules
- .cursor/rules/prompt_engineering.md — Score X/100
  - 토픽 일관성: ...
  - 다른 모듈과 중복 정의: ...

### Workspace Local
...

### Isolated Domains
...

### Recommended additions (라우팅 결과)
- 학습 1: → `.cursor/rules/agent_engineering.md` (이유)
- 학습 2: → `workspaces/Company/CLAUDE.md` (이유)
```

### Phase 4: Targeted Updates with Routing

각 제안마다 **3가지를 함께 제시**:

1. **어디로** (Hames 라우팅 매트릭스 적용 — [hames-routing.md](references/hames-routing.md))
2. **무엇을** (diff 형태)
3. **왜** (1줄 근거)

```markdown
### Update: .cursor/rules/agent_engineering.md
**Why:** 새로운 spawn 규칙이 발견되었으나 kernel 에 inline 으로 들어갈 자리가 아님. agent_engineering 모듈이 단일 정의 위치.
**Section:** [2.7] SPAWN PROTOCOL → 새 row 추가

\`\`\`diff
+ | 외부 도구 호출 시 | 해당 도메인 Level-1 mandatory spawn |
\`\`\`
```

루트 `CLAUDE.md` 수정 제안은 **import 라인 추가/수정** 외에는 거부. inline 본문 추가가 필요해 보이면 → 모듈로 라우팅하거나 `update_routing_blocked` 라벨로 보고.

### Phase 5: Apply

CEO 승인 받은 항목만 surgical `Edit` 으로 적용. 절대 wholesale rewrite 금지 (harness 가 어차피 차단함).

`_Index.md` 수정은 표 구조를 깨지 않고 행만 추가.

## Common Issues to Flag (Hames-specific)

1. **Kernel pollution** — 루트 CLAUDE.md 에 모듈 본문이 inline 으로 들어와 있음
2. **Module topic drift** — `prompt_engineering.md` 에 워크스페이스 매핑 같은 컨텍스트 토픽이 섞여 있음
3. **Duplicate definitions** — 같은 규칙이 여러 모듈에 중복 정의 (단일 정의 위치 위반)
4. **Stale registry** — `arsenal/CLAUDE.md` 의 도구 행이 실제 파일과 어긋남 (실존 검사는 `/doctor` 가 함, 여기서는 형식만)
5. **Defense line edits** — Loaded/Signatures 블록 형식이 망가짐 — 즉시 거부
6. **Isolated domain leak** — 격리 도메인 문서에 루트 라우팅 규칙이 강제로 들어감

## User Tips (Hames)

- **`/doctor`** 가 시스템 무결성(권한·hook·레지스트리·경로 참조) 진단을 담당. 본 스킬은 콘텐츠 품질·라우팅 담당.
- **`/index`** 가 워크스페이스 노트 품질을 담당. CLAUDE.md 자체는 보통 `/index` 의 `frontmatter_skip_filenames` 에 포함됨.
- **`/revise-claude-md`** 는 이번 세션에서 학습한 사실을 라우팅 매트릭스에 따라 적절한 모듈에 추가하는 짧은 워크플로우.
- 새 규칙은 **항상 모듈에 — kernel 에는 절대 inline 금지**.

## What Makes a Great Hames CLAUDE.md surface

- **Kernel** 은 짧고, import 만 깔끔.
- **Rule modules** 는 토픽이 명확히 갈림. 한 규칙은 한 모듈에만.
- **Tool registry** 는 파일명 + 호출 명령어만 (설명 컬럼 금지 — `arsenal/CLAUDE.md` 의 FORMAT RULE).
- **Workspace local** 은 그 워크스페이스 운영 규칙만.
- **Isolated domains** 는 자체 contract 안에서 닫힘.
