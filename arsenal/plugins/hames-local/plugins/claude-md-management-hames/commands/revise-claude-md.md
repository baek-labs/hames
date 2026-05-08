---
description: 이번 세션에서 학습한 사실을 Hames 라우팅 매트릭스에 따라 적절한 모듈/워크스페이스 CLAUDE.md 에 반영
allowed-tools: Read, Edit, Glob, Bash
---

이번 세션에서 학습한 사실을 캡처하여, **Hames 라우팅 매트릭스**에 따라 적절한 파일로 반영한다. Kernel(`CLAUDE.md`)에는 inline 으로 절대 넣지 않는다.

## Step 0: Detect Hames root

```bash
grep -l "HAMES SYSTEM KERNEL" CLAUDE.md 2>/dev/null && echo "HAMES_DETECTED"
```

`HAMES_DETECTED` 출력 → Hames 모드 (이 워크플로우).
출력 없음 → upstream `revise-claude-md` 동작으로 fallback.

## Step 1: Reflect

이번 세션에서 다음을 추렸을 때 어떤 학습이 있었는가?

- 새로 발견한 bash 명령이나 도구 호출 패턴
- 따라야 했던 코드/문서 스타일
- 동작했던 테스트 / 워크플로우
- 환경·설정 특이점 (Windows PowerShell, encoding, hook 등)
- 마주친 함정 / 회피 방법

각 학습마다 **한 줄로 압축**한다 (CLAUDE.md 는 프롬프트의 일부 — 짧을수록 좋다).

## Step 2: Discover destination candidates

```bash
ls CLAUDE.md AGENTS.md GEMINI.md .claude.local.md 2>/dev/null
ls .cursor/rules/*.md 2>/dev/null
ls arsenal/CLAUDE.md 2>/dev/null
find Anti -maxdepth 3 -name "CLAUDE.md" 2>/dev/null
find <your-isolated-domains> <your-submodules> -maxdepth 3 -name "CLAUDE.md" 2>/dev/null
```

## Step 3: Route each learning

각 학습을 [Hames 라우팅 매트릭스](../skills/claude-md-improver/references/hames-routing.md) 로 분류한다.

| 토픽 | 목적지 |
|---|---|
| 시스템 정체성 / 출력 스타일 / 언어 / DEEP_TASK / 스킬 윤리 | `.cursor/rules/prompt_engineering.md` |
| 워크스페이스 매핑 / 자연어 트리거 / 데이터 로딩 | `.cursor/rules/context_engineering.md` |
| 에이전트 라우팅 / spawn / Level-1·2 / AI_COMM | `.cursor/rules/agent_engineering.md` |
| Hook / CRITICAL_ACTION / workspace lock | `.cursor/rules/harness_engineering.md` |
| 방어선 1/2/3/4 / 시그니처 / 강제 로딩 | `.cursor/rules/enforcement.md` |
| 새 Arsenal 도구 / API 키 | `arsenal/CLAUDE.md` |
| 특정 워크스페이스 운영 규칙 | 해당 워크스페이스 `CLAUDE.md` |
| 격리 도메인 자체 규칙 | 해당 도메인 `CLAUDE.md` |
| 개인 환경 / 공유 안 할 정보 | `.claude.local.md` |
| 어디에도 명확히 속하지 않음 | **`update_routing_blocked` 라벨** — CEO 결정 대기 |

**Kernel(`./CLAUDE.md`) 에 inline 추가는 금지.** import 라인 수정만 허용.

## Step 4: Draft additions

학습마다 다음 형식으로 제시:

```
### Update: <목적지 파일>
**Why:** <한 줄 근거 — 왜 이 모듈/워크스페이스인가, 왜 이 학습이 다음 세션에 도움이 되는가>
**Section:** <기존 섹션명 또는 새 섹션 번호>

\`\`\`diff
+ <한 줄로 압축된 학습 — 명령어, 패턴, 또는 규칙>
\`\`\`
```

예시:

```
### Update: .cursor/rules/harness_engineering.md
**Why:** Windows 콘솔 cp949 인코딩 때문에 em-dash 출력이 깨지는 현상을 발견. Arsenal 스크립트 작성 시 첫 줄에 sys.stdout.reconfigure 호출 필요.
**Section:** [9] WORKSPACE LOCK 다음에 [10] PYTHON STDOUT ENCODING 추가

\`\`\`diff
+ ## [10] PYTHON STDOUT ENCODING
+ Windows 콘솔(cp949)에서 em-dash 등 비ASCII 출력 깨짐 방지를 위해 Arsenal Python 스크립트는 시동 시 sys.stdout.reconfigure(encoding='utf-8', errors='replace') 호출.
\`\`\`
```

## Step 5: 거부할 패턴

다음 패턴은 자동으로 거부하고 보고:

- Kernel `./CLAUDE.md` 에 inline 본문 추가 (모듈로 라우팅하라고 안내)
- 같은 규칙이 이미 다른 모듈에 정의돼 있음 (중복 — 단일 정의 위치 위반)
- 방어선 2 시그니처 형식 영역 수정
- `ai_comm/` 의 핸드오프 파일 수정
- Workspace lock ON 시 lock 외부 워크스페이스 수정 (어차피 PreToolUse hook 차단)

## Step 6: Apply with approval

CEO 가 승인한 항목만 surgical `Edit` 으로 적용. wholesale rewrite 금지 (harness 가 차단).

`_Index.md` 같은 표 형식 파일은 표 구조를 깨지 않고 행만 추가.

조치 완료 후 보고:
- 적용된 학습 수
- 라우팅된 파일 목록
- `update_routing_blocked` 로 남은 미결정 학습 (있으면 CEO 결정 대기)
