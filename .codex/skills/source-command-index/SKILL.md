---
name: "source-command-index"
description: "워크스페이스 콘텐츠 품질 & 인덱스 무결성 점검 (Content & Index Audit)"
---

# source-command-index

Use this skill when the user asks to run the migrated source command `index`.

## Command Template

# /index

사용법: `/index` / `/index <target>` (target 은 alias 또는 경로)

## 본 커맨드의 정체

`/index`는 **진단 전용 도구**다. 자동 수정은 하지 않는다.
스크립트는 JSON 리포트만 출력하며, 모든 수정은 별도 단계로 CEO 승인을 거쳐 수동 적용된다.

HamesSystem 규칙 구조 점검은 `/doctor` 담당.

## 진단 항목 (스키마: `index-2026-05-08`)

공통 (모든 tier):
- 프론트매터 완결성 (Related / Topic / Type / tags) + 필드 순서
- 값 일관성 인벤토리
- 푸터 (`## 관련노트`) 존재 여부
- 중복 의심 파일 (날짜 접두사 제거 후 동일 파일명)
- 위키링크 검증

추가 (tier=`deep` & Anti 워크스페이스만):
- 인덱스 미등재 고아 파일 / 임시 파일 / 아카이브 후보 (60일+) / `_Index.md` 누락

## Tier 결정 규칙

- **deep**: `workspaces/Investment`, `workspaces/Business`, `workspaces/Company`, `workspaces/Hobby`. 그리고 워크스페이스 루트에 `_Index.md` 가 있는 워크스페이스(예: <DomainRoot>).
- **light**: 그 외. frontmatter / footer / duplicates / wikilinks / value_inventory 만 검사.

각 워크스페이스 리포트의 `tier` 필드에 적용 모드가 표기된다.

---

## Step 1 — 스캔 실행

### 인수 없음 또는 `--all` → 전체 진단

```bash
python arsenal/manager.py
# 또는
python arsenal/manager.py --all
```

`.claude/workspace_paths.json` 의 등록된 모든 워크스페이스(존재하는 것만) +
`.Arsenal` 도구 레지스트리(`arsenal_registry_audit`) 점검.
중첩된 child 워크스페이스(예: nested-project/sub-app)는 부모 스캔에서 제외하여 중복 집계 방지.

### 특정 워크스페이스 지정

```bash
python arsenal/manager.py <target>
```

`target` 으로 허용되는 형태:
- alias (대소문자 무시): 워크스페이스 이름의 다양한 표기
- 상대 경로: `workspaces/Company`, `nested-project/sub-app`
- 절대 경로

---

## Step 2 — 에이전트 분석 (Semantic Analysis)

출력된 **HAMES SYSTEM AUDIT REPORT (JSON)**를 분석:

| 항목 | JSON 필드 | 비고 |
|---|---|---|
| 프론트매터 이슈 | `missing_frontmatter` | 필드 누락 + 순서 오류 |
| 푸터 누락 | `footer_missing` | `## 관련노트` 미존재 |
| 값 인벤토리 | `value_inventory` | 비일관 값 탐지용 전체 현황 |
| 고아 파일 | `orphaned_files` | `_Index.md` 미등재 (Anti only) |
| 임시 파일 | `temp_files` | 즉시 삭제 제안 가능 (Anti only) |
| 아카이브 후보 | `archive_candidates` | CEO 승인 후 이동 (Anti only) |
| 인덱스 누락 | `missing_indexes` | 워크스페이스에 `_Index.md` 없음 (Anti only) |
| 중복 의심 | `potential_duplicates` | CEO 단일화/삭제 결재 요청 |
| 링크 검증 | `links_found_for_agent_verification` | 에이전트가 경로·워크스페이스 직접 확인 |

프론트매터 이슈 예시:
- `Missing: tags` — tags 필드 없음
- `Wrong order: found ['Type', 'Related'], expected ['Related', 'Type']` — 순서 오류

---

## CEO 보고 후 조치 원칙

- 스크립트는 직접 파일을 수정하지 않는다.
- `recommended_actions` 항목별로 위험도(`risk_level`)와 근거(`rationale`)를 함께 제시한다.
- CEO 승인된 항목만 별도 단계에서 surgical Edit / 파일 생성 / 항목 제거 등으로 적용한다.
  - `_Index.md` 보강은 표 구조를 **절대 파괴하지 않고** 신규 행만 Merge.
  - frontmatter / footer 수정은 파일별 수술적 Edit. 전체 재작성 금지.
