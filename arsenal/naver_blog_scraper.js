// node naver_blog_scraper.js [blogId] [--limit N] [--category NO]
// v2: Scrapes ALL public Naver Blog posts via PostTitleListAsync pagination + mobile enrichment.
// Output: <workspace>/SEO/posts.json
'use strict';
process.stdout.setEncoding('utf8');

const fs = require('fs');
const path = require('path');
const https = require('https');
const cheerio = require('cheerio');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// ---------- arg parsing ----------
const argv = process.argv.slice(2);
let BLOG_ID = '';
let LIMIT = Infinity;
let CATEGORY_NO = 0;
let OUT_PATH_ARG = '';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--limit') { LIMIT = parseInt(argv[++i], 10) || Infinity; }
  else if (a === '--category') { CATEGORY_NO = parseInt(argv[++i], 10) || 0; }
  else if (a === '--output') { OUT_PATH_ARG = argv[++i] || ''; }
  else if (!a.startsWith('--')) { BLOG_ID = a; }
}

if (!BLOG_ID) {
  console.error('Usage: node naver_blog_scraper.js <blog_id> [--limit N] [--category N] [--output path]');
  process.exit(1);
}

const OUT_FILE = OUT_PATH_ARG
  ? path.resolve(OUT_PATH_ARG)
  : path.resolve(process.cwd(), `naver_posts_${BLOG_ID}.json`);
const OUT_DIR = path.dirname(OUT_FILE);
const COUNT_PER_PAGE = 30;
const PAGE_DELAY_MS = 1500;
const DETAIL_DELAY_MS = 1000;

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(urlStr, attempt = 0, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: Object.assign({
        'User-Agent': UAS[attempt % UAS.length],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
      }, extraHeaders)
    };
    const req = https.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGet(new URL(res.headers.location, urlStr).toString(), attempt, extraHeaders));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`HTTP ${res.statusCode} for ${urlStr}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function fetchWithRetry(url, extraHeaders) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await httpGet(url, i, extraHeaders);
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ---------- tag extraction ----------

function normalizeTags(arr) {
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    if (raw == null) continue;
    let t = String(raw).trim();
    if (!t) continue;
    // strip leading # (possibly repeated) and surrounding whitespace
    t = t.replace(/^#+/, '').trim();
    if (!t) continue;
    if (t.length > 80) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function decodeUnicodeEscapes(s) {
  if (!s) return '';
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Multi-strategy tag extractor. Tries (in order):
//   1) inline JS var: gsTagName = "a,b,c"   (Naver mobile post page — most reliable)
//   2) escaped JSON: \"tagNames\":\"a,b,c\"  (within page bootstrap data)
//   3) og:tag meta tags (multiple)
//   4) DOM selectors: .post_tag a, .tag_area a, .blog2_tagList .tag, .wrap_tag a
//   5) any anchor whose text starts with '#' (last-resort, original behavior)
function extractTags(html, $) {
  // 1) gsTagName
  const m1 = html.match(/var\s+gsTagName\s*=\s*"([^"]*)"/);
  if (m1 && m1[1].trim()) {
    const decoded = decodeUnicodeEscapes(m1[1]);
    const list = decoded.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return normalizeTags(list);
  }

  // 2) escaped tagNames inside bootstrap JSON
  const m2 = html.match(/\\"tagNames\\":\\"([^"\\]*)\\"/);
  if (m2 && m2[1].trim()) {
    const decoded = decodeUnicodeEscapes(m2[1]);
    const list = decoded.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return normalizeTags(list);
  }

  // 3) og:tag meta
  const og = [];
  $('meta[property="og:tag"]').each((_, el) => {
    const c = $(el).attr('content');
    if (c) og.push(c);
  });
  if (og.length) return normalizeTags(og);

  // 4) DOM selectors (PC + mobile variants)
  const domTags = [];
  $('.post_tag a, .tag_area a, .blog2_tagList .tag, .wrap_tag a, ._tagList a, .tag_block a').each((_, a) => {
    const t = ($(a).text() || '').trim();
    if (t) domTags.push(t);
  });
  if (domTags.length) return normalizeTags(domTags);

  // 5) last-resort: any anchor text that looks like a hashtag
  const hashTags = [];
  $('a').each((_, a) => {
    const t = ($(a).text() || '').trim();
    if (t.startsWith('#') && t.length > 1 && t.length < 40) hashTags.push(t);
  });
  return normalizeTags(hashTags);
}

// ---------- listing strategies ----------

// Strategy A (primary): mobile blog post-list API. Pure JSON, accurate epoch addDate.
async function fetchMobilePostListPage(page) {
  const url = `https://m.blog.naver.com/api/blogs/${encodeURIComponent(BLOG_ID)}/post-list?categoryNo=${CATEGORY_NO}&itemCount=${COUNT_PER_PAGE}&page=${page}`;
  const body = await fetchWithRetry(url, {
    'Accept': 'application/json',
    'Referer': `https://m.blog.naver.com/${BLOG_ID}`
  });
  const json = JSON.parse(body);
  if (!json || json.isSuccess === false) {
    throw new Error(`mobile API not successful at page ${page}`);
  }
  const result = json.result || {};
  const items = Array.isArray(result.items) ? result.items : [];
  return { items, raw: json };
}

function normalizeMobileItem(raw) {
  const logNo = String(raw.logNo || '').trim();
  let publishedAt = '';
  if (raw.addDate != null) {
    const ad = Number(raw.addDate);
    if (!Number.isNaN(ad) && ad > 0) publishedAt = new Date(ad).toISOString();
  }
  const title = decodeEntities(String(raw.titleWithInspectMessage || raw.title || '').trim());
  return {
    postId: logNo,
    title,
    url: `https://blog.naver.com/${BLOG_ID}/${logNo}`,
    publishedAt,
    category: decodeEntities(String(raw.categoryName || '').trim()),
    categoryNo: raw.categoryNo != null ? Number(raw.categoryNo) : null,
    tags: [],
    contentText: decodeEntities(String(raw.briefContents || '').trim()),
    contentLength: 0,
    internalLinks: []
  };
}

// Strategy B (fallback): PostTitleListAsync (returns JSON-ish — sometimes wrapped, sometimes pure)
async function fetchPostListPage(page) {
  const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(BLOG_ID)}&currentPage=${page}&countPerPage=${COUNT_PER_PAGE}&categoryNo=${CATEGORY_NO}&parentCategoryNo=&viewdate=&userTopListCurrentPage=1&userTopListCount=5&userTopListCoverFlag=N`;
  const body = await fetchWithRetry(url, { 'Referer': `https://blog.naver.com/${BLOG_ID}` });
  // Body may be wrapped like " ( {...} )" or pure JSON; Naver also emits invalid escapes like \'
  let trimmed = body.trim().replace(/^\(/, '').replace(/\)$/, '').trim();
  // Sanitize: replace invalid backslash-escapes that JSON.parse rejects.
  // Valid JSON escapes: \" \\ \/ \b \f \n \r \t \uXXXX. Anything else (e.g. \') is invalid.
  trimmed = trimmed.replace(/\\(?!["\\/bfnrtu])/g, '');
  let json;
  try {
    json = JSON.parse(trimmed);
  } catch (e) {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`PostTitleListAsync parse fail (page ${page}): ${e.message}`);
    json = JSON.parse(m[0]);
  }
  return json;
}

function normalizeListItem(raw) {
  // PostTitleListAsync fields: logNo, title, addDate (epoch ms or yyyyMMddHHmmss), categoryName, categoryNo
  const logNo = String(raw.logNo || raw.LogNo || raw.logno || '').trim();
  let titleRaw = String(raw.title || raw.Title || '').trim();
  // Naver returns URL-encoded title in PostTitleListAsync
  try { titleRaw = decodeURIComponent(titleRaw.replace(/\+/g, ' ')); } catch (_) { /* keep raw */ }
  const title = decodeEntities(titleRaw);
  let publishedAt = '';
  if (raw.addDate) {
    const ad = String(raw.addDate);
    if (/^\d{13}$/.test(ad)) publishedAt = new Date(parseInt(ad, 10)).toISOString();
    else if (/^\d{10}$/.test(ad)) publishedAt = new Date(parseInt(ad, 10) * 1000).toISOString();
    else if (/^\d{14}$/.test(ad)) {
      // yyyyMMddHHmmss
      publishedAt = `${ad.slice(0,4)}-${ad.slice(4,6)}-${ad.slice(6,8)}T${ad.slice(8,10)}:${ad.slice(10,12)}:${ad.slice(12,14)}+09:00`;
    } else {
      publishedAt = ad;
    }
  }
  return {
    postId: logNo,
    title,
    url: `https://blog.naver.com/${BLOG_ID}/${logNo}`,
    publishedAt,
    category: decodeEntities(String(raw.categoryName || '').trim()),
    categoryNo: raw.categoryNo != null ? Number(raw.categoryNo) : null,
    tags: [],
    contentText: '',
    contentLength: 0,
    internalLinks: []
  };
}

async function collectAllPosts() {
  const seen = new Set();
  const out = [];
  let page = 1;
  let strategy = 'mobile';

  // Try mobile API first; if page 1 yields nothing, fall back to PostTitleListAsync.
  while (out.length < LIMIT) {
    process.stderr.write(`[scraper] list page ${page} via=${strategy} (collected=${out.length})\n`);
    let list;
    try {
      if (strategy === 'mobile') {
        const { items } = await fetchMobilePostListPage(page);
        list = items.map(normalizeMobileItem);
      } else {
        const json = await fetchPostListPage(page);
        const raw = Array.isArray(json.postList) ? json.postList : (Array.isArray(json.postlist) ? json.postlist : []);
        list = raw.map(normalizeListItem);
      }
    } catch (e) {
      process.stderr.write(`[scraper] list page ${page} (${strategy}) failed: ${e.message}\n`);
      if (strategy === 'mobile' && page === 1) {
        process.stderr.write(`[scraper] falling back to PostTitleListAsync\n`);
        strategy = 'pc';
        continue;
      }
      break;
    }

    if (!list.length) {
      if (strategy === 'mobile' && page === 1 && out.length === 0) {
        process.stderr.write(`[scraper] mobile API empty, falling back to PostTitleListAsync\n`);
        strategy = 'pc';
        continue;
      }
      break;
    }

    let added = 0;
    for (const item of list) {
      if (!item.postId || seen.has(item.postId)) continue;
      seen.add(item.postId);
      out.push(item);
      added++;
      if (out.length >= LIMIT) break;
    }
    if (added === 0) break;
    page++;
    await sleep(PAGE_DELAY_MS);
  }
  return { posts: out, totalCount: out.length, strategy };
}

// ---------- enrichment (mobile detail) ----------

async function enrichFromMobile(item) {
  if (!item.postId) return item;
  const url = `https://m.blog.naver.com/${BLOG_ID}/${item.postId}`;
  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);
    const main = $('.se-main-container').first();
    if (main.length) {
      const text = stripHtml(main.html() || '');
      if (text.length > item.contentLength) {
        item.contentText = text;
        item.contentLength = text.length;
      }
      const links = [];
      main.find('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (href.includes(`blog.naver.com/${BLOG_ID}`) || href.includes(`m.blog.naver.com/${BLOG_ID}`)) {
          links.push(href);
        }
      });
      item.internalLinks = Array.from(new Set(links));
    } else {
      // fallback: try post_ctt or whole body text
      const fallback = $('#postViewArea, .post_ct, #viewTypeSelector').first();
      if (fallback.length) {
        const text = stripHtml(fallback.html() || '');
        if (text.length > item.contentLength) {
          item.contentText = text;
          item.contentLength = text.length;
        }
      }
    }
    const tags = extractTags(html, $);
    if (tags.length) {
      item.tags = tags;
    } else {
      process.stderr.write(`[warn] no tags found for ${item.postId} (checked: gsTagName / tagNames / og:tag / DOM)\n`);
    }
    if (!item.category) {
      const cat = $('.blog_category, .category, .se_publishInfo .category').first().text().trim();
      if (cat) item.category = cat;
    }
  } catch (e) {
    process.stderr.write(`[warn] enrich failed for ${item.postId}: ${e.message}\n`);
  }
  return item;
}

// ---------- main ----------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  process.stderr.write(`[scraper] v2 start blogId=${BLOG_ID} categoryNo=${CATEGORY_NO} limit=${LIMIT === Infinity ? 'all' : LIMIT}\n`);

  const { posts, strategy } = await collectAllPosts();
  // initialize contentLength from briefContents (will be overwritten by enrichment if larger)
  for (const p of posts) p.contentLength = p.contentText ? p.contentText.length : 0;
  process.stderr.write(`[scraper] list complete: ${posts.length} posts (strategy=${strategy})\n`);

  if (posts.length === 0) {
    throw new Error('no posts collected; aborting');
  }

  for (let i = 0; i < posts.length; i++) {
    process.stderr.write(`[scraper] enrich ${i + 1}/${posts.length} (${posts[i].postId})\n`);
    await enrichFromMobile(posts[i]);
    await sleep(DETAIL_DELAY_MS);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(posts, null, 2), 'utf8');
  console.log(`[scraper] wrote ${posts.length} posts -> ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(`[scraper] fatal: ${e.message}`);
  process.exit(1);
});
