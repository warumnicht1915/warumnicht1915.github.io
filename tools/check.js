#!/usr/bin/env node
'use strict';
/**
 * 빌드 결과 자체 점검 스크립트.
 * 배포 전에 깨진 내부 링크, 빠진 파일, 남은 템플릿 문법을 잡는다.
 *   node tools/check.js
 */
const fs = require('fs');
const path = require('path');
const { walk } = require('../engine/util');

const OUT = path.join(__dirname, '..', '_site');
const problems = [];
const warn = [];

if (!fs.existsSync(OUT)) {
  console.error('_site 가 없습니다. 먼저 node build.js 를 실행하세요.');
  process.exit(1);
}

const files = walk(OUT);
const html = files.filter((f) => f.endsWith('.html'));
const rel = (f) => path.relative(OUT, f).replace(/\\/g, '/');
const exists = new Set(files.map(rel));

// 필수 산출물
['index.html', '404.html', 'sitemap.xml', 'feed.xml', 'robots.txt',
 'search-index.json', 'assets/css/style.css', 'assets/js/config.js']
  .forEach((f) => { if (!exists.has(f)) problems.push(`필수 파일 없음: ${f}`); });

for (const file of html) {
  const src = fs.readFileSync(file, 'utf8');
  const name = rel(file);

  // 처리되지 않은 템플릿 태그 (코드 블록 안의 예시는 제외)
  const stripped = src.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code[\s\S]*?<\/code>/g, '');
  if (/\{%\s*(if|for|include|set|end)\b/.test(stripped)) {
    problems.push(`템플릿 태그가 남아 있음: ${name}`);
  }
  if (/undefined|\[object Object\]/.test(stripped)) {
    warn.push(`의심스러운 출력(undefined 등): ${name}`);
  }

  // 내부 링크 검사
  const links = [...src.matchAll(/(?:href|src)="(\/[^"#?]*)/g)].map((m) => m[1]);
  for (const href of new Set(links)) {
    const decoded = decodeURIComponent(href);
    const target = decoded.endsWith('/') ? decoded + 'index.html' : decoded;
    const key = target.replace(/^\//, '');
    if (!key) continue;
    if (!exists.has(key) && !exists.has(key + '/index.html')) {
      problems.push(`깨진 내부 링크: ${name} → ${href}`);
    }
  }

  // 접근성 최소 점검
  const imgs = [...src.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  imgs.forEach((tag) => { if (!/\balt=/.test(tag)) warn.push(`alt 없는 이미지: ${name}`); });
}

const idx = JSON.parse(fs.readFileSync(path.join(OUT, 'search-index.json'), 'utf8'));
if (!Array.isArray(idx) || !idx.length) warn.push('검색 인덱스가 비어 있습니다.');

console.log(`\n  점검 대상 HTML ${html.length}개, 전체 파일 ${files.length}개`);
warn.slice(0, 20).forEach((w) => console.log('  경고  ' + w));
problems.slice(0, 40).forEach((p) => console.log('  오류  ' + p));

if (problems.length) {
  console.log(`\n  오류 ${problems.length}건. 배포 전에 고쳐야 합니다.\n`);
  process.exit(1);
}
console.log(`  통과 — 오류 없음${warn.length ? ` (경고 ${warn.length}건)` : ''}\n`);
