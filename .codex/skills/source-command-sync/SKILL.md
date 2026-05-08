---
name: "source-command-sync"
description: "Codex 스킬 정본, Antigravity 미러, Gemini CLI 커맨드, Codex hook surface 동기화 — sync_skills.ps1 실행"
---

# source-command-sync

Use this skill when the user asks to run the migrated source command `sync`.

## Command Template

# /sync

사용법: `/sync` (인수 없음) / `/sync --dry-run`

## 역할

슬래시 커맨드를 SKILL.md 형식으로 사용하는 Codex 정본과 Antigravity 미러를 동기화한다.
또한 Gemini CLI 커맨드 표면(`.gemini/commands/*.toml`)을 Codex 정본의 `source-command-*` 목록과 맞추고, Codex hook surface인 `.codex/hooks.json`과 `.codex/config.toml`의 managed hook command set을 repo-root 기반 경로로 동기화한다.

- **단일 소스:** `.codex/skills/` (Codex App/CLI 공용 정본)
- **미러 타겟:** `.agent/skills/` (Antigravity)
- **Gemini CLI:** `.gemini/commands/*.toml` (형식이 달라 직접 복사하지 않고 누락 커맨드 생성/검증)
- **Codex hook surface:** `.codex/hooks.json`, `.codex/config.toml` (최신 파일을 source hint로 보고 동일 command set으로 정규화)

`.claude/commands/*.md`는 형식이 달라 본 sync 대상 아님 — 별도 유지.

## 실행 순서

**Step 1 — 인자 확인**
- 사용자 인자가 `--dry-run` 또는 `dry-run`이면 dry-run 모드 (실제 복사 없이 변경 예정 보고)
- 인자 없으면 실제 동기화 실행

**Step 2 — 동기화 실행**

실제 동기화:
```bash
powershell -NoProfile -ExecutionPolicy Bypass -File arsenal/sync_skills.ps1
```

Dry-run:
```bash
powershell -NoProfile -ExecutionPolicy Bypass -File arsenal/sync_skills.ps1 -DryRun
```

**Step 3 — 결과 보고**
- 복사된 스킬 수, 제거된 orphan 수, Gemini 생성 수, 검증 결과(`VERIFY PASS` / `VERIFY FAIL`) 출력
- Codex hook surface 변경 여부와 repo-local 경로 검증 결과 출력
- VERIFY FAIL 시 어느 디렉토리에 diff 있는지 보고 후 수동 확인 요청

## 주의

- 스킬 편집은 항상 `.codex/skills/`에서만 진행. 그 후 `/sync` 호출하여 `.agent/skills/` 미러 갱신
- 실수로 `.agent/skills/`에 직접 편집한 경우, `/sync` 실행 시 그 변경분이 덮어쓰여짐
- `.gemini/commands/*.toml`은 TOML 형식이므로 SKILL.md를 byte-level 미러하지 않고, 지원되는 누락 커맨드를 생성하고 전체 목록 존재 여부를 검증한다.
- `.codex/hooks.json`과 `.codex/config.toml`은 포맷이 다르므로 파일 전체를 복사하지 않고, managed hook command만 동기화한다. Agent registry는 유지한다.
