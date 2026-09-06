#!/usr/bin/env node
'use strict';
/**
 * Gaon — 정적 블로그 빌더 (진입점)
 * ================================
 * 사용법:
 *   node build.js            빌드만 수행 (_site 생성)
 *   node build.js --serve    빌드 후 로컬 서버 실행 (기본 4000 포트)
 *   node build.js --watch    파일이 바뀌면 자동 재빌드 (--serve 와 함께 쓰면 좋다)
 *   node build.js --drafts   초안(draft: true)도 포함해서 빌드
 *
 * 외부 의존성 0개. 마크다운·템플릿·하이라이팅 전부 engine/ 안의 자체 구현.
 */

const fs = require('fs');
const path = require('path');
const site = require('./engine/site');
const { Renderer } = require('./engine/renderer');
const u = require('./engine/util');

const ROOT = __dirname;
const OUT = path.join(ROOT, '_site');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);


/* ─────────────── 엔진을 브라우저용으로 묶기 ─────────────── */
/**
 * 관리자 페이지의 마크다운 미리보기는 빌드에 쓰는 것과 **똑같은 파서**를 써야 한다.
 * 그래서 engine/highlight.js 와 engine/markdown.js 를 읽어 require/exports 만 걷어내고
 * 하나의 IIFE 로 감싸 window.GaonMD 로 노출한다. 번들러를 따로 쓰지 않는다.
 */
function browserBundle(root) {
  const read = (f) => fs.readFileSync(path.join(root, 'engine', f), 'utf8');

  const strip = (src) => src
    .replace(/^'use strict';\s*$/m, '')
    .replace(/^const \{[^}]*\} = require\([^)]*\);\s*$/gm, '')
    .replace(/^const [\w$]+ = require\([^)]*\);\s*$/gm, '')
    .replace(/^module\.exports\s*=[\s\S]*?;\s*$/m, '');

  /** util.js 에서 최상위 함수 하나만 그대로 떼어 온다. */
  const extractFn = (src, name) => {
    const start = src.indexOf('function ' + name + '(');
    if (start === -1) throw new Error('함수를 찾지 못했습니다: ' + name);
    let depth = 0, i = src.indexOf('{', start);
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
    }
    throw new Error('함수 끝을 찾지 못했습니다: ' + name);
  };

  // 모듈마다 이름이 겹칠 수 있으므로(esc 등) 각자 자기 스코프에 가둔다.
  return [
    '/* 빌드 시 engine/ 에서 자동 생성됩니다. 직접 수정하지 마세요. */',
    '(function (global) {',
    "  'use strict';",
    '',
    'var slugify = (function () {',
    extractFn(read('util.js'), 'slugify'),
    '  return slugify;',
    '})();',
    '',
    'var __hl = (function () {',
    strip(read('highlight.js')),
    '  return { highlight: highlight, normalize: normalize };',
    '})();',
    '',
    'var __md = (function (highlight, slugify) {',
    strip(read('markdown.js')),
    '  return { render: render, inline: inline };',
    '})(__hl.highlight, slugify);',
    '',
    '  global.GaonMD = {',
    '    render: __md.render, inline: __md.inline,',
    '    highlight: __hl.highlight, slugify: slugify',
    '  };',
    '})(window);',
    '',
  ].join('\n');
}

/* ─────────────────────────── 빌드 ─────────────────────────── */

function build() {
  const started = Date.now();
  const model = site.load(ROOT);
  const cfg = model.config;
  if (flag('drafts')) cfg.showDrafts = true;

  const base = (cfg.baseurl || '').replace(/\/$/, '');
  // 이미 완성된 주소(외부 링크·mailto·앵커)는 그대로 둔다
  const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
  const url = (p) => {
    const s2 = String(p == null ? '' : p);
    if (EXTERNAL.test(s2)) return s2;
    return (base + (s2.startsWith('/') ? s2 : '/' + s2)).replace(/\/{2,}/g, '/') || '/';
  };
  const absolute = (p) => {
    const s2 = url(p);
    return EXTERNAL.test(s2) ? s2 : (cfg.url || '').replace(/\/$/, '') + s2;
  };

  const renderer = new Renderer(path.join(ROOT, 'templates'), {
    url: (v) => url(String(v || '/')),
    abs: (v) => absolute(String(v || '/')),
    catUrl: (slug) => url('/category/' + slug + '/'),
    tagUrl: (slug) => url('/tag/' + slug + '/'),
  });

  u.rmDir(OUT);
  u.ensureDir(OUT);

  /** 모든 템플릿이 공통으로 받는 값 */
  const globals = {
    site: {
      title: cfg.title,
      subtitle: cfg.subtitle,
      description: cfg.description,
      url: cfg.url,
      baseurl: base,
      lang: cfg.lang,
      locale: cfg.locale,
      author: cfg.author,
      comments: cfg.comments,
      realtime: cfg.realtime,
      counter: cfg.counter,
      widgets: cfg.widgets,
      buildTime: u.formatDate(new Date(), 'YYYY.MM.DD HH:mm'),
      year: u.formatDate(new Date(), 'YYYY'),
      postCount: model.posts.length,
      categoryCount: model.categories.length,
      tagCount: model.tags.length,
    },
    nav: cfg.data.nav || [],
    notice: cfg.data.notice || [],
    links: cfg.data.links || [],
    trends: cfg.data.trends || [],
    posts: model.posts,
    recent: model.posts.slice(0, cfg.widgets.recentSize || 5),
    popular: model.posts.slice(0, cfg.widgets.popularSize || 6),
    categories: model.categories,
    tags: model.tags,
    archive: model.archive,
    pinned: model.pinned,
    // 클라이언트 스크립트에 넘길 설정 (JSON 으로 주입)
    clientConfig: {
      baseurl: base,
      repo: (cfg.comments && cfg.comments.giscus && cfg.comments.giscus.repo) || '',
      firebase: cfg.realtime.firebase,
      room: cfg.realtime.room,
      chat: {
        max: cfg.realtime.maxMessages,
        nickMax: cfg.realtime.nickMaxLength,
        textMax: cfg.realtime.textMaxLength,
      },
      counter: cfg.counter,
      trends: { size: cfg.widgets.trendsSize, seed: cfg.data.trends || [] },
      comments: cfg.comments,
    },
  };

  const written = [];
  const emit = (outPath, html) => {
    const file = path.join(OUT, outPath);
    u.writeFile(file, html);
    written.push(outPath);
  };

  /** 페이지 하나를 레이아웃까지 씌워 출력한다. */
  const renderPage = (layout, pageCtx, innerHtml, outPath) => {
    const ctx = Object.assign(Object.create(null), globals, { page: pageCtx });
    emit(outPath, renderer.renderLayout(layout, ctx, innerHtml || ''));
  };

  const outPathFor = (u2) => {
    const clean = u2.replace(/^\//, '').replace(/\/$/, '');
    if (!clean) return 'index.html';
    return clean.endsWith('.html') ? clean : path.join(clean, 'index.html');
  };

  /* 1) 홈 (페이지네이션) */
  const pager = site.paginate(model.posts, cfg.perPage, (n) => (n === 1 ? '/' : `/page/${n}/`));
  pager.forEach((p) => {
    renderPage('home', {
      kind: 'home',
      title: p.page === 1 ? null : `${p.page}페이지`,
      url: p.page === 1 ? '/' : `/page/${p.page}/`,
      description: cfg.description,
      paginator: p,
      showPinned: p.page === 1,
    }, '', outPathFor(p.page === 1 ? '/' : `/page/${p.page}/`));
  });

  /* 2) 글 상세 */
  for (const post of model.posts) {
    const related = model.posts
      .filter((q) => q.url !== post.url && q.categories.some((c) => post.categories.includes(c)))
      .slice(0, 2);
    renderPage('post', Object.assign({ kind: 'post', related }, post), post.html, outPathFor(post.url));
  }

  /* 3) 마크다운 페이지 (소개, 방명록 …) */
  for (const pg of model.pages) {
    renderPage(pg.layout, Object.assign({ kind: 'page' }, pg), pg.html, outPathFor(pg.url));
  }

  /* 4) 템플릿 페이지 (글목록, 게시판, 태그, 검색, 404 …) */
  const tplPages = u.walk(path.join(ROOT, 'templates', 'pages'), (f) => f.endsWith('.html'));
  for (const file of tplPages) {
    const rel = path.posix.join('pages', path.basename(file));
    const entry = renderer.load(rel);
    const meta = entry.meta;
    const ctx = Object.assign(Object.create(null), globals, {
      page: Object.assign({ kind: 'template' }, meta, { url: meta.permalink || '/' }),
    });
    const inner = require('./engine/template').renderNodes(entry.ast, ctx, renderer);
    const out = meta.permalink === '/404.html' ? '404.html' : outPathFor(meta.permalink);
    emit(out, renderer.renderLayout(meta.layout || 'page', ctx, inner));
  }

  /* 5) 카테고리별 페이지 */
  for (const cat of model.categories) {
    renderPage('list', {
      kind: 'category',
      title: cat.name,
      subtitle: `'${cat.name}' 게시판에 ${cat.count}개의 글이 있습니다.`,
      url: `/category/${cat.slug}/`,
      badge: '게시판',
      items: cat.posts,
    }, '', outPathFor(`/category/${cat.slug}/`));
  }

  /* 6) 태그별 페이지 */
  for (const tag of model.tags) {
    renderPage('list', {
      kind: 'tag',
      title: `#${tag.name}`,
      subtitle: `'${tag.name}' 태그가 달린 글 ${tag.count}개.`,
      url: `/tag/${tag.slug}/`,
      badge: '태그',
      items: tag.posts,
    }, '', outPathFor(`/tag/${tag.slug}/`));
  }

  /* 7) 검색 인덱스 · 사이트맵 · RSS · robots */
  emit('search-index.json', JSON.stringify(model.posts.map((p) => ({
    t: p.title,
    u: url(p.url),
    d: p.dateLabel,
    c: p.category,
    g: p.tags,
    i: p.image ? url(p.image) : '',
    e: p.excerpt,
    b: u.truncate(p.text, 1800, ''),
  }))));

  const allUrls = [
    ...pager.map((p) => (p.page === 1 ? '/' : `/page/${p.page}/`)),
    ...model.posts.map((p) => p.url),
    ...model.pages.map((p) => p.url),
    ...model.categories.map((c) => `/category/${c.slug}/`),
    ...model.tags.map((t) => `/tag/${t.slug}/`),
    '/archive/', '/categories/', '/tags/', '/search/',
  ];
  emit('sitemap.xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    allUrls.map((p) => `  <url><loc>${u.xmlEscape(absolute(p))}</loc></url>`).join('\n') +
    '\n</urlset>\n');

  emit('feed.xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>\n' +
    `  <title>${u.xmlEscape(cfg.title)}</title>\n` +
    `  <link>${u.xmlEscape(cfg.url)}</link>\n` +
    `  <description>${u.xmlEscape(cfg.description)}</description>\n` +
    `  <language>${cfg.lang}</language>\n` +
    `  <atom:link href="${u.xmlEscape(absolute('/feed.xml'))}" rel="self" type="application/rss+xml"/>\n` +
    model.posts.slice(0, 20).map((p) =>
      '  <item>\n' +
      `    <title>${u.xmlEscape(p.title)}</title>\n` +
      `    <link>${u.xmlEscape(absolute(p.url))}</link>\n` +
      `    <guid isPermaLink="true">${u.xmlEscape(absolute(p.url))}</guid>\n` +
      `    <pubDate>${new Date(p.dateObj).toUTCString()}</pubDate>\n` +
      `    <category>${u.xmlEscape(p.category)}</category>\n` +
      `    <description>${u.xmlEscape(p.excerpt)}</description>\n` +
      '  </item>').join('\n') +
    '\n</channel></rss>\n');

  emit('robots.txt',
    `User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${absolute('/sitemap.xml')}\n`);
  emit('.nojekyll', '');
  if (cfg.cname) emit('CNAME', cfg.cname + '\n');

  /* 8) 정적 자원 복사 + 클라이언트 설정 주입 */
  const copied = u.copyDir(path.join(ROOT, 'static'), path.join(OUT, 'assets'));
  u.writeFile(path.join(OUT, 'assets', 'js', 'gaon-md.js'), browserBundle(ROOT));
  u.writeFile(path.join(OUT, 'assets', 'js', 'config.js'),
    '/* 빌드 시 자동 생성됩니다. 직접 수정하지 마세요. */\n' +
    'window.GAON_CONFIG = ' + JSON.stringify(globals.clientConfig, null, 2) + ';\n');

  const ms = Date.now() - started;
  console.log(
    `\n  Gaon build 완료  ·  ${ms}ms\n` +
    `  글 ${model.posts.length} · 페이지 ${model.pages.length + tplPages.length} · ` +
    `카테고리 ${model.categories.length} · 태그 ${model.tags.length}\n` +
    `  HTML ${written.length}개, 정적 파일 ${copied}개 → _site/\n`);
  return model;
}

/* ─────────────────────── 개발용 로컬 서버 ─────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function serve(port) {
  const http = require('http');
  http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(OUT, p);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) file = path.join(OUT, '404.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(p === req.url.split('?')[0] && fs.existsSync(path.join(OUT, p)) ? 200 : 200,
      { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`  로컬 미리보기 → http://localhost:${port}\n`));
}

function watch() {
  const dirs = ['content', 'templates', 'static', 'data', 'engine']
    .map((d) => path.join(ROOT, d)).filter(fs.existsSync);
  let timer = null;
  for (const d of dirs) {
    fs.watch(d, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          for (const k of Object.keys(require.cache)) {
            if (k.startsWith(path.join(ROOT, 'engine'))) delete require.cache[k];
          }
          build();
        } catch (e) { console.error('  빌드 실패:', e.message); }
      }, 120);
    });
  }
  console.log('  변경 감시 중… (Ctrl+C 로 종료)');
}

/* ─────────────────────────── 실행 ─────────────────────────── */

try {
  build();
} catch (e) {
  console.error('\n  빌드 실패:', e.message, '\n');
  console.error(e.stack);
  process.exit(1);
}
if (flag('watch')) watch();
if (flag('serve')) {
  const idx = args.indexOf('--port');
  serve(idx !== -1 ? Number(args[idx + 1]) : 4000);
}
