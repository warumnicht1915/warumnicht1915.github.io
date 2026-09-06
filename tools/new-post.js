#!/usr/bin/env node
'use strict';
/**
 * 새 글 파일을 만들어 준다.
 *   node tools/new-post.js "글 제목" [카테고리] [태그,태그]
 */
const fs = require('fs');
const path = require('path');
const { slugify, formatDate } = require('../engine/util');

const [, , title, category, tags] = process.argv;
if (!title) {
  console.log('사용법: node tools/new-post.js "글 제목" [카테고리] [태그,태그]');
  process.exit(1);
}

const now = new Date();
const date = formatDate(now, 'YYYY-MM-DD');
const slug = slugify(title);
const file = path.join(__dirname, '..', 'content', 'posts', `${date}-${slug}.md`);

if (fs.existsSync(file)) {
  console.log('이미 같은 이름의 글이 있습니다:', file);
  process.exit(1);
}

const tagList = (tags || '').split(',').map((t) => t.trim()).filter(Boolean);

fs.writeFileSync(file, [
  '---',
  `title: ${title}`,
  'subtitle: ',
  `date: ${formatDate(now, 'YYYY-MM-DD HH:mm')}`,
  `categories: [${category || '일기'}]`,
  `tags: [${tagList.join(', ')}]`,
  'description: ',
  'draft: true',
  '---',
  '',
  '여기에 도입부를 씁니다.',
  '',
  '<!--more-->',
  '',
  '## 첫 번째 소제목',
  '',
  '내용.',
  '',
].join('\n'));

console.log('만들었습니다:', path.relative(process.cwd(), file));
console.log('초안 상태입니다. 발행하려면 draft: true 줄을 지우세요.');
