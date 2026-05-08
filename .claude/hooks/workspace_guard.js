#!/usr/bin/env node
/**
 * workspace_guard.js - PreToolUse Workspace Lock Enforcer
 * [Hames Harness v1.1]
 *
 * Lock ON  -> Write/Edit to files outside active workspace: blocked
 *           -> Bash with write patterns + other workspace path: blocked
 *           -> Read/Glob/Grep: always pass
 *           -> SYSTEM_ADMIN paths (.Arsenal, 999_AI_Communication, .claude): always pass
 * Lock OFF -> everything passes
 *
 * Lock format (session-scoped only — default/legacy 포맷은 더 이상 enforcement 대상 아님):
 *   {
 *     "version": 2,
 *     "sessions": {
 *       "codex-20260507-143012-a91f": {"workspace":"MyDomain","locked":true}
 *     }
 *   }
 *
 * Lock 결정 룰:
 *   - sessions[현재_세션ID].locked === true → 해당 워크스페이스로 잠김
 *   - 그 외 모든 경우 (항목 없음 / 다른 포맷) → unlocked
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Derive root from this file's location: .claude/hooks/ -> root
const ROOT = path.resolve(__dirname, '..', '..');
const LOCK_FILE = path.join(ROOT, '.claude', '.workspace_lock');
const PATHS_FILE = path.join(ROOT, '.claude', 'workspace_paths.json');
const AUDIT_LOG = path.join(ROOT, '.claude', 'workspace_audit.log');

// SYSTEM_ADMIN paths: always writable regardless of lock
const SYSTEM_ADMIN = [
  path.join(ROOT, 'Anti', '.Arsenal'),
  path.join(ROOT, 'Anti', '999_AI_Communication'),
  path.join(ROOT, '.claude'),
];

// Tools that only read - always pass
const READ_ONLY_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'LS'
]);

// Write tools that carry a file_path
const WRITE_TOOLS = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit'
]);

// Bash write-intent patterns (best-effort)
const BASH_WRITE_RE = /\s*>+\s*|\btee\b|\bcp\b|\bmv\b|\brm\b|\bmkdir\b|\brmdir\b|\bln\b/;

function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function resolveSessionId(data) {
  return firstString(
    process.env.HAMES_SESSION_ID,
    process.env.CODEX_THREAD_ID,
    process.env.CLAUDE_SESSION_ID,
    process.env.GEMINI_SESSION_ID,
    process.env.SESSION_ID,
    data.hames_session_id,
    data.hamesSessionId,
    data.session_id,
    data.sessionId,
    data.conversation_id,
    data.conversationId,
    data.thread_id,
    data.threadId
  );
}

function normalizeLockRecord(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    workspace: record.workspace || null,
    locked: record.locked === true,
  };
}

function effectiveLock(lock, sessionId) {
  // Lock 결정은 sessions[sessionId] 항목에만 위임.
  // default / legacy flat 포맷은 더 이상 lock enforcement에 영향 없음.
  if (lock && lock.sessions && sessionId && lock.sessions[sessionId]) {
    const sessionLock = normalizeLockRecord(lock.sessions[sessionId]);
    if (sessionLock) return { ...sessionLock, scope: 'session', sessionId };
  }
  return { workspace: null, locked: false, scope: 'none', sessionId };
}

function norm(p) {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function isUnder(filePath, basePath) {
  const f = norm(filePath);
  const b = norm(basePath);
  return f === b || f.startsWith(b + '/');
}

function isSystemAdmin(filePath) {
  return SYSTEM_ADMIN.some(a => isUnder(filePath, a));
}

function audit(result, tool, filePath, lock) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      result,
      tool,
      path: filePath,
      workspace: lock.workspace,
      lock_scope: lock.scope,
      session_id: lock.sessionId || null,
    }) + '\n';
    fs.appendFileSync(AUDIT_LOG, line);
  } catch { /* non-blocking */ }
}

function lockLabel(lock) {
  return lock.sessionId ? `${lock.scope}:${lock.sessionId}` : lock.scope;
}

function block(msg, tool, filePath, lock) {
  audit('BLOCKED', tool, filePath, lock);
  process.stderr.write(msg + '\n');
  // exit 2: Claude/Gemini/Codex all treat this as a blocked tool.
  process.exit(2);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(raw); }
  catch { process.exit(0); }

  const toolName = data.tool_name || '';
  const toolInput = data.tool_input || {};

  // Read-only tools: always pass
  if (READ_ONLY_TOOLS.has(toolName)) {
    process.exit(0);
  }

  // The Hames launcher/app runtime assigns the session key; users only choose workspace.
  const rawLock = readJSON(LOCK_FILE, { workspace: null, locked: false });
  const lock = effectiveLock(rawLock, resolveSessionId(data));
  if (!lock.locked || !lock.workspace) {
    process.exit(0);
  }

  const rawPaths = readJSON(PATHS_FILE, {});
  // Resolve relative paths against ROOT so the same config works on Windows/macOS/Linux.
  const paths = {};
  for (const [k, v] of Object.entries(rawPaths)) {
    paths[k] = path.isAbsolute(v) ? v : path.resolve(ROOT, v);
  }
  const activeName = lock.workspace;
  const activePath = paths[activeName];
  if (!activePath) process.exit(0);

  if (WRITE_TOOLS.has(toolName)) {
    const filePath = toolInput.file_path || '';
    if (!filePath) process.exit(0);

    if (isSystemAdmin(filePath)) {
      audit('ALLOWED_SYSADMIN', toolName, filePath, lock);
      process.exit(0);
    }

    if (isUnder(filePath, activePath)) {
      audit('ALLOWED', toolName, filePath, lock);
      process.exit(0);
    }

    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
    block(
      `[WORKSPACE GUARD] Lock=${activeName} (${lockLabel(lock)}). ${toolName} -> "${rel}" blocked.\n` +
      'To proceed: /lock <workspace>  or  "고정 해제"',
      toolName, filePath, lock
    );
  }

  if (toolName === 'Bash') {
    const cmd = toolInput.command || '';

    for (const [wsName, wsPath] of Object.entries(paths)) {
      if (wsName === activeName) continue;

      const wsNorm = norm(wsPath);
      const wsRel = wsPath.replace(/\\/g, '/').split('/').slice(-2).join('/');

      const refersToOther = cmd.toLowerCase().includes(wsNorm) ||
                            cmd.includes(wsPath.replace(/\\/g, '/')) ||
                            cmd.includes(wsRel);

      if (refersToOther && BASH_WRITE_RE.test(cmd)) {
        block(
          `[WORKSPACE GUARD] Lock=${activeName} (${lockLabel(lock)}). Bash write to "${wsName}" workspace blocked.\n` +
          `To proceed: /lock ${wsName}  or  "고정 해제"`,
          toolName, wsPath, lock
        );
      }
    }

    process.exit(0);
  }

  // All other tools: pass
  process.exit(0);
});
