'use strict';
/**
 * Gaon Engine — 사이트 모델
 * 콘텐츠 폴더를 읽어 글/페이지/카테고리/태그/아카이브/페이지네이션을 만든다.
 */
const fs = require('fs');
const path = require('path');
const fm = require('./frontmatter');
const md = require('./markdown');
const u = require('./util');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}

function loadData(dir) {
  const data = {};
  if (!fs.existsSync(dir)) return data;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    data[name.replace(/\.json$/, '')] = readJson(path.join(dir, name), null);
  }
  return data;
}

/** 파일명에서 날짜와 슬러그를 뽑는다: 2026-09-01-my-post.md */
function parseName(file) {
  const base = path.basename(file).replace(/\.mdx?$/, '');
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, slug: m[4] } : { date: null, slug: base };
}

function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v.filter((x) => x !== '' && x !== null) : [v];
}

function buildPost(file, config) {
  const raw = fs.readFileSync(file, 'utf8');
  const { data, body } = fm.split(raw);
  const named = parseName(file);
  const slug = data.slug || named.slug;
  const dateStr = data.date || named.date || '1970-01-01';
  // <!--more--> 앞부분을 미리보기로 쓴다
  const MORE = /<!--\s*more\s*-->/;
  const lead = MORE.test(body) ? body.split(MORE)[0] : body;
  const rendered = md.render(body);

  const url = (config.permalink || '/posts/:slug/').replace(':slug', slug);
  const excerpt = data.description
    ? u.truncate(String(data.description), 150)
    : u.truncate(u.stripHtml(md.render(lead).html), 150);

  return {
    type: 'post',
    file,
    slug,
    url,
    title: data.title || slug,
    subtitle: data.subtitle || '',
    date: dateStr,
    dateObj: u.toDate(dateStr),
    dateLabel: u.formatDate(dateStr, 'YYYY.MM.DD'),
    dateFull: u.formatDate(dateStr, 'YYYY년 M월 D일 (ddd)'),
    iso: u.isoDate(dateStr),
    year: u.formatDate(dateStr, 'YYYY'),
    monthDay: u.formatDate(dateStr, 'MM.DD'),
    categories: toArray(data.categories || data.category),
    category: toArray(data.categories || data.category)[0] || '미분류',
    tags: toArray(data.tags),
    image: data.image || '',
    pinned: data.pinned === true,
    draft: data.draft === true,
    comments: data.comments !== false,
    toc: rendered.toc,
    showToc: data.toc !== false && rendered.toc.length > 1,
    html: rendered.html,
    text: u.stripHtml(rendered.html),
    excerpt,
    description: data.description || excerpt,
    readingTime: u.readingMinutes(rendered.html),
    meta: data,
  };
}

function buildPage(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const { data, body } = fm.split(raw);
  const slug = path.basename(file).replace(/\.mdx?$/, '');
  const rendered = md.render(body);
  return {
    type: 'page',
    file,
    slug,
    url: data.permalink || `/${slug}/`,
    title: data.title || slug,
    subtitle: data.subtitle || '',
    description: data.description || '',
    layout: data.layout || 'page',
    comments: data.comments === true,
    toc: rendered.toc,
    showToc: data.toc === true,
    html: rendered.html,
    meta: data,
  };
}

/** 목록을 n개씩 잘라 페이지네이션 정보를 만든다. */
function paginate(items, perPage, pathOf) {
  const total = Math.max(1, Math.ceil(items.length / perPage));
  const pages = [];
  for (let n = 1; n <= total; n++) {
    const start = (n - 1) * perPage;
    pages.push({
      page: n,
      totalPages: total,
      totalItems: items.length,
      items: items.slice(start, start + perPage),
      prevUrl: n > 1 ? pathOf(n - 1) : null,
      nextUrl: n < total ? pathOf(n + 1) : null,
      numbers: Array.from({ length: total }, (_, k) => ({
        n: k + 1, url: pathOf(k + 1), current: k + 1 === n,
      })),
    });
  }
  return pages;
}

function load(root) {
  const config = readJson(path.join(root, 'site.config.json'), {});
  config.data = loadData(path.join(root, 'data'));

  const postFiles = u.walk(path.join(root, 'content', 'posts'), (f) => /\.mdx?$/.test(f));
  const posts = postFiles
    .map((f) => buildPost(f, config))
    .filter((p) => !p.draft || config.showDrafts)
    .sort((a, b) => b.dateObj - a.dateObj);

  posts.forEach((p, i) => {
    p.newer = i > 0 ? { url: posts[i - 1].url, title: posts[i - 1].title } : null;
    p.older = i < posts.length - 1 ? { url: posts[i + 1].url, title: posts[i + 1].title } : null;
  });

  const pageFiles = u.walk(path.join(root, 'content', 'pages'), (f) => /\.mdx?$/.test(f));
  const pages = pageFiles.map(buildPage);

  // 카테고리 · 태그 · 연도별 묶기
  const catMap = new Map();
  const tagMap = new Map();
  const yearMap = new Map();

  for (const p of posts) {
    for (const c of (p.categories.length ? p.categories : ['미분류'])) {
      if (!catMap.has(c)) catMap.set(c, []);
      catMap.get(c).push(p);
    }
    for (const t of p.tags) {
      if (!tagMap.has(t)) tagMap.set(t, []);
      tagMap.get(t).push(p);
    }
    if (!yearMap.has(p.year)) yearMap.set(p.year, []);
    yearMap.get(p.year).push(p);
  }

  const categories = [...catMap.entries()]
    .map(([name, items]) => ({ name, slug: u.slugify(name), count: items.length, posts: items, latest: items[0] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));

  const tags = [...tagMap.entries()]
    .map(([name, items]) => ({ name, slug: u.slugify(name), count: items.length, posts: items }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));

  const archive = [...yearMap.entries()]
    .map(([year, items]) => ({ year, count: items.length, posts: items }))
    .sort((a, b) => Number(b.year) - Number(a.year));

  return {
    config,
    posts,
    pages,
    categories,
    tags,
    archive,
    pinned: posts.filter((p) => p.pinned),
    recent: posts.slice(0, 5),
    paginate,
  };
}

module.exports = { load, paginate, buildPost, buildPage };
