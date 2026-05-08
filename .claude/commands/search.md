---
description: Perplexity API 실시간 웹 검색 — perplexity_tool.js 호출
---

# /search

사용법: `/search <검색어>` (예: `/search 2026 한국 숏폼 마케팅 트렌드`)

## 실행 순서

**Step 1 — 인자 확인**
- `$ARGUMENTS`가 없으면 "검색어를 입력해주세요" 요청 후 대기.

**Step 2 — 검색 실행**
```bash
node arsenal/perplexity_tool.js "$ARGUMENTS"
```

**Step 3 — 결과 보고**
- 검색 결과를 그대로 출력.
- 현재 활성 에이전트 프레임(Marketer / CSO 등)에 맞게 핵심 인사이트 1~3줄 요약 추가.
- 출처 URL은 결과에 포함된 것만 표시. 임의 생성 금지.
