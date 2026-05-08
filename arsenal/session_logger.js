/**
 * session_logger.js — Hames Session Observability
 * PostToolUse 훅으로 실행. Write/Edit 작업을 .session_log.jsonl에 한 줄씩 기록.
 * 에이전트가 읽는 용도가 아닌 CEO 회고용 로그.
 */

const fs   = require('fs');
const path = require('path');

const ARSENAL_DIR = __dirname;
const HAMES_ROOT  = path.resolve(ARSENAL_DIR, '..', '..');
const LOG_FILE    = path.join(ARSENAL_DIR, '.session_log.jsonl');

// Default workspace map. User-added isolated domains: extend at fork time
// or read from .claude/workspace_paths.json (future enhancement).
const WORKSPACE_MAP = [
    ['workspaces/Investment', 'INVEST'],
    ['workspaces/Business',   'BUSINESS'],
    ['workspaces/Company',    'COMPANY'],
    ['workspaces/Hobby',      'HOBBY'],
    ['arsenal',               'ARSENAL'],
];

function detectWorkspace(filePath) {
    if (!filePath) return null;
    const norm = filePath.replace(/\\/g, '/');
    for (const [key, ws] of WORKSPACE_MAP) {
        if (norm.includes(key)) return ws;
    }
    return 'ROOT';
}

let raw = '';
process.stdin.on('data', chunk => raw += chunk);
process.stdin.on('end', () => {
    try {
        const data      = JSON.parse(raw);
        const toolName  = data.tool_name || '';
        const toolInput = data.tool_input || {};
        const filePath  = toolInput.file_path || toolInput.path || '';

        if (!filePath) return; // 파일 대상 아니면 스킵

        const relPath   = path.relative(HAMES_ROOT, filePath).replace(/\\/g, '/');
        const workspace = detectWorkspace(filePath);

        const entry = {
            ts:        new Date().toISOString().slice(0, 19).replace('T', ' '),
            tool:      toolName,
            workspace: workspace,
            file:      relPath,
        };

        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
    } catch (_) { /* non-fatal — 로그 실패가 작업을 막으면 안 됨 */ }
});
