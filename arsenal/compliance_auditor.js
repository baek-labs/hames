/**
 * Hames System Compliance Auditor (v2.0) - Hard Enforcement Layer
 *
 * 실행 모드:
 *   Hook 모드 (인수 없음): Claude Code PreToolUse 훅으로 자동 호출. stdin에서 도구 호출 JSON 수신.
 *   Manual 모드 (인수 있음): node compliance_auditor.js <file_path>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const SNAPSHOT_DIR = path.join(os.tmpdir(), 'hames-edit-snapshots');
const LARGE_EDIT_RATIO = 0.6;
const LARGE_EDIT_LINE_COUNT = 120;

// CEO 명시 승인 토큰 — Bash 명령에 `CEO:OK` 포함 시 위험 패턴 차단을 우회한다.
// git rm / git mv 는 history 로 복구 가능하므로 별도 토큰 없이 자동 카브아웃.
// 모든 우회는 .claude/workspace_audit.log 에 BYPASS 항목으로 기록된다.
const CEO_OVERRIDE_RE = /\bCEO:OK\b/;
const GIT_RECOVERABLE_RE = /^\s*git\s+(rm|mv)\b/i;

function logAuditBypass(entry) {
    try {
        const root = path.resolve(__dirname, '..', '..');
        const auditPath = path.join(root, '.claude', 'workspace_audit.log');
        fs.appendFileSync(auditPath, JSON.stringify({
            ts: new Date().toISOString(),
            hook: 'compliance_auditor',
            result: 'BYPASS',
            ...entry,
        }) + '\n');
    } catch { /* non-blocking */ }
}

function ensureSnapshotDir() {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function getSnapshotPath(filePath) {
    const key = Buffer.from(path.resolve(filePath), 'utf8').toString('base64url');
    return path.join(SNAPSHOT_DIR, `${key}.json`);
}

function countLines(text) {
    if (!text) return 0;
    return text.split(/\r?\n/).length;
}

function saveSnapshot(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    ensureSnapshotDir();
    const resolvedPath = path.resolve(filePath);
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const payload = {
        file_path: resolvedPath,
        content,
        size: content.length,
        lines: countLines(content),
        captured_at: new Date().toISOString()
    };
    fs.writeFileSync(getSnapshotPath(resolvedPath), JSON.stringify(payload), 'utf8');
}

function stripWrappingQuotes(value) {
    if (!value) return value;
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

function isNullDevice(target) {
    const normalized = target.trim().replace(/\\/g, '/').toLowerCase();
    return normalized === 'nul' || normalized === '/dev/null';
}

function resolveExistingTarget(rawTarget) {
    const cleanedTarget = stripWrappingQuotes(rawTarget);
    if (!cleanedTarget || cleanedTarget.startsWith('&') || isNullDevice(cleanedTarget)) {
        return null;
    }

    const resolved = path.isAbsolute(cleanedTarget)
        ? cleanedTarget
        : path.resolve(process.cwd(), cleanedTarget);

    if (!fs.existsSync(resolved)) {
        return null;
    }

    return { rawTarget: cleanedTarget, resolved };
}

function findOverwriteRedirectionTarget(cmd) {
    const redirectRegex = /(?:^|\s)(?:\d)?>(?!>)\s*("[^"]+"|'[^']+'|\S+)/g;
    let match;

    while ((match = redirectRegex.exec(cmd)) !== null) {
        const resolvedTarget = resolveExistingTarget(match[1]);
        if (resolvedTarget) {
            return resolvedTarget;
        }
    }

    return null;
}

function findPowerShellOverwriteTarget(cmd) {
    const targetPatterns = [
        /\bSet-Content\b[\s\S]*?(?:-LiteralPath|-Path)\s+("[^"]+"|'[^']+'|\S+)/i,
        /\bOut-File\b(?![\s\S]*-Append\b)[\s\S]*?-FilePath\s+("[^"]+"|'[^']+'|\S+)/i,
        /\bWriteAllText\s*\(\s*("[^"]+"|'[^']+')/i,
    ];

    for (const pattern of targetPatterns) {
        const match = cmd.match(pattern);
        if (!match) continue;

        const resolvedTarget = resolveExistingTarget(match[1]);
        if (resolvedTarget) {
            return resolvedTarget;
        }
    }

    return null;
}

function extractWindowsPath(detail) {
    if (typeof detail !== 'string') return '';
    const match = detail.match(/[A-Za-z]:\\[^\n\r]*/);
    return match ? match[0] : '';
}

// [INBOX GUARD] 00_Inbox 경로(*/00_Inbox/* 어디든)는 CEO input only.
function isInboxPath(p) {
    if (!p) return false;
    const norm = String(p).replace(/\\/g, '/').toLowerCase();
    return /(^|\/)00_inbox(\/|$)/.test(norm);
}

function findInboxWriteTarget(cmd) {
    const patterns = [
        /(?:^|\s)(?:\d)?>>?\s*("[^"]*00_Inbox[^"]*"|'[^']*00_Inbox[^']*'|\S*00_Inbox\S*)/i,
        /\bOut-File\b[\s\S]*?-FilePath\s+("[^"]*00_Inbox[^"]*"|'[^']*00_Inbox[^']*'|\S*00_Inbox\S*)/i,
        /\b(?:Set-Content|Add-Content)\b[\s\S]*?(?:-LiteralPath|-Path)\s+("[^"]*00_Inbox[^"]*"|'[^']*00_Inbox[^']*'|\S*00_Inbox\S*)/i,
        /\btee\b[\s\S]*?("[^"]*00_Inbox[^"]*"|'[^']*00_Inbox[^']*'|\S*00_Inbox\S*)/i,
    ];
    for (const p of patterns) {
        const m = cmd.match(p);
        if (m) return stripWrappingQuotes(m[1]);
    }
    return null;
}

// ─── Hook 모드: 덮어쓰기 및 위험 명령 차단 ───────────────────────────────────

// Hook mode: guardrails for overwrite, rewrite, and destructive shell patterns.
function legacyBlock(reason, detail) {
    process.stderr.write('\n[HAMES HARNESS] BLOCKED\n');
    process.stderr.write(`사유: ${reason}\n`);
    if (detail) process.stderr.write(`${detail}\n`);
    process.stderr.write('→ CEO 명시적 승인 없이 실행 불가.\n\n');
    // exit 2: Claude/Gemini/Codex 모두 BLOCK 의미
    process.exit(2);
}

function legacyNormalizeBlockPayload(reason, detail) {
    if (reason.startsWith('OVERWRITE BLOCKED')) {
        return {
            reason: 'OVERWRITE BLOCKED — 기존 파일에 Write 도구 사용 금지.',
            detail
        };
    }

    if (reason.startsWith('SURGICAL EDIT REQUIRED')) {
        return {
            reason: 'SURGICAL EDIT REQUIRED — old_string 없는 Edit 수정 금지.',
            detail
        };
    }

    if (reason.startsWith('GLOBAL REPLACE BLOCKED')) {
        return {
            reason: 'GLOBAL REPLACE BLOCKED — replace_all Edit 금지.',
            detail
        };
    }

    if (reason.startsWith('WHOLE-FILE EDIT BLOCKED')) {
        return {
            reason: 'WHOLE-FILE EDIT BLOCKED — 파일 전체를 old_string 으로 지정한 Edit 감지.',
            detail
        };
    }

    if (reason.startsWith('LARGE EDIT BLOCKED')) {
        return {
            reason: 'LARGE EDIT BLOCKED — 부분 수정 원칙을 넘는 대형 Edit 감지.',
            detail
        };
    }

    return { reason, detail };
}

const legacyNormalizedBlock = function(reason, detail) {
    const normalized = legacyNormalizeBlockPayload(reason, detail);
    if (reason.startsWith('DANGEROUS BASH') && typeof detail === 'string') {
        normalizedReason = 'DANGEROUS BASH | 위험한 Bash 명령 감지';
        const parts = detail.split('\n');
        const commandValue = parts[0].replace(/^[^:]+:\s*/, '');
        const targetValue = parts[1] ? parts[1].replace(/^[^:]+:\s*/, '') : '';
        normalizedDetail = targetValue
            ? `Command: ${commandValue}\nTarget: ${targetValue}`
            : `Command: ${commandValue}`;
    }

    process.stderr.write('\n[HAMES HARNESS] BLOCKED\n');
    process.stderr.write(`사유: ${normalized.reason}\n`);
    if (normalized.detail) process.stderr.write(`${normalized.detail}\n`);
    process.stderr.write('→ CEO 명시적 승인 없이 실행 불가.\n\n');
    // exit 2: Claude/Gemini/Codex 모두 BLOCK 의미
    process.exit(2);
};

const legacyGarbledBlock = function(reason, detail) {
    let normalizedReason = reason;
    let normalizedDetail = detail;

    if (reason.startsWith('OVERWRITE BLOCKED')) {
        normalizedReason = 'OVERWRITE BLOCKED | 기존 파일에 Write 도구를 사용할 수 없습니다.';
    } else if (reason.startsWith('SURGICAL EDIT REQUIRED')) {
        normalizedReason = 'SURGICAL EDIT REQUIRED | old_string 없는 Edit 는 허용되지 않습니다.';
    } else if (reason.startsWith('GLOBAL REPLACE BLOCKED')) {
        normalizedReason = 'GLOBAL REPLACE BLOCKED | replace_all Edit 는 허용되지 않습니다.';
    } else if (reason.startsWith('WHOLE-FILE EDIT BLOCKED')) {
        normalizedReason = 'WHOLE-FILE EDIT BLOCKED | 파일 전체를 old_string 으로 지정한 Edit 가 감지되었습니다.';
    } else if (reason.startsWith('LARGE EDIT BLOCKED')) {
        normalizedReason = 'LARGE EDIT BLOCKED | 부분 수정 원칙을 벗어나는 대형 Edit 가 감지되었습니다.';
    } else if (reason.startsWith('DANGEROUS BASH')) {
        normalizedReason = reason.replace('DANGEROUS BASH', 'DANGEROUS BASH | 위험한 Bash 명령 감지');
    }

    process.stderr.write('\n[HAMES HARNESS] BLOCKED\n');
    process.stderr.write(`사유: ${normalizedReason}\n`);
    if (normalizedDetail) process.stderr.write(`${normalizedDetail}\n`);
    process.stderr.write('→ CEO 명시적 승인 없이 실행할 수 없습니다.\n\n');
    // exit 2: Claude/Gemini/Codex 모두 BLOCK 의미
    process.exit(2);
};

// Final active formatter used by the hook path.
function block(reason, detail) {
    let normalizedReason = reason;
    let normalizedDetail = detail;

    if (reason.startsWith('OVERWRITE BLOCKED')) {
        normalizedReason = 'OVERWRITE BLOCKED | Write cannot target an existing file.';
        const filePath = extractWindowsPath(detail);
        normalizedDetail = filePath
            ? `File: ${filePath}\nUse Edit to replace only the specific block that changed.`
            : 'Use Edit to replace only the specific block that changed.';
    } else if (reason.startsWith('SURGICAL EDIT REQUIRED')) {
        normalizedReason = 'SURGICAL EDIT REQUIRED | Edit must include a specific old_string.';
        const filePath = extractWindowsPath(detail);
        normalizedDetail = filePath
            ? `File: ${filePath}\nEdit must specify the exact old_string being replaced.`
            : 'Edit must specify the exact old_string being replaced.';
    } else if (reason.startsWith('GLOBAL REPLACE BLOCKED')) {
        normalizedReason = 'GLOBAL REPLACE BLOCKED | replace_all edits are not allowed.';
        const filePath = extractWindowsPath(detail);
        normalizedDetail = filePath
            ? `File: ${filePath}\nreplace_all edits are not allowed in this workspace.`
            : 'replace_all edits are not allowed in this workspace.';
    } else if (reason.startsWith('WHOLE-FILE EDIT BLOCKED')) {
        normalizedReason = 'WHOLE-FILE EDIT BLOCKED | Edit appears to target the whole file.';
        const filePath = extractWindowsPath(detail);
        normalizedDetail = filePath
            ? `File: ${filePath}\nold_string matches the full file content.`
            : 'old_string matches the full file content.';
    } else if (reason.startsWith('LARGE EDIT BLOCKED')) {
        normalizedReason = 'LARGE EDIT BLOCKED | Edit exceeds the partial-edit threshold.';
        const filePath = extractWindowsPath(detail);
        const ratioMatch = typeof detail === 'string' ? detail.match(/old_string ratio:\s*([^\n\r]+)/) : null;
        const lineMatch = typeof detail === 'string' ? detail.match(/old_string lines:\s*([^\n\r]+)/) : null;
        const detailLines = [];
        if (filePath) detailLines.push(`File: ${filePath}`);
        if (ratioMatch) detailLines.push(`old_string ratio: ${ratioMatch[1]}`);
        if (lineMatch) detailLines.push(`old_string lines: ${lineMatch[1]}`);
        detailLines.push('Edit exceeds the allowed partial-edit threshold.');
        normalizedDetail = detailLines.join('\n');
    } else if (reason.startsWith('DANGEROUS BASH')) {
        normalizedReason = 'DANGEROUS BASH | Dangerous Bash command detected.';
        if (typeof detail === 'string') {
            const parts = detail.split('\n');
            const commandMatch = parts[0].match(/:\s*(.+)$/);
            const commandValue = commandMatch ? commandMatch[1] : parts[0];
            const targetMatch = parts[1] ? parts[1].match(/[A-Za-z]:\\.*$/) : null;
            const targetValue = targetMatch
                ? targetMatch[0]
                : (parts[1] ? parts[1].replace(/^Target:\s*/, '') : '');
            normalizedDetail = targetValue
                ? `Command: ${commandValue}\nTarget: ${targetValue}`
                : `Command: ${commandValue}`;
        }
    }

    process.stderr.write('\n[HAMES HARNESS] BLOCKED\n');
    process.stderr.write(`Reason: ${normalizedReason}\n`);
    if (normalizedDetail) process.stderr.write(`${normalizedDetail}\n`);
    process.stderr.write('Action: explicit CEO approval is required before proceeding.\n\n');
    // exit 2: Claude/Gemini/Codex 모두 BLOCK 의미
    process.exit(2);
}

// Hook mode entrypoint: inspect a single tool call payload.
function checkToolCall(toolCall) {
    const toolName = toolCall.tool_name || toolCall.name || '';
    const toolInput = toolCall.tool_input || toolCall.input || {};
    const filePath = toolInput.file_path;

    // [0] INBOX GUARD — 00_Inbox는 CEO input only, 에이전트 쓰기 금지
    const writeTools = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
    if (writeTools.includes(toolName) && filePath && isInboxPath(filePath)) {
        block(
            'INBOX WRITE BLOCKED — 00_Inbox is CEO input only.',
            `File: ${filePath}\n00_Inbox is reserved for CEO-dropped reference files.\nUse C:\\tmp\\ for scratch files.`
        );
    }

    // [1] Write 도구 → 기존 파일 덮어쓰기 차단
    if (toolName === 'Write') {
        if (filePath && fs.existsSync(filePath)) {
            block(
                'OVERWRITE BLOCKED — 기존 파일에 Write 도구 사용 금지.',
                `파일: ${filePath}\n→ Edit 도구로 수정할 부분만 선택해서 교체하세요.`
            );
        }
    }

    // [2] Bash 도구 → 위험 패턴 차단
    if (toolName === 'Edit' && filePath && fs.existsSync(filePath)) {
        const existingContent = fs.readFileSync(filePath, 'utf8');
        const oldString = toolInput.old_string;
        const replaceAll = toolInput.replace_all === true;

        if (typeof oldString !== 'string' || oldString.length === 0) {
            block(
                'SURGICAL EDIT REQUIRED ??old_string ?놁뒗 Edit ?섏젙 湲덉?.',
                `?뚯씪: ${filePath}\n???섏젙?좎? 遺遺꾨쭔 old_string ?쇰줈 紐낆떆?섏꽭??`
            );
        }

        if (replaceAll) {
            block(
                'GLOBAL REPLACE BLOCKED ??replace_all Edit ?덈? 湲덉?.',
                `?뚯씪: ${filePath}\n???섏젙?좎? 諛쒖톸?섏뿬 遺遺꾨쭔 援먯껜?섏꽭??`
            );
        }

        if (oldString === existingContent) {
            block(
                'WHOLE-FILE EDIT BLOCKED ????뙆?쇳븳 Edit 媛먯?.',
                `?뚯씪: ${filePath}\n???뚯씪 ?꾩껜瑜?old_string ?쇰줈 ?붿껌?섏? 留덉꽭??`
            );
        }

        const oldRatio = existingContent.length === 0 ? 0 : (oldString.length / existingContent.length);
        const oldLineCount = countLines(oldString);
        if (oldRatio >= LARGE_EDIT_RATIO || oldLineCount >= LARGE_EDIT_LINE_COUNT) {
            block(
                'LARGE EDIT BLOCKED ??遺遺꾨쭔 ?섏젙?섎뒗 洹쒖튃 ?꾩썐 媛?ν빀?덈떎.',
                `?뚯씪: ${filePath}\nold_string ratio: ${(oldRatio * 100).toFixed(1)}%\nold_string lines: ${oldLineCount}\n???꾨줈???섏젙 ?붿껌怨?蹂닿퀬瑜?遺꾨━?섏꽭??`
            );
        }

        saveSnapshot(filePath);
    }

    if (toolName === 'Bash') {
        const cmd = toolInput.command || '';

        // CEO 명시 승인 토큰 + git 자동 복구 가능 명령 카브아웃
        const hasCeoOverride = CEO_OVERRIDE_RE.test(cmd);
        const isGitRecoverable = GIT_RECOVERABLE_RE.test(cmd);
        const bypassDangerous = hasCeoOverride || isGitRecoverable;

        const inboxWriteTarget = findInboxWriteTarget(cmd);
        if (inboxWriteTarget && !bypassDangerous) {
            block(
                'INBOX WRITE BLOCKED — Bash redirect targets 00_Inbox.',
                `Command: ${cmd.substring(0, 120)}\nTarget: ${inboxWriteTarget}\n00_Inbox is CEO input only. Use C:\\tmp\\ for scratch.`
            );
        }
        const overwriteTarget = findOverwriteRedirectionTarget(cmd);
        const powerShellOverwriteTarget = findPowerShellOverwriteTarget(cmd);

        const dangerousPatterns = [
            { pattern: /\brm\s+(-\w*r\w*|-\w*f\w*){1,2}/i, label: 'rm -rf 패턴 감지 (DELETE_FILE)' },
            { pattern: /\brm\s+[^-]/i,                        label: 'rm 단일 파일 삭제 감지 (DELETE_FILE)' },
            { pattern: /\brmdir\b/i,                          label: 'rmdir 감지 (DELETE_FILE)' },
            { pattern: /\bdel\s+\/(f|s|q)/i,                 label: 'Windows del 강제 삭제 감지 (DELETE_FILE)' },
            { pattern: /\bdel\s+(?!\/)/i,                     label: 'Windows del 단일 파일 감지 (DELETE_FILE)' },
            { pattern: /\bmv\s+/i,                             label: 'mv 파일 이동 감지 (MOVE_FILE)' },
            { pattern: /\bmove\s+/i,                           label: 'Windows move 감지 (MOVE_FILE)' },
            { pattern: /\bformat\s+[a-z]:/i,                  label: 'format 명령 감지' },
        ];

        if (overwriteTarget && !bypassDangerous) {
            block(
                'DANGEROUS BASH — existing-file overwrite redirection detected',
                `명령: ${cmd.substring(0, 120)}\n대상: ${overwriteTarget.rawTarget}`
            );
        }

        if (powerShellOverwriteTarget && !bypassDangerous) {
            block(
                'DANGEROUS BASH — existing-file PowerShell overwrite detected',
                `command: ${cmd.substring(0, 120)}
target: ${powerShellOverwriteTarget.rawTarget}`
            );
        }

        let matchedDangerous = null;
        for (const { pattern, label } of dangerousPatterns) {
            if (pattern.test(cmd)) {
                matchedDangerous = label;
                break;
            }
        }

        if (matchedDangerous && !bypassDangerous) {
            block(`DANGEROUS BASH — ${matchedDangerous}`, `command: ${cmd.substring(0, 120)}`);
        }

        // bypass audit log (passes through but tracked)
        if (bypassDangerous && (matchedDangerous || overwriteTarget || powerShellOverwriteTarget || inboxWriteTarget)) {
            logAuditBypass({
                command: cmd.substring(0, 200),
                matched_pattern: matchedDangerous,
                overwrite_target: overwriteTarget ? overwriteTarget.rawTarget : null,
                inbox_target: inboxWriteTarget,
                bypass_reason: hasCeoOverride ? 'CEO:OK_token' : 'git_recoverable',
            });
        }
    }

    // 통과
    process.exit(0);
}

// ─── Manual 모드: 파일 감사 ──────────────────────────────────────────────────

// Manual mode: audit a file or directory directly from the CLI.
function auditFile(filePath) {
    if (!fs.existsSync(filePath)) return { error: 'File not found' };

    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);

    const normalizedPath = filePath.replace(/\\/g, '/');
    const isWilliam = normalizedPath.includes('04_William');
    const isHobby   = normalizedPath.includes('03_Hobby');

    const naming     = isWilliam || /^\d{4}-\d{2}-\d{2}_.+\.md$/.test(fileName);
    const frontmatter = isHobby  || content.trim().startsWith('---');
    const footer      = isHobby  || content.includes('## 관련노트');
    const hasKorean = isWilliam || /[가-힣]/.test(content);

    const forbiddenTones = [
        /해요[!.?]?/g, /하세요/g, /네요[!.?]?/g, /같아요/g, /중이에요/g,
        /!!!/g, /답변 드립니다/,
    ];
    const toneViolations = forbiddenTones.filter(r => r.test(content));
    const casualTilde = /(?<!\d)~(?!\d)/.test(content);
    if (casualTilde) toneViolations.push('Casual Tilde');
    const isProfessional = toneViolations.length === 0;

    return {
        fileName,
        naming:      naming        ? 'PASS' : 'FAIL (Use {YYYY}-{MM}-{DD}_Keyword.md)',
        frontmatter: frontmatter   ? 'PASS' : 'FAIL (YAML Frontmatter missing)',
        footer:      footer        ? 'PASS' : 'WARN (## 관련노트 missing)',
        tone:        isProfessional? 'PASS' : `FAIL (${toneViolations.length} violations)`,
        language:    hasKorean     ? 'PASS' : 'FAIL (Must be Korean)',
        overall:     (naming && frontmatter && hasKorean && isProfessional) ? 'VALID' : 'INVALID',
    };
}

// ─── 진입점 ──────────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (arg) {
    // Manual 모드
    if (fs.statSync(arg).isFile()) {
        const report = auditFile(arg);
        console.log(JSON.stringify(report, null, 2));
        if (report.overall === 'INVALID') process.exit(1);
    } else {
        const files = fs.readdirSync(arg).filter(f => f.endsWith('.md'));
        const results = files.map(f => auditFile(path.join(arg, f)));
        console.table(results);
        if (results.some(r => r.overall === 'INVALID')) process.exit(1);
    }
} else {
    // Hook 모드: stdin에서 JSON 수신
    let raw = '';
    process.stdin.on('data', chunk => { raw += chunk; });
    process.stdin.on('end', () => {
        if (!raw.trim()) process.exit(0); // 데이터 없으면 통과
        try {
            const toolCall = JSON.parse(raw);
            checkToolCall(toolCall);
        } catch {
            process.exit(0); // 파싱 실패 시 차단하지 않음 (안전 방향)
        }
    });
}
