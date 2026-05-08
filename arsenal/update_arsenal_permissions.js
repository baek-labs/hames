/**
 * update_arsenal_permissions.js
 * Arsenal 스크립트 변경 시 settings.local.json 허용 목록 자동 갱신
 *
 * Hook 모드 (인수 없음): stdin에서 PostToolUse tool call JSON 읽음
 *   → .Arsenal/ 내 .js/.py 파일 Write 시에만 실행
 * Manual 모드: node update_arsenal_permissions.js --force
 */

const fs = require('fs');
const path = require('path');

const ARSENAL_DIR   = __dirname;
const HAMES_ROOT    = path.resolve(ARSENAL_DIR, '..', '..');
const SETTINGS_LOCAL = path.join(HAMES_ROOT, '.claude', 'settings.local.json');

function scanArsenalScripts() {
    const entries = fs.readdirSync(ARSENAL_DIR);
    const scripts = { js: [], py: [] };
    for (const entry of entries) {
        const stat = fs.statSync(path.join(ARSENAL_DIR, entry));
        if (stat.isDirectory()) continue;
        if (entry.endsWith('.js')) scripts.js.push(entry);
        if (entry.endsWith('.py')) scripts.py.push(entry);
    }
    return scripts;
}

function buildPatterns(scripts) {
    const patterns = [];
    for (const f of scripts.js) {
        patterns.push(`Bash(node *${f}*)`);
    }
    for (const f of scripts.py) {
        patterns.push(`Bash(python *${f}*)`);
        patterns.push(`Bash(python3 *${f}*)`);
        patterns.push(`Bash(py *${f}*)`);
    }
    return patterns;
}

function isArsenalPattern(entry) {
    return /^Bash\((node|python3?|py) \*[^)]+\.(js|py)\*\)$/.test(entry);
}

function updatePermissions() {
    if (!fs.existsSync(SETTINGS_LOCAL)) {
        console.error(`[ERROR] 파일 없음: ${SETTINGS_LOCAL}`);
        process.exit(1);
    }

    const settings = JSON.parse(fs.readFileSync(SETTINGS_LOCAL, 'utf8'));
    const currentAllow = settings.permissions?.allow || [];

    const scripts = scanArsenalScripts();
    const allNames = [...scripts.js, ...scripts.py];
    const newPatterns = buildPatterns(scripts);

    // 기존 Arsenal 패턴 제거 후 신규 삽입
    const filtered = currentAllow.filter(e => !isArsenalPattern(e));
    const merged = [...filtered, ...newPatterns.filter(p => !filtered.includes(p))];

    settings.permissions.allow = merged;
    fs.writeFileSync(SETTINGS_LOCAL, JSON.stringify(settings, null, 2), 'utf8');

    console.log(`[ARSENAL PERMISSIONS] 갱신 완료 — ${newPatterns.length}개 패턴`);
    newPatterns.forEach(p => console.log(`  + ${p}`));
}

// --- 진입점 ---

if (process.argv[2] === '--force') {
    updatePermissions();
    process.exit(0);
}

// Hook 모드
let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
    if (!raw.trim()) { process.exit(0); }
    try {
        const toolCall = JSON.parse(raw);
        const toolInput = toolCall.tool_input || toolCall.input || {};
        const filePath = (toolInput.file_path || '').replace(/\\/g, '/');
        if (!filePath.includes('.Arsenal/')) { process.exit(0); }
        if (!filePath.endsWith('.js') && !filePath.endsWith('.py')) { process.exit(0); }
        updatePermissions();
        process.exit(0);
    } catch {
        process.exit(0);
    }
});
