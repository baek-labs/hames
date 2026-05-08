#!/usr/bin/env node
/**
 * context_verifier.js — PreToolUse Context Signature Enforcer
 * [Hames Harness 방어선 3 — B안 키워드 기반]
 *
 * 동작:
 *   - PreToolUse hook (Write/Edit/Bash 등 substantive tool)
 *   - 세션 transcript에서 assistant 메시지 누적 검색
 *   - context_signatures.json의 6개 시그니처 모두 출현 확인
 *   - 모두 출현 → pass / 일부 누락 → block + 누락 안내
 *
 * 우회:
 *   - 비활성 플래그: .claude/.context_verifier_disabled (응급용)
 *   - read-only tools (Read/Glob/Grep 등) — 항상 통과
 *   - transcript 접근 불가 시 fail-open (block 안 함, audit 기록만)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..', '..');
const SIGS_FILE = path.join(ROOT, '.claude', 'context_signatures.json');
const DISABLE   = path.join(ROOT, '.claude', '.context_verifier_disabled');
const AUDIT_LOG = path.join(ROOT, '.claude', 'workspace_audit.log');

const READ_ONLY_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'LS', 'TodoWrite'
]);

function readJSON(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fb; }
}

function audit(result, detail) {
  try {
    fs.appendFileSync(AUDIT_LOG, JSON.stringify({
      ts: new Date().toISOString(),
      hook: 'context_verifier',
      result,
      ...detail,
    }) + '\n');
  } catch { /* non-blocking */ }
}

function appendContentText(parts, content) {
  if (typeof content === 'string') {
    parts.push(content);
    return;
  }

  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;

    if (typeof block.text === 'string') {
      parts.push(block.text);
    } else if (typeof block.message === 'string') {
      parts.push(block.message);
    }
  }
}

function appendAssistantText(parts, obj) {
  // Claude Code transcript:
  // { type: 'assistant', message: { content: [{type:'text', text:'...'}] } }
  // Also tolerate { role: 'assistant', content: '...' } shape.
  const isClaudeAssistant = obj.type === 'assistant' || obj.role === 'assistant'
                         || obj.message?.role === 'assistant';
  if (isClaudeAssistant) {
    appendContentText(parts, obj.message?.content ?? obj.content ?? '');
    return;
  }

  // Codex Desktop/CLI transcript:
  // { type: 'response_item', payload: { type: 'message', role: 'assistant',
  //   content: [{type:'output_text', text:'...'}] } }
  const payload = obj.payload;
  const isCodexAssistant = obj.type === 'response_item'
                         && payload?.type === 'message'
                         && payload?.role === 'assistant';
  if (isCodexAssistant) {
    appendContentText(parts, payload.content ?? '');
    return;
  }

  // Codex also records visible assistant updates as event messages.
  if (obj.type === 'event_msg'
      && payload?.type === 'agent_message'
      && typeof payload.message === 'string') {
    parts.push(payload.message);
  }
}

function extractAssistantText(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;

  const parts = [];
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); }
  catch { return null; }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim().replace(/^\uFEFF/, '');
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }

    appendAssistantText(parts, obj);
  }
  return parts.join('\n');
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  // Emergency disable
  if (fs.existsSync(DISABLE)) {
    audit('SKIPPED_DISABLED', {});
    process.exit(0);
  }

  let data;
  try { data = JSON.parse(raw); }
  catch { process.exit(0); }

  const tool = data.tool_name || '';

  // Subagent calls are exempt — defense line 3 only validates the main session.
  // Parent passes signature check → context loaded → child handoff inherits context
  // via the explicit handoff package. Child transcripts are isolated and cannot see
  // parent assistant messages, so signature matching always fails for subagents.
  if (data.agent_id) {
    audit('SKIPPED_SUBAGENT', {
      tool,
      agent_id: data.agent_id,
      agent_type: data.agent_type || null,
    });
    process.exit(0);
  }

  // Read-only tools always pass
  if (READ_ONLY_TOOLS.has(tool)) {
    process.exit(0);
  }

  // Load signatures config
  const cfg = readJSON(SIGS_FILE, null);
  const sigs = cfg?.signatures;
  if (!sigs || typeof sigs !== 'object') {
    audit('SKIPPED_NO_CONFIG', { tool });
    process.exit(0);
  }
  const required = Object.values(sigs);

  // Read transcript
  const transcriptPath = data.transcript_path;
  const assistantText = extractAssistantText(transcriptPath);

  if (assistantText === null) {
    // Cannot verify — fail open (don't block) but log
    audit('SKIPPED_NO_TRANSCRIPT', { tool, transcriptPath });
    process.exit(0);
  }

  const missing = required.filter(s => !assistantText.includes(s));

  if (missing.length === 0) {
    audit('PASS', { tool });
    process.exit(0);
  }

  // BLOCK
  audit('BLOCKED', { tool, missing });

  const expectedHeader =
    'Loaded: CLAUDE.md, prompt_engineering.md, context_engineering.md, ' +
    'agent_engineering.md, harness_engineering.md, arsenal/CLAUDE.md';
  const expectedSigs = 'Signatures: ' + required.join(' | ');

  process.stderr.write(
    `[CONTEXT VERIFIER] 방어선 3 — 컨텍스트 검증 실패.\n` +
    `누락 시그니처 (${missing.length}/${required.length}): ${missing.join(' | ')}\n` +
    `\n` +
    `해결: 도구 호출 전, 첫 substantive 응답에 다음 두 줄을 포함하라:\n` +
    `${expectedHeader}\n` +
    `${expectedSigs}\n` +
    `\n` +
    `우회 (응급): touch ${path.relative(ROOT, DISABLE)}\n`
  );
  // exit 2: Claude/Gemini/Codex 모두 BLOCK 의미 (exit 1은 Gemini에서 warning만 됨)
  process.exit(2);
});
