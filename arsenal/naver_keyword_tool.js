// node naver_keyword_tool.js "<seed1>" "<seed2>" ...
// Naver Search Ad API: /keywordstool. Output: <workspace>/SEO/keywords.json
'use strict';
process.stdout.setEncoding('utf8');

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const API_KEY = process.env.NAVER_AD_API_KEY;
const SECRET = process.env.NAVER_AD_SECRET_KEY;
const CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID;

if (!API_KEY || !SECRET || !CUSTOMER_ID) {
  console.error('[keyword] missing NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID in .env');
  process.exit(1);
}

const OUT_DIR = path.resolve(__dirname, '..', '01_Business', '01_Tech_Venture', 'Project_A', 'SEO');
const OUT_FILE = path.join(OUT_DIR, 'keywords.json');
const SEED_FILE = path.join(OUT_DIR, 'seed_keywords.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sign(timestamp, method, uri) {
  const msg = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', SECRET).update(msg).digest('base64');
}

function callKeywordTool(seedKeywords) {
  return new Promise((resolve, reject) => {
    const method = 'GET';
    const uri = '/keywordstool';
    const params = new URLSearchParams();
    // Naver Search Ad API: hintKeywords must be comma-separated AND each keyword stripped of spaces.
    const cleaned = seedKeywords.map((k) => String(k).replace(/\s+/g, ''));
    params.set('hintKeywords', cleaned.join(','));
    params.set('showDetail', '1');
    const fullPath = `${uri}?${params.toString()}`;
    const ts = Date.now().toString();
    const sig = sign(ts, method, uri);

    const opts = {
      hostname: 'api.searchad.naver.com',
      path: fullPath,
      method,
      headers: {
        'X-Timestamp': ts,
        'X-API-KEY': API_KEY,
        'X-Customer': String(CUSTOMER_ID),
        'X-Signature': sig,
        'Accept': 'application/json'
      }
    };

    const req = https.request(opts, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`parse error: ${e.message}`)); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function withRetry(fn) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await sleep(1500 * (i + 1)); }
  }
  throw lastErr;
}

function normalizeRow(row) {
  const num = (v) => {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'number') return v;
    const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  };
  return {
    keyword: row.relKeyword || row.keyword || '',
    monthlyPcQcCnt: num(row.monthlyPcQcCnt),
    monthlyMobileQcCnt: num(row.monthlyMobileQcCnt),
    compIdx: row.compIdx || '',
    plAvgDepth: num(row.plAvgDepth),
    avgPcCpc: num(row.monthlyAvePcCtr || row.avgPcCpc),
    avgMobileCpc: num(row.monthlyAveMobileCtr || row.avgMobileCpc)
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let seeds = process.argv.slice(2);
  if (seeds.length === 0 && fs.existsSync(SEED_FILE)) {
    try { seeds = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); }
    catch (_) { seeds = []; }
  }
  if (!Array.isArray(seeds) || seeds.length === 0) {
    console.error('[keyword] no seed keywords. usage: node naver_keyword_tool.js "kw1" "kw2"');
    process.exit(1);
  }

  // API allows up to 5 hint keywords per call. Chunk it.
  const CHUNK = 5;
  const all = new Map();
  for (let i = 0; i < seeds.length; i += CHUNK) {
    const slice = seeds.slice(i, i + CHUNK);
    console.log(`[keyword] querying chunk ${i / CHUNK + 1}: ${slice.join(', ')}`);
    const data = await withRetry(() => callKeywordTool(slice));
    const list = data.keywordList || data.keywordlist || [];
    for (const row of list) {
      const norm = normalizeRow(row);
      if (norm.keyword) all.set(norm.keyword, norm);
    }
    await sleep(1000);
  }

  const out = Array.from(all.values()).sort(
    (a, b) => (b.monthlyPcQcCnt + b.monthlyMobileQcCnt) - (a.monthlyPcQcCnt + a.monthlyMobileQcCnt)
  );
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  console.log(`[keyword] wrote ${out.length} keywords -> ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(`[keyword] fatal: ${e.message}`);
  process.exit(1);
});
