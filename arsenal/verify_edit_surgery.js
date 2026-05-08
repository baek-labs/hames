const fs = require('fs');
const os = require('os');
const path = require('path');

const SNAPSHOT_DIR = path.join(os.tmpdir(), 'hames-edit-snapshots');
const MAX_CHANGED_RATIO = 0.35;
const MAX_CHANGED_LINES = 80;

function getSnapshotPath(filePath) {
    const key = Buffer.from(path.resolve(filePath), 'utf8').toString('base64url');
    return path.join(SNAPSHOT_DIR, `${key}.json`);
}

function splitLines(text) {
    return text.replace(/^\uFEFF/, '').split(/\r?\n/);
}

function loadSnapshot(filePath) {
    const snapshotPath = getSnapshotPath(filePath);
    if (!fs.existsSync(snapshotPath)) return null;
    try {
        return {
            snapshotPath,
            payload: JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
        };
    } catch {
        return { snapshotPath, payload: null };
    }
}

function cleanupSnapshot(snapshotPath) {
    if (!snapshotPath || !fs.existsSync(snapshotPath)) return;
    fs.unlinkSync(snapshotPath);
}

function diffStats(beforeContent, afterContent) {
    const beforeLines = splitLines(beforeContent);
    const afterLines = splitLines(afterContent);

    let prefix = 0;
    while (
        prefix < beforeLines.length &&
        prefix < afterLines.length &&
        beforeLines[prefix] === afterLines[prefix]
    ) {
        prefix += 1;
    }

    let suffix = 0;
    while (
        suffix < beforeLines.length - prefix &&
        suffix < afterLines.length - prefix &&
        beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
    ) {
        suffix += 1;
    }

    const changedBeforeLines = Math.max(0, beforeLines.length - prefix - suffix);
    const changedAfterLines = Math.max(0, afterLines.length - prefix - suffix);
    const maxChangedLines = Math.max(changedBeforeLines, changedAfterLines);
    const baselineLines = Math.max(beforeLines.length, afterLines.length, 1);
    const changedRatio = maxChangedLines / baselineLines;

    return {
        beforeLines: beforeLines.length,
        afterLines: afterLines.length,
        prefix,
        suffix,
        changedBeforeLines,
        changedAfterLines,
        maxChangedLines,
        changedRatio
    };
}

function legacyBlock(filePath, stats) {
    process.stderr.write('\n[HAMES HARNESS] BLOCKED\n');
    process.stderr.write('사유: 기존 파일은 부분 수정만 허용됩니다. 통째 재작성에 가까운 변경이 감지되었습니다.\n');
    process.stderr.write(`파일: ${filePath}\n`);
    process.stderr.write(`변경 라인 비율: ${(stats.changedRatio * 100).toFixed(1)}%\n`);
    process.stderr.write(`변경 전용 라인: ${stats.changedBeforeLines}, 변경 후용 라인: ${stats.changedAfterLines}\n`);
    process.stderr.write('다음 행동: 직접 계속 덮어쓰지 말고, 사용자에게 어느 블록을 어떻게 수정할지 확인 요청하세요.\n\n');
    process.exit(1);
}

function legacyReadableBlock(filePath, stats) {
    process.stderr.write('\n[HAMES HARNESS] BLOCKED\n');
    process.stderr.write('사유: 기존 파일은 부분 수정만 허용됩니다. 통째 재작성에 가까운 변경이 감지되었습니다.\n');
    process.stderr.write(`파일: ${filePath}\n`);
    process.stderr.write(`변경 라인 비율: ${(stats.changedRatio * 100).toFixed(1)}%\n`);
    process.stderr.write(`변경 전용 라인: ${stats.changedBeforeLines}, 변경 후용 라인: ${stats.changedAfterLines}\n`);
    process.stderr.write('다음 행동: 직접 계속 덮어쓰지 말고, 사용자에게 어느 블록을 어떻게 수정할지 확인 요청하세요.\n\n');
    process.exit(1);
}

// Final active formatter used by the post-edit guard.
function emitStableBlock(filePath, stats) {
    process.stderr.write('\n[HAMES HARNESS] BLOCKED\n');
    process.stderr.write('Reason: existing files must be edited surgically; near-total rewrites are blocked.\n');
    process.stderr.write(`File: ${filePath}\n`);
    process.stderr.write(`Changed ratio: ${(stats.changedRatio * 100).toFixed(1)}%\n`);
    process.stderr.write(`Changed-before lines: ${stats.changedBeforeLines}, Changed-after lines: ${stats.changedAfterLines}\n`);
    process.stderr.write('Action: stop editing directly and ask the user which block should be changed.\n\n');
    process.exit(1);
}

function verifyToolCall(toolCall) {
    const toolName = toolCall.tool_name || toolCall.name || '';
    const toolInput = toolCall.tool_input || toolCall.input || {};
    const filePath = toolInput.file_path;

    if (toolName !== 'Edit' || !filePath) {
        process.exit(0);
    }

    const resolvedPath = path.resolve(filePath);
    const snapshot = loadSnapshot(resolvedPath);
    if (!snapshot) {
        process.exit(0);
    }

    try {
        if (!snapshot.payload || !fs.existsSync(resolvedPath)) {
            process.exit(0);
        }

        const afterContent = fs.readFileSync(resolvedPath, 'utf8');
        const stats = diffStats(snapshot.payload.content || '', afterContent);
        if (stats.changedRatio > MAX_CHANGED_RATIO && stats.maxChangedLines > MAX_CHANGED_LINES) {
            emitStableBlock(resolvedPath, stats);
        }

        process.exit(0);
    } finally {
        cleanupSnapshot(snapshot.snapshotPath);
    }
}

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
    if (!raw.trim()) process.exit(0);
    try {
        verifyToolCall(JSON.parse(raw));
    } catch {
        process.exit(0);
    }
});
