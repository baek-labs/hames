---
description: 서브모듈 커밋 + push + Hames gitlink 커밋까지. Hames push는 /save 역할.
---

# /subpush

서브모듈 작업 후 "서브모듈 push → Hames gitlink bump 커밋" 2단 흐름을 자동화한다.
Hames 루트 push는 포함하지 않는다 — 그것은 `/save`의 역할이다.

## 사용법

**A. 서브모듈 안에서 커밋까지 끝낸 경우:**
```
/subpush <submodule_path>
```
예: `/subpush my-submodule`

**B. 워킹트리 변경분 통째로 커밋 + 흐름 전체 실행:**
```
/subpush <submodule_path> "<commit message>"
```
예: `/subpush my-submodule "feat: add new content"`

## 사전 조건

- CWD가 Hames 루트(`{{HAMES_ROOT}}`)여야 한다.
- `<submodule_path>`는 Hames 기준 상대경로 (예: `my-submodule-a`, `my-submodule-b`).
- 격리 도메인은 이 커맨드 대상이 아니다.

## 부정형 결론 안전장치 (전 단계 공통)

이 스킬의 모든 단계에서 "변경 없음 / 이미 동기화됨 / 커밋할 내용 없음 / gitlink 변경 없음" 같은 부정형 결론을 내리기 전:

1. 직전에 실행한 검증 명령의 raw 출력을 화면에 그대로 표시 (요약·재해석 금지).
2. raw 출력이 진짜로 비어있을 때만 부정형 결론을 낸다.
3. raw 출력에 1줄이라도 있으면 다음 단계로 진행.

특히 Step 3의 ahead/behind 카운트, Step 4의 `git status --short <submodule_path>` 출력은 결정 직전에 raw로 박아둔다.

## 실행 순서

**Step 1 — 인자 검증**
- `$ARGUMENTS` 첫 토큰이 비어있으면 "서브모듈 경로를 입력해주세요" 후 중단.
- 해당 경로가 `.gitmodules`에 등록돼 있는지 확인:
  ```bash
  git config --file .gitmodules --get-regexp path | grep -F "<submodule_path>"
  ```
  없으면 "서브모듈이 아닙니다" 출력 후 중단.

**Step 2 — (모드 B인 경우만) 서브모듈 안에서 커밋**
```bash
cd <submodule_path>
git add -A
git status --short    # 사용자에게 변경 내역 확인 출력
git commit -m "<commit message>"
```
- 변경분이 없으면 "커밋할 내용 없음" 출력 후 Step 3로 진행 (push만 시도).

**Step 3 — 서브모듈 push**
```bash
cd <submodule_path>     # 이미 안에 있으면 생략
git rev-list --left-right --count '@{u}...HEAD' 2>/dev/null
```
- ahead가 0이면 "이미 동기화됨, push 생략" 출력 후 Step 4로.
- ahead가 1 이상이면:
  ```bash
  git push
  ```
- upstream이 설정 안 돼 있으면(`fatal: no upstream`) 사용자에게 보고하고 중단.

**Step 4 — Hames 루트로 복귀 후 gitlink 상태 확인**
```bash
cd {{HAMES_ROOT}}
git status --short <submodule_path>
```
- ` M <submodule_path>`이 보이면 gitlink 갱신 필요 → Step 5.
- 출력 없으면 "gitlink 변경 없음" 출력 후 종료.

**Step 5 — gitlink 커밋 (Hames push 없음)**
```bash
git add <submodule_path>
git commit -m "chore: bump <submodule_path> gitlink"
```
- push는 하지 않는다. Hames 루트 push가 필요하면 `/save`를 별도로 실행한다.

**Step 6 — 최종 검증 보고**
```bash
cd <submodule_path> && git rev-list --left-right --count '@{u}...HEAD'
```
- `0	0`이면 "서브모듈 동기화 완료. Hames gitlink 커밋됨. push는 /save로." 한 줄로 마감.
- 그 외엔 ahead/behind 숫자 출력 후 다음 액션 안내.

## 안전 규칙

- Hames 루트의 다른 변경분(예: `n8n/data/*`, untracked 파일)은 절대 같이 add 하지 않는다. `git add <submodule_path>` 정확히 그 한 경로만 스테이징.
- 커밋 메시지에 `Co-Authored-By` 줄 추가하지 않는다 (시스템 관례 단순화).
- push 전 어떤 destructive 옵션(`--force`, `--no-verify`)도 쓰지 않는다.
- `<submodule_path>`가 dirty 워킹트리(예: 다른 untracked)인데 모드 B로 통째 add하는 건 사용자 의도와 다를 수 있으므로, Step 2 직전에 변경 목록을 보여주고 진행 여부를 명시적으로 확인한다.

## 실패 처리

| 증상 | 대응 |
|---|---|
| 서브모듈 안 push 거부 (인증/권한) | 에러 메시지 그대로 보고 후 중단. Hames gitlink 커밋 진행 금지 |
| 서브모듈에 upstream 미설정 | `git push -u origin <branch>` 권유. 자동 실행하지 않음 |
| `<submodule_path>`에 conflict 발생 | 자동 해결 시도 금지. 상태만 보고 |
