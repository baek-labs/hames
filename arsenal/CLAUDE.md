# HAMES ARSENAL — 툴 레지스트리 (v5.2)

> FORMAT RULE: 테이블에 기능 설명 컬럼 금지. 파일명 + 호출 명령어만 기재. 설명이 필요하면 별도 문서로.

---

## Python Tools

| 파일 | 호출 |
|---|---|
| `manager.py` | `python manager.py <target_dir> \| --all` |
| `hames_doctor.py` | `python arsenal/hames_doctor.py` |
| `index_post_write_auditor.py` | `python arsenal/index_post_write_auditor.py` |
| `investor.py` | `python investor.py` |
| `pdf_manager.py` | `python pdf_manager.py <pdf_path>` |
| `ppt_manager.py` | `python ppt_manager.py <args>` |
| `video_manager.py` | `python video_manager.py <video_path> <output_path>` |
| `audio_transcriber.py` | `python audio_transcriber.py <audio_path> [...] [--output <path>] [--language ko]` |
| `openai_specialist.py` | `python openai_specialist.py --role <role> --prompt "<query>"` |

---

## PowerShell Tools

| 파일 | 호출 |
|---|---|
| `start_hames_gemini.ps1` | `powershell -File arsenal/start_hames_gemini.ps1` |
| `start_hames_codex.ps1` | `powershell -File arsenal/start_hames_codex.ps1` |
| `set_hames_utf8.ps1` | `powershell -File arsenal/set_hames_utf8.ps1` |
| `hames_wrap.ps1` | `powershell -File arsenal/hames_wrap.ps1 -Model <claude\|gemini\|codex> -Prompt "<text>"` |
| `set_workspace_lock.ps1` | `powershell -File arsenal/set_workspace_lock.ps1 -Workspace <workspace>` |
| `sync_skills.ps1` | `powershell -File arsenal/sync_skills.ps1 [-DryRun]` |
| `run_hames_guarded.ps1` | `powershell -File arsenal/run_hames_guarded.ps1 -Mode <mode>` |
| `create_handoff.ps1` | `powershell -File arsenal/create_handoff.ps1` |
| `validate_handoff.ps1` | `powershell -File arsenal/validate_handoff.ps1` |
| `close_handoff.ps1` | `powershell -File arsenal/close_handoff.ps1` |

---

## JavaScript Tools (Node.js)

| 파일 | 호출 |
|---|---|
| `google_tool.js` | `node google_tool.js <action> <args>` |
| `notion_tool.js` | `node notion_tool.js <action> <args>` |
| `perplexity_tool.js` | `node perplexity_tool.js "<query>"` |
| `naver_blog_scraper.js` | `node naver_blog_scraper.js [blogId]` |
| `naver_keyword_tool.js` | `node naver_keyword_tool.js "<seed1>" "<seed2>"` |
| `seo_report.js` | `node seo_report.js` |
| `compliance_auditor.js` | `node compliance_auditor.js <file>` (Hook) |
| `verify_frontmatter_block.js` | PreToolUse Hook — Anti workspace frontmatter gate |
| `verify_tasks.js` | `node verify_tasks.js <file>` (Hook) |
| `verify_edit_surgery.js` | `node verify_edit_surgery.js` (Hook) |
| `update_arsenal_permissions.js` | `node update_arsenal_permissions.js` (Hook) |
| `session_logger.js` | PostToolUse Hook — `.session_log.jsonl` 기록 |
| `.claude/hooks/workspace_guard.js` | PreToolUse Hook — 워크스페이스 잠금 집행 |

---

## MCP Servers (Local)

| 서버 | 제공 도구 (주요 기능) |
|---|---|
| `memory` | `create_entities`, `add_observations`, `search_nodes` (장기 기억/지식 그래프) |

---

## Shell Tools

| 파일 | 호출 |
|---|---|
| `pre_push_guard.sh` | git hook (`.git/hooks/pre-push`) |

---

## 도구 우선순위 (Document Processing)

PDF / PPT / DOCX / XLSX 작업 시:
1. Arsenal 스크립트 우선 (`pdf_manager.py`, `ppt_manager.py` 등)
2. Arsenal로 처리 불가한 복잡한 편집(폼 필드 추출·작성, 트랙 변경, 수식 재계산 등)에 한해 Anthropic 스킬(`document-skills`) 사용
3. Anthropic 스킬은 Claude Code 전용 — Codex/Gemini 세션에서는 Arsenal 스크립트만 사용

---

## API Keys — `.Arsenal/.env`

| 키 | 대상 |
|---|---|
| `OPENAI_API_KEY` | openai_specialist.py |
| `PERPLEXITY_API_KEY` | perplexity_tool.js |
| `NOTION_KEY` | notion_tool.js |
| `GOOGLE_MAPS_KEY` | google_tool.js |
| `NAVER_AD_API_KEY` / `NAVER_AD_SECRET_KEY` / `NAVER_AD_CUSTOMER_ID` | naver_keyword_tool.js |
| Google OAuth | credentials.json / token.json |
