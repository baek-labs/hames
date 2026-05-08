---
description: 완료된 핸드오프 파일을 _Archive로 이동 — close_handoff.ps1 실행
---

# /close-handoff

사용법: `/close-handoff <handoff_id 또는 파일 경로>`
(예: `/close-handoff HAMES-20260424-001` 또는 `/close-handoff ai_comm/_Inbox/Handoff_HAMES-20260424-001.md`)

## 실행 순서

**Step 1 — 파일 경로 결정**
- `$ARGUMENTS`가 파일 경로 형식이면 그대로 사용.
- HandoffId만 전달된 경우: `ai_comm/_Inbox/Handoff_{id}.md` 로 변환.
- 인자가 없으면 `_Inbox`에 있는 핸드오프 파일 목록 출력 후 선택 요청.

**Step 2 — 아카이브 실행**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File arsenal/close_handoff.ps1 `
  -HandoffFile "<resolved_path>"
```

**Step 3 — 결과 보고**
- 성공: 이동된 경로(`_Archive/`) 출력.
- 실패: 오류 메시지 명시 후 수동 확인 요청.
