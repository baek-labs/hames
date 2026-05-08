---
description: Hames 루트 전체 변경분 커밋 → main push (서브모듈 안전 검증 포함)
---

# /save

Hames 루트의 모든 변경분(`.gitignore` 제외)을 한 번에 커밋하고 main에 push한다. 서브모듈이 이미 push된 상태라는 전제 위에서, 어떤 서브모듈이라도 unpushed/dirty 상태이면 즉시 멈춰 경고한다.

## 사용법

```
/save
```

인자 없음. 커밋 메시지는 자동 생성.

## 사전 조건

- CWD가 Hames 루트(`{{HAMES_ROOT}}`)여야 한다.
- 현재 브랜치가 `main`이어야 한다.

## 실행 순서

**Step 1 — 환경 검증**
```bash
git rev-parse --show-toplevel
git branch --show-current
```
- 루트가 Hames 루트가 아니면 중단.
- 브랜치가 `main`이 아니면 "main 브랜치에서만 실행 가능" 출력 후 중단.

**Step 2 — 서브모듈 안전 검증 (블로킹)**

`.gitmodules`에 등록된 모든 서브모듈을 순회하며 두 항목을 확인한다. 하나라도 걸리면 즉시 중단하고 문제 서브모듈을 모두 모아 한 번에 보고한다.

```bash
git config --file .gitmodules --get-regexp path
```

각 서브모듈에 대해:
```bash
cd <submodule_path>
git status --porcelain        # 출력이 있으면 더티
git rev-list --left-right --count '@{u}...HEAD'   # 우측이 ahead
```

차단 조건:
- `git status --porcelain` 출력이 비어있지 않다 → "더티 워킹트리"
- ahead > 0 → "unpushed commit 있음"
- upstream 미설정(`fatal: no upstream`) → "upstream 미설정"

차단 시 출력 형식:
```
서브모듈 안전 검증 실패. push 중단.
- <path1>: 더티 워킹트리
- <path2>: unpushed commit 3개
```
이후 사용자에게 `/subpush <path>` 또는 직접 정리 후 재실행 안내.

**Step 3 — 루트 변경 유무 확인**

**부정형 결론 안전장치:** 아래 명령의 raw 출력을 화면에 그대로 박은 뒤에만 결론을 낸다. "변경사항 없음"이라는 부정형 결론을 raw 출력 표시 없이 내릴 수 없다.

```bash
cd {{HAMES_ROOT}}
git status --porcelain --untracked-files=all
```
- raw 출력을 그대로(요약·재해석 금지) 사용자에게 표시.
- raw 출력이 진짜로 0줄일 때만 "변경사항 없음" 후 종료.
- 1줄이라도 있으면 Step 4로 (gitlink 변경이 있든 없든 무관 — 루트 변경만 있어도 진행).

**Step 4 — 일괄 스테이징**
```bash
git add -A
```

**Step 5 — 자동 커밋 메시지 생성**

`git diff --cached --name-only`로 스테이지 목록을 받아 다음 규칙으로 메시지 결정:

- 변경이 서브모듈 gitlink 1개뿐: `chore: bump <path> gitlink`
- 변경이 서브모듈 gitlink 2개 이상이고 루트 파일 변경 없음: `chore: bump gitlinks (<path1>, <path2>, ...)`
- 그 외 (루트 파일 변경 포함 / 혼합 / 루트만): `chore: snapshot YYYY-MM-DD HH:MM` (현지 시간)

```bash
git commit -m "<message>"
```

**Step 6 — push**
```bash
git push origin main
```

**Step 7 — 검증 보고**
```bash
git rev-list --left-right --count origin/main...HEAD
```
- `0	0`이면 "save 완료 — <commit message>" 한 줄.
- 그 외엔 ahead/behind 숫자 + 다음 액션.

## 안전 규칙

- Step 2에서 서브모듈 하나라도 더티/unpushed/upstream 미설정이면 어떤 스테이징도 하지 않는다.
- `--force`, `--no-verify` 등 destructive 옵션 금지.
- main 외 브랜치에서 호출되면 즉시 중단. 자동 브랜치 전환 금지.
- 자동으로 `git pull` / `git stash` 시도하지 않는다.
- 커밋 메시지에 `Co-Authored-By` 추가하지 않는다.

## 실패 처리

| 증상 | 대응 |
|---|---|
| 서브모듈 더티 또는 unpushed | Step 2에서 중단. 사용자가 정리 또는 `/subpush` 후 재실행. |
| Hames push 거부 (behind) | 커밋은 이미 됨을 알리고 `git pull --rebase origin main` 권유. 자동 실행 금지. |
| 루트 변경 없음 | "변경사항 없음" 한 줄 후 종료. 빈 커밋 만들지 않는다. |
| conflict 발생 | 자동 해결 시도 금지. 상태만 보고. |
