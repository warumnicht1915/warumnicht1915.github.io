#!/usr/bin/env node
'use strict';
/**
 * 이슈 → 글 변환기 (GitHub Actions 에서 실행)
 * ------------------------------------------------------------
 * 이슈 제목이 글 제목이 되고, 본문이 그대로 마크다운 본문이 된다.
 * 본문 맨 위에 아래 형태의 설정 줄을 넣으면 그대로 반영된다.
 *
 *   ::: 게시판: 개발
 *   ::: 태그: 자바스크립트, 파서
 *   ::: 요약: 한 줄 요약
 *   ::: 고정: 예
 *   ::: 초안: 예
 *   ::: 주소: my-slug
 *
 * 이슈를 닫으면 해당 글 파일을 지운다.
 */

const fs = require('fs');
const path = require('path');
const { slugify, formatDate } = require('../engine/util');

const issue = JSON.parse(process.env.ISSUE_JSON || '{}');
const action = process.env.ACTION || '';
const POSTS = path.join(__dirname, '..', 'content', 'posts');

/** 이 이슈가 만들어 둔 글 파일을 찾는다 (이슈 번호를 표식으로 남긴다) */
const MARK = (n) => `issue: ${n}`;

function findExisting(number) {
  if (!fs.existsSync(POSTS)) return null;
  for (const name of fs.readdirSync(POSTS)) {
    if (!/\.mdx?$/.test(name)) continue;
    const full = path.join(POSTS, name);
    const head = fs.readFileSync(full, 'utf8').split('\n', 30).join('\n');
    if (head.includes(MARK(number))) return full;
  }
  return null;
}

function output(key, value) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null',
    `${key}<<__EOF__\n${value}\n__EOF__\n`);
}

/* ── 이슈를 닫으면 글을 내린다 ─────────────────────────── */
if (action === 'closed' || (action === 'unlabeled' && !hasPostLabel())) {
  const file = findExisting(issue.number);
  if (file) {
    fs.unlinkSync(file);
    output('message', `이슈 #${issue.number} 닫힘 — 글 내림`);
    output('comment', '이 이슈가 닫혀서 블로그에서 글을 내렸습니다. 다시 열면 복구됩니다.');
  }
  process.exit(0);
}

function hasPostLabel() {
  return (issue.labels || []).some((l) => (l.name || l) === 'post');
}

/* ── 본문에서 설정 줄을 뽑아낸다 ───────────────────────── */
const raw = String(issue.body || '').replace(/\r\n?/g, '\n');
const opts = {};
const bodyLines = [];

for (const line of raw.split('\n')) {
  const m = line.match(/^:::\s*([^:]+)\s*:\s*(.*)$/);
  if (m) { opts[m[1].trim()] = m[2].trim(); continue; }
  bodyLines.push(line);
}

const pick = (...keys) => {
  for (const k of keys) if (opts[k]) return opts[k];
  return '';
};
const yes = (v) => /^(예|y|yes|true|on|o)$/i.test(String(v).trim());
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

const title = String(issue.title || '제목 없음').trim();
const slug = slugify(pick('주소', 'slug') || title);
const created = new Date(issue.created_at || Date.now());
const date = formatDate(created, 'YYYY-MM-DD');
const time = formatDate(created, 'HH:mm');

const categories = list(pick('게시판', '카테고리', 'category')) ;
const tags = list(pick('태그', 'tags'));
const description = pick('요약', 'description');
const image = pick('대표이미지', '이미지', 'image');

const body = bodyLines.join('\n').trim();

const fm = ['---'];
fm.push(`title: ${title}`);
if (pick('부제', 'subtitle')) fm.push(`subtitle: ${pick('부제', 'subtitle')}`);
fm.push(`date: ${date} ${time}`);
fm.push(`categories: [${(categories.length ? categories : ['일기']).join(', ')}]`);
fm.push(`tags: [${tags.join(', ')}]`);
if (image) fm.push(`image: ${image}`);
if (yes(pick('고정', 'pinned'))) fm.push('pinned: true');
if (yes(pick('초안', 'draft'))) fm.push('draft: true');
if (description) fm.push(`description: ${description}`);
fm.push(`issue: ${issue.number}`);
fm.push('---', '');

const content = fm.join('\n') + body + '\n';

fs.mkdirSync(POSTS, { recursive: true });
const target = path.join(POSTS, `${date}-${slug}.md`);
const existing = findExisting(issue.number);

if (existing && existing !== target) fs.unlinkSync(existing);
fs.writeFileSync(target, content);

const rel = path.relative(path.join(__dirname, '..'), target);
output('message', `이슈 #${issue.number} → ${rel}`);
output('comment',
  `발행했습니다: **${title}**\n\n` +
  `- 파일: \`${rel}\`\n` +
  `- 이 이슈를 수정하면 글도 같이 바뀝니다.\n` +
  `- 이슈를 닫으면 글이 내려갑니다.\n\n` +
  `1~2분 뒤 블로그에 반영됩니다.`);
