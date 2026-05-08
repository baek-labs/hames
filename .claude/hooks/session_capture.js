#!/usr/bin/env node
/**
 * session_capture.js - SessionStart hook
 * [Hames Harness — Claude session_id auto-capture]
 *
 * Purpose:
 *   Claude Code does not export CLAUDE_SESSION_ID to subprocess env, so the
 *   PowerShell helper invoked from /lock cannot tell which Claude session
 *   issued the command. This hook fires at SessionStart, reads the session_id
 *   from the hook payload, and stashes it at:
 *
 *     .claude/sessions/<claude_code_pid>.id
 *
 *   The Claude Code process is the parent of this hook process, so
 *   process.ppid identifies it uniquely. set_workspace_lock.ps1 and
 *   workspace_guard.js walk the parent process chain to find a matching
 *   <pid>.id file and use the contents as the session key.
 *
 *   Net effect: per-window /lock works automatically, matching the way
 *   CODEX_THREAD_ID auto-injection works in Codex.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SESSIONS_DIR = path.join(ROOT, '.claude', 'sessions');
const TTL_MS = 24 * 60 * 60 * 1000; // 24h — stale entries from dead Claude PIDs

// On Windows, process.ppid often points at a short-lived helper that dies
// before /lock runs. Walk the parent chain and stamp .id for every ancestor
// whose process name matches a host CLI/IDE we care about, so that
// set_workspace_lock.ps1's parent-chain walk hits a live, matching PID.
const HOST_PROCESS_RE = /^(claude|claude code|claude_code|claude-code|code|codex|gemini|electron)(\.exe)?$/i;

function findWindowsHostAncestors(seedPid) {
  if (process.platform !== 'win32') return [];
  if (!seedPid || seedPid <= 1) return [];
  try {
    const ps = `
      $cur = ${seedPid};
      for ($d = 0; $d -lt 12 -and $cur -gt 0; $d++) {
        try { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $cur) -ErrorAction Stop } catch { break }
        if (-not $p) { break }
        Write-Output ($cur.ToString() + '|' + $p.Name)
        if (-not $p.ParentProcessId) { break }
        $cur = [int]$p.ParentProcessId
      }
    `;
    const out = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command -',
      { input: ps, encoding: 'utf8', timeout: 4000, windowsHide: true }
    );
    const result = [];
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [pidStr, name] = trimmed.split('|');
      if (!pidStr || !name) continue;
      if (HOST_PROCESS_RE.test(name.trim())) {
        const pid = parseInt(pidStr, 10);
        if (Number.isFinite(pid) && pid > 1) result.push(pid);
      }
    }
    return result;
  } catch {
    return [];
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(raw || '{}'); } catch { /* ignore */ }

  const sessionId = (data.session_id || data.sessionId || '').toString().trim();
  if (!sessionId) process.exit(0);

  const ppid = process.ppid;
  if (!ppid || ppid <= 1) process.exit(0);

  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });

    const now = Date.now();
    for (const entry of fs.readdirSync(SESSIONS_DIR)) {
      const fp = path.join(SESSIONS_DIR, entry);
      try {
        const st = fs.statSync(fp);
        if (now - st.mtimeMs > TTL_MS) fs.unlinkSync(fp);
      } catch { /* ignore */ }
    }

    const targets = new Set([ppid, ...findWindowsHostAncestors(ppid)]);
    for (const pid of targets) {
      const file = path.join(SESSIONS_DIR, `${pid}.id`);
      try { fs.writeFileSync(file, sessionId, 'utf8'); } catch { /* non-blocking */ }
    }
  } catch { /* non-blocking */ }

  process.exit(0);
});
