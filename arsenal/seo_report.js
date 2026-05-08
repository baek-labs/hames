// node seo_report.js
// Joins posts.json + keywords.json -> SEO_Report_<date>.md in <workspace>/SEO/
'use strict';
process.stdout.setEncoding('utf8');

const fs = require('fs');
const path = require('path');

const SEO_DIR = path.resolve(__dirname, '..', '01_Business', '01_Tech_Venture', 'Project_A', 'SEO');
const POSTS_FILE = path.join(SEO_DIR, 'posts.json');
const KEYWORDS_FILE = path.join(SEO_DIR, 'keywords.json');

function loadJson(p) {
  if (!fs.existsSync(p)) {
    console.error(`[report] missing input: ${p}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function totalSearch(k) { return (k.monthlyPcQcCnt || 0) + (k.monthlyMobileQcCnt || 0); }

function postCovers(post, keyword) {
  if (!keyword) return false;
  const hay = `${post.title || ''} ${post.contentText || ''}`.toLowerCase();
  return hay.includes(String(keyword).toLowerCase());
}

function diagnoseTitle(t) {
  const len = (t || '').length;
  const issues = [];
  if (len < 20) issues.push('짧음');
  else if (len > 45) issues.push('길음');
  if (!/[?!:·]/.test(t || '') && len > 0) issues.push('후킹약함');
  return { len, issues };
}

function keywordDensity(text, keyword) {
  if (!text || !keyword) return 0;
  const t = text.toLowerCase();
  const k = keyword.toLowerCase();
  if (k.length === 0) return 0;
  let cnt = 0, idx = 0;
  while ((idx = t.indexOf(k, idx)) !== -1) { cnt++; idx += k.length; }
  return cnt;
}

function fmtNum(n) { return (n || 0).toLocaleString('ko-KR'); }

function main() {
  const posts = loadJson(POSTS_FILE);
  const keywords = loadJson(KEYWORDS_FILE);

  // 1) gap analysis
  const sortedKw = [...keywords].sort((a, b) => totalSearch(b) - totalSearch(a));
  const gaps = [];
  for (const kw of sortedKw) {
    const covered = posts.some((p) => postCovers(p, kw.keyword));
    if (!covered) gaps.push(kw);
    if (gaps.length >= 20) break;
  }

  // 2) post diagnosis
  const topKwList = sortedKw.slice(0, 30).map((k) => k.keyword);
  const postRows = posts.map((p) => {
    const t = diagnoseTitle(p.title);
    const matchedKw = topKwList.find((k) => postCovers(p, k)) || '-';
    const density = matchedKw === '-' ? 0 : keywordDensity(p.contentText || '', matchedKw);
    const lenIssue = (p.contentLength || 0) < 1500 ? '본문부족' : '';
    const linkIssue = (p.internalLinks || []).length === 0 ? '내부링크0' : '';
    const titleIssue = t.issues.join(',') || 'OK';
    return {
      title: p.title || '(제목없음)',
      url: p.url,
      titleLen: t.len,
      titleIssue,
      contentLength: p.contentLength || 0,
      lenIssue,
      matchedKw,
      density,
      internalLinks: (p.internalLinks || []).length,
      linkIssue,
      category: p.category || '-'
    };
  });

  // 3) category consistency
  const categoryCount = {};
  for (const p of posts) {
    const c = p.category || '(미분류)';
    categoryCount[c] = (categoryCount[c] || 0) + 1;
  }
  const totalPosts = posts.length || 1;

  // 4) immediate actions (top 5)
  const actions = [];
  const weakTitles = postRows.filter((r) => r.titleIssue !== 'OK').slice(0, 2);
  weakTitles.forEach((r) => actions.push(`제목 재작성: "${r.title}" (${r.titleIssue}, ${r.titleLen}자)`));
  const thinPosts = postRows.filter((r) => r.contentLength < 1500).slice(0, 2);
  thinPosts.forEach((r) => actions.push(`본문 보강: "${r.title}" (${r.contentLength}자 → 1500자+ 목표)`));
  if (gaps[0]) actions.push(`즉시 신규 발행: "${gaps[0].keyword}" (월 검색량 ${fmtNum(totalSearch(gaps[0]))})`);
  while (actions.length < 5 && gaps[actions.length - 4 + 1]) {
    const g = gaps[actions.length - 4 + 1];
    actions.push(`신규 발행: "${g.keyword}" (월 검색량 ${fmtNum(totalSearch(g))})`);
  }

  // 5) 10 content recommendations
  const recs = gaps.slice(0, 10).map((g, i) => {
    const angle = totalSearch(g) > 5000 ? '대형 정보성 글' : (g.compIdx === '높음' ? '롱테일 케이스' : '입문자 가이드');
    return `${i + 1}. "${g.keyword}" — ${angle} (PC ${fmtNum(g.monthlyPcQcCnt)} / Mobile ${fmtNum(g.monthlyMobileQcCnt)} / 경쟁 ${g.compIdx || '-'})`;
  });

  // assemble markdown
  const date = todayISO();
  const fm = [
    '---',
    'Type: Project_A',
    'Topic: Marketing',
    'Related: Notion Dashboard: My Business Dashboard',
    `Generated: ${new Date().toISOString()}`,
    '---',
    ''
  ].join('\n');

  const lines = [];
  lines.push(`# Project_A SEO Report — ${date}`);
  lines.push('');
  lines.push('## 1. 현황 요약');
  lines.push('');
  lines.push(`- 총 포스트: **${posts.length}건**`);
  lines.push(`- 평균 본문 길이: **${Math.round(posts.reduce((s, p) => s + (p.contentLength || 0), 0) / totalPosts)}자**`);
  lines.push(`- 키워드 풀: **${keywords.length}개** (시드 + 연관)`);
  lines.push(`- 키워드 갭(미커버 Top20): **${gaps.length}개**`);
  lines.push(`- 카테고리 분포: ${Object.entries(categoryCount).map(([k, v]) => `${k} ${v}`).join(' / ') || '-'}`);
  lines.push('');

  lines.push('## 2. 키워드 갭 Top 20');
  lines.push('');
  lines.push('| # | 키워드 | PC | Mobile | 합계 | 경쟁 |');
  lines.push('|---|---|---:|---:|---:|---|');
  gaps.forEach((g, i) => {
    lines.push(`| ${i + 1} | ${g.keyword} | ${fmtNum(g.monthlyPcQcCnt)} | ${fmtNum(g.monthlyMobileQcCnt)} | ${fmtNum(totalSearch(g))} | ${g.compIdx || '-'} |`);
  });
  lines.push('');

  lines.push('## 3. 포스트별 진단');
  lines.push('');
  lines.push('| 제목 | 제목길이 | 제목이슈 | 본문 | 본문이슈 | 매칭KW | 밀도 | 내부링크 |');
  lines.push('|---|---:|---|---:|---|---|---:|---:|');
  postRows.forEach((r) => {
    const t = (r.title || '').replace(/\|/g, '/').slice(0, 40);
    lines.push(`| ${t} | ${r.titleLen} | ${r.titleIssue} | ${fmtNum(r.contentLength)} | ${r.lenIssue || 'OK'} | ${r.matchedKw} | ${r.density} | ${r.internalLinks} |`);
  });
  lines.push('');

  lines.push('## 4. 즉시 조치 5건');
  lines.push('');
  actions.slice(0, 5).forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  lines.push('');

  lines.push('## 5. 신규 콘텐츠 추천 10건');
  lines.push('');
  recs.forEach((r) => lines.push(`- ${r}`));
  lines.push('');

  const outFile = path.join(SEO_DIR, `SEO_Report_${date}.md`);
  fs.writeFileSync(outFile, fm + lines.join('\n'), 'utf8');
  console.log(`[report] wrote -> ${outFile}`);
}

try { main(); }
catch (e) { console.error(`[report] fatal: ${e.message}`); process.exit(1); }
