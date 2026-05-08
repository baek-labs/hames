---
name: "source-command-doctor"
description: "HamesSystem 규칙 완성도 점검 (System Integrity MRI)"
---

# source-command-doctor

Use this skill when the user asks to run the migrated source command `doctor`.

## Command Template

# /doctor

사용법: `/doctor` / `/doctor <workspace>` (예: `/doctor MyDomain`)

## 본 커맨드의 정체

`/doctor`는 **진단 전용 도구**다. 자동 수정은 하지 않는다.
스크립트는 JSON 리포트만 출력하며, 모든 수정은 별도 단계로 CEO 승인을 거쳐 수동 적용된다.

파일 콘텐츠·인덱스 품질 점검은 `/index` 담당.

## 진단 항목 (스키마: `doctor-2026-05-08.v2`)

| 카테고리 | JSON 필드 (`issues.*`) | 기본 조치 방향 (별도 작업) |
|---|---|---|
| Stale Permissions | `stale_permissions` | `settings.local.json` 해당 항목만 제거 |
| Arsenal Registry | `arsenal_issues` | `arsenal/CLAUDE.md` 정정 또는 파일 복구 |
| Rule Modules | `rule_module_issues` | 루트 `CLAUDE.md` `@`-import 정정/복구 |
| Workspace Isolation | `workspace_isolation_issues` | 격리 워크스페이스 누락 항목 생성 |
| Path References | `path_reference_issues` | 메타 문서가 인용한 경로 정정/제거 |
| Command Surface | `command_surface_issues` | `.claude` / `.gemini` / `.codex` / `.agent` 미러 동기화 |
| Hook Surface | `hook_surface_issues` | hook 스크립트 경로 정정 또는 복구 |
| Runtime Encoding | `runtime_encoding_issues` | Codex/PowerShell UTF-8 bootstrap 적용 |
| Workspace Registry | `workspace_registry_issues` | `.claude/workspace_paths.json` 정정 |

추가 출력:
- `documentation_drift_warnings` — `HamesSystem_Public.md`(설명 문서)가 인용한 커널 서명이 실제 커널과 어긋날 때만 좁게 경고. **HamesSystem_Public.md 는 정본이 아니다.**
- `recommended_actions` — `{id, action_type, target_path, proposed_change, risk_level, rationale, source_issue}` 구조의 고정 스키마.

---

## Mode A — 전체 점검 (인수 없음)

```bash
python arsenal/hames_doctor.py
```

전체 시스템 진단. 모든 카테고리 필드가 채워진다.

## Mode B — 워크스페이스 필터 (`/doctor <workspace>`)

```bash
python arsenal/hames_doctor.py <workspace>
```

전체 시스템 진단을 그대로 실행하되, `workspace_isolation_issues` 만 해당
워크스페이스 항목으로 필터링하여 노이즈를 줄인다.
나머지 카테고리(시스템 전반)는 그대로 보고된다.

---

## CEO 보고 후 조치 원칙

- 스크립트는 직접 파일을 수정하지 않는다.
- `recommended_actions` 항목별로 위험도(`risk_level`)와 근거(`rationale`)를 함께 제시한다.
- CEO 승인된 항목만 별도 단계에서 surgical Edit / 파일 생성 / 항목 제거 등으로 적용한다.
