#!/usr/bin/env node
// PreToolUse 차단 훅 — workspaces/ 워크스페이스의 새 .md 파일 작성 시
// frontmatter 필수 필드(Related/Topic/Type/tags) 누락을 즉시 차단.
//
// 설계 원칙:
//   1. 단발성 — stdin JSON 1회 읽고 즉시 종료. 자체 retry 없음.
//   2. 명확한 차단 메시지 — stderr 한 블록에 파일/누락필드/수정방법.
//   3. tight scope — Write tool, .md 확장자, anti_workspace_prefixes 매칭만 검사.
//      그 외 모든 도구/파일은 통과.
//   4. 예외는 audit_exclusions.json 에서 단일 출처로 로드.
//   5. frontmatter 검사만 차단. footer 누락은 stderr 경고 후 통과 (정책: 경고).
//
// 진입 패스:
//   - tool_name != "Write" → 통과
//   - file_path 가 anti_workspace_prefixes 미일치 → 통과
//   - file_path 가 exempt_workspace_prefixes (03_Hobby) 매칭 → 통과
//   - filename 이 meta_skip_filenames 또는 _ 시작 → 통과
//   - 경로에 common_skip_dirs 또는 content_skip_dirs 포함 → 통과
//   - .md 가 아니면 통과
//
// Exit codes (Claude Code hook 규약):
//   0 — 통과
//   2 — 차단 (stderr 가 모델에 노출됨)

'use strict';

const fs = require('fs');
const path = require('path');

const ARSENAL_DIR = path.dirname(path.resolve(__filename));
const EXCLUSIONS_PATH = path.join(ARSENAL_DIR, 'audit_exclusions.json');

function loadExclusions() {
    try {
        return JSON.parse(fs.readFileSync(EXCLUSIONS_PATH, 'utf-8'));
    } catch (_) {
        return {};
    }
}

function readStdinSync() {
    try {
        return fs.readFileSync(0, 'utf-8');
    } catch (_) {
        return '';
    }
}

function pass() { process.exit(0); }
function block(msg) {
    process.stderr.write(msg + '\n');
    process.exit(2);
}
function warn(msg) {
    process.stderr.write(msg + '\n');
}

function normalize(p) {
    return p.replace(/\\/g, '/');
}

function pathContainsSegment(filePath, segment) {
    return normalize(filePath).split('/').includes(segment);
}

function matchesAnyPrefix(filePathRel, prefixes) {
    const norm = normalize(filePathRel);
    return prefixes.some(p => norm === p || norm.startsWith(p + '/'));
}

function getRelToProjectRoot(filePath) {
    const projectRoot = process.env.CLAUDE_PROJECT_DIR
        || process.env.HAMES_PROJECT_DIR
        || process.cwd();
    const abs = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(projectRoot, filePath);
    return normalize(path.relative(projectRoot, abs));
}

function parseFrontmatterFields(content) {
    if (!content || !content.trim().startsWith('---')) {
        return { hasFrontmatter: false, fields: new Set() };
    }
    const lines = content.split(/\r?\n/);
    if (lines[0].trim() !== '---') {
        return { hasFrontmatter: false, fields: new Set() };
    }
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') { endIdx = i; break; }
    }
    if (endIdx === -1) {
        return { hasFrontmatter: false, fields: new Set() };
    }
    const fields = new Set();
    for (let i = 1; i < endIdx; i++) {
        const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
        if (m) fields.add(m[1]);
    }
    return { hasFrontmatter: true, fields };
}

function main() {
    const raw = readStdinSync();
    if (!raw.trim()) pass();

    let evt;
    try { evt = JSON.parse(raw); } catch (_) { pass(); }

    const toolName = evt.tool_name || evt.toolName || '';
    if (toolName !== 'Write') pass();

    const input = evt.tool_input || evt.toolInput || {};
    const filePath = input.file_path || input.filePath || '';
    const content  = input.content || '';

    if (!filePath || !filePath.toLowerCase().endsWith('.md')) pass();

    const excl = loadExclusions();
    const fmCfg = excl.frontmatter_blocking || {};
    const antiPrefixes   = fmCfg.anti_workspace_prefixes
        || ['workspaces/Investment', 'workspaces/Business', 'workspaces/Company'];
    const exemptPrefixes = fmCfg.exempt_workspace_prefixes
        || ['workspaces/Hobby'];
    const required       = fmCfg.required_fields
        || ['Related', 'Topic', 'Type', 'tags'];

    const metaSkip       = new Set(excl.meta_skip_filenames || []);
    const commonSkipDirs = new Set(excl.common_skip_dirs || []);
    const contentSkipDirs= new Set(excl.content_skip_dirs || []);

    const relToRoot = getRelToProjectRoot(filePath);
    const filename  = path.basename(relToRoot);

    if (matchesAnyPrefix(relToRoot, exemptPrefixes)) pass();
    if (!matchesAnyPrefix(relToRoot, antiPrefixes))  pass();

    if (metaSkip.has(filename)) pass();
    if (filename.startsWith('_')) pass();
    if (filename.endsWith('_MOC.md')) pass();

    const segments = normalize(relToRoot).split('/');
    for (const seg of segments) {
        if (commonSkipDirs.has(seg)) pass();
        if (contentSkipDirs.has(seg)) pass();
    }

    // ── 검사 ────────────────────────────────────────────────────────────
    const { hasFrontmatter, fields } = parseFrontmatterFields(content);

    if (!hasFrontmatter) {
        block(
            `BLOCKED: ${relToRoot}\n` +
            `  reason: YAML frontmatter missing\n` +
            `  required: ${required.join(', ')}\n` +
            `  fix: prepend a frontmatter block, e.g.\n` +
            `    ---\n` +
            `    Related: <workspaces/Business 등>\n` +
            `    Topic: <도메인>\n` +
            `    Type: <Note/Report/...>\n` +
            `    tags: [<tag1>, <tag2>]\n` +
            `    ---\n` +
            `  source: verify_frontmatter_block.js`
        );
    }

    const missing = required.filter(f => !fields.has(f));
    if (missing.length) {
        block(
            `BLOCKED: ${relToRoot}\n` +
            `  reason: frontmatter missing required field(s)\n` +
            `  missing: ${missing.join(', ')}\n` +
            `  required: ${required.join(', ')}\n` +
            `  fix: add the missing field(s) to the YAML frontmatter\n` +
            `  source: verify_frontmatter_block.js`
        );
    }

    // footer 는 경고만. 차단하지 않는다.
    const footerMarkers = ['## 관련노트', '## 관련문서', '## Related', '## Links'];
    const hasFooter = footerMarkers.some(m => content.includes(m));
    if (!hasFooter) {
        warn(
            `WARN: ${relToRoot}\n` +
            `  reason: footer marker missing\n` +
            `  expected: '## 관련노트' (or 관련문서/Related/Links)\n` +
            `  policy: warn-only (CEO 정책)\n` +
            `  source: verify_frontmatter_block.js`
        );
    }

    pass();
}

main();
