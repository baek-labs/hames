#!/usr/bin/env node
/**
 * hook_adapter.js — Cross-CLI Hook Input Normalizer
 * [Hames Harness v1.1 — Cursor 지원 추가]
 *
 * Gemini CLI / Codex CLI / Cursor IDE에서 발동된 hook stdin을 Claude Code 호환
 * 형식으로 normalize 후 원본 hook 스크립트에 subprocess로 전달한다.
 *
 * Usage:
 *   node hook_adapter.js <target_hook_script.js>
 *
 * Claude Code는 어댑터 미경유, 직접 hook 호출 (이전 동작 유지).
 *
 * 정규화 영역:
 *   - 필드명: tool_name / toolName / tool / name → tool_name
 *   - 필드명: tool_input / toolInput / input / arguments → tool_input
 *   - 도구 이름: WriteFile/write_file → Write, replace → Edit, Shell/run_shell_command → Bash
 *   - 입력 키: file_path / absolute_path / path → file_path, command / shell_command → command
 *   - Cursor: hook_event_name 기반 합성 (afterFileEdit → Edit, beforeShellExecution → Bash,
 *     beforeSubmitPrompt → UserPromptSubmit). 최상위 file_path/command/edits/prompt를 tool_input에 끌어올림.
 */

'use strict';

const { spawnSync } = require('child_process');

// 도구 이름 매핑 (Gemini → Claude)
const TOOL_MAP = {
  // Gemini CLI
  'WriteFile':         'Write',
  'write_file':        'Write',
  'EditFile':          'Edit',
  'replace':           'Edit',
  'Shell':             'Bash',
  'run_shell_command': 'Bash',
  // Codex CLI는 Claude 호환 이름 사용 — pass-through
};

// Cursor IDE 이벤트 → Claude tool_name 매핑 (synthetic — Cursor는 tool_name 필드 없음)
const CURSOR_EVENT_TO_TOOL = {
  'afterFileEdit':         'Edit',
  'afterTabFileEdit':      'Edit',
  'beforeShellExecution':  'Bash',
  'afterShellExecution':   'Bash',
  'beforeMCPExecution':    'Mcp',
  'afterMCPExecution':     'Mcp',
  'beforeSubmitPrompt':    'UserPromptSubmit',
  'beforeTabFileRead':     'Read',
  'sessionStart':          'SessionStart',
  'sessionEnd':            'SessionEnd',
  'preCompact':            'PreCompact',
  'stop':                  'Stop',
};

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(raw); }
  catch { data = {}; }

  // 필드명 정규화 (어떤 CLI에서 와도 Claude Code 형식으로)
  const rawToolName  = data.tool_name  || data.toolName  || data.tool || data.name || '';
  const rawToolInput = data.tool_input || data.toolInput || data.input || data.arguments || {};

  // 도구 이름 매핑 — Cursor 이벤트가 있으면 합성 우선
  let toolName;
  let toolInput;

  const cursorEvent = data.hook_event_name && CURSOR_EVENT_TO_TOOL[data.hook_event_name];
  if (cursorEvent) {
    toolName = cursorEvent;
    // Cursor는 최상위에 file_path / command / edits / prompt 직접 노출 — tool_input으로 끌어올림
    toolInput = {};
    if (data.file_path)   toolInput.file_path = data.file_path;
    if (data.command)     toolInput.command   = data.command;
    if (data.edits)       toolInput.edits     = data.edits;
    if (data.prompt)      toolInput.prompt    = data.prompt;
    if (data.attachments) toolInput.attachments = data.attachments;
  } else {
    toolName = TOOL_MAP[rawToolName] || rawToolName;
    toolInput = { ...rawToolInput };
    const fp = toolInput.file_path || toolInput.absolute_path || toolInput.path;
    if (fp && !toolInput.file_path) toolInput.file_path = fp;
    const cmd = toolInput.command || toolInput.shell_command;
    if (cmd && !toolInput.command) toolInput.command = cmd;
  }

  // 정규화된 페이로드
  const normalized = {
    ...data,
    tool_name:  toolName,
    tool_input: toolInput,
  };

  // 원본 hook 호출
  const targetScript = process.argv[2];
  if (!targetScript) {
    process.stderr.write('[hook_adapter] missing target script argument\n');
    process.exit(0);
  }

  const result = spawnSync('node', [targetScript], {
    input: JSON.stringify(normalized),
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
  });

  process.exit(result.status || 0);
});
