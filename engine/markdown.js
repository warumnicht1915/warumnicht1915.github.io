'use strict';
/**
 * Gaon Engine — 마크다운 파서
 * ---------------------------
 * 블록 파서 → 인라인 파서 2단 구조로 직접 구현했다.
 *
 * 블록 : 제목, 문단, 리스트(중첩/체크박스), 인용, 코드펜스, 표, 수평선,
 *        콜아웃, 원시 HTML 블록
 * 인라인: 강조/기울임/취소선/형광펜, 코드, 링크, 이미지, 자동링크, 이스케이프
 *
 * 반환값: { html, toc }  — toc 는 목차 위젯이 그대로 쓰는 배열
 */

const { highlight } = require('./highlight');
const { slugify } = require('./util');

const BLOCK_TAGS = /^<(\/?)(div|section|article|aside|header|footer|nav|figure|figcaption|table|thead|tbody|tr|td|th|ul|ol|li|p|pre|blockquote|hr|h[1-6]|iframe|video|audio|img|details|summary|script|style|main|form|canvas|svg)\b/i;

/** 자리표시자 구분자 (본문에 나올 일이 없는 사용자 영역 문자) */
const MARK = String.fromCharCode(0);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ═════════════════════════ 인라인 파서 ═════════════════════════ */

function inline(src) {
  let s = String(src);
  const slots = [];
  const hold = (html) => {
    slots.push(html);
    return MARK + (slots.length - 1) + MARK;
  };

  // 1) 코드 스팬을 가장 먼저 떼어낸다 (안쪽은 어떤 변환도 하지 않는다)
  s = s.replace(/``([\s\S]+?)``|`([^`\n]+)`/g, (_, a, b) =>
    hold('<code class="inline-code">' + esc(a !== undefined ? a : b) + '</code>'));

  // 2) 한 줄 안에 섞인 HTML 주석은 제거한다
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // 3) 원시 HTML 태그 보존
  s = s.replace(/<\/?[a-zA-Z][\w-]*(?:\s+[^<>]*?)?\/?>/g, (m) => hold(m));

  // 4) 백슬래시 이스케이프 보존
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~>|=])/g, (_, ch) => hold(esc(ch)));

  // 5) 남은 텍스트를 HTML 안전하게 만든다
  s = s.replace(/&(?![a-zA-Z#][\w]*;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 6) 이미지 → 링크 순으로 치환
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, (_, alt, url, title) => {
    const cap = title ? '<figcaption>' + esc(title) + '</figcaption>' : '';
    return hold('<figure class="md-figure"><img src="' + url + '" alt="' + esc(alt) +
      '" loading="lazy" decoding="async">' + cap + '</figure>');
  });

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, (_, text, href, title) => {
    const external = /^https?:\/\//i.test(href);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const t = title ? ' title="' + esc(title) + '"' : '';
    return '<a href="' + href + '"' + t + attrs + '>' + text + '</a>';
  });

  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

  // 7) 강조류
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])__([^_\n]+)__(?![\w_])/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  s = s.replace(/ {2,}\n/g, '<br>\n');

  // 8) 자리표시자 복원 (중첩된 경우를 대비해 반복한다)
  for (let pass = 0; pass < 5 && s.indexOf(MARK) !== -1; pass++) {
    s = s.replace(new RegExp(MARK + '(\\d+)' + MARK, 'g'), (_, n) => slots[+n]);
  }
  return s.trim();
}

/* ═════════════════════════ 블록 파서 ═════════════════════════ */

function render(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const ctx = { toc: [], seen: Object.create(null) };
  const html = blocks(lines, ctx);
  return { html, toc: ctx.toc };
}

function blocks(lines, ctx) {
  let out = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // ── HTML 주석 (<!--more--> 같은 표시)은 출력하지 않고 건너뛴다
    if (/^\s*<!--/.test(line)) {
      while (i < lines.length && !/-->/.test(lines[i])) i++;
      i++;
      continue;
    }

    // ── 코드 펜스
    const fence = line.match(/^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/);
    if (fence) {
      const marker = fence[2][0];
      const len = fence[2].length;
      const lang = fence[3] || '';
      const titleAttr = (fence[4].match(/title="([^"]+)"/) || [])[1] || '';
      const closer = new RegExp('^\\s*' + (marker === '`' ? '`' : '~') + '{' + len + ',}\\s*$');
      const buf = [];
      i++;
      while (i < lines.length && !closer.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out += codeBlock(buf.join('\n'), lang, titleAttr);
      continue;
    }

    // ── 수평선
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out += '<hr>\n'; i++; continue; }

    // ── 제목
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const plain = h[2].replace(/[*_`~\[\]()]/g, '').trim();
      let id = slugify(plain);
      if (ctx.seen[id] !== undefined) { ctx.seen[id] += 1; id = id + '-' + ctx.seen[id]; }
      else ctx.seen[id] = 0;
      if (level >= 2 && level <= 3) ctx.toc.push({ level, id, text: plain });
      out += '<h' + level + ' id="' + id + '" class="md-h md-h' + level + '">' +
        '<a class="anchor" href="#' + id + '" aria-label="이 문단 링크">#</a>' +
        inline(h[2]) + '</h' + level + '>\n';
      i++; continue;
    }

    // ── 인용 / 콜아웃 (재귀)
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      const callout = (buf[0] || '').match(/^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*(.*)$/i);
      if (callout) {
        buf[0] = callout[2];
        const kind = callout[1].toLowerCase();
        const labels = { note: '참고', tip: '팁', warning: '주의', caution: '경고', important: '중요' };
        out += '<div class="callout callout-' + kind + '"><b class="callout-t">' + labels[kind] + '</b>' +
          blocks(buf, ctx) + '</div>\n';
      } else {
        out += '<blockquote>' + blocks(buf, ctx) + '</blockquote>\n';
      }
      continue;
    }

    // ── 표
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const head = splitRow(lines[i]);
      const align = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : (r ? 'right' : (l ? 'left' : ''));
      });
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { body.push(splitRow(lines[i])); i++; }
      const styleOf = (n) => (align[n] ? ' style="text-align:' + align[n] + '"' : '');
      out += '<div class="table-wrap"><table><thead><tr>' +
        head.map((c, n) => '<th' + styleOf(n) + '>' + inline(c) + '</th>').join('') +
        '</tr></thead><tbody>' +
        body.map((row) => '<tr>' + row.map((c, n) => '<td' + styleOf(n) + '>' + inline(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>\n';
      continue;
    }

    // ── 리스트
    if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
      const [listHtml, next] = list(lines, i, ctx);
      out += listHtml; i = next; continue;
    }

    // ── 원시 HTML 블록
    if (BLOCK_TAGS.test(line.trim())) {
      const buf = [];
      while (i < lines.length && lines[i].trim()) { buf.push(lines[i]); i++; }
      out += buf.join('\n') + '\n';
      continue;
    }

    // ── 문단
    const para = [];
    while (i < lines.length && lines[i].trim()
      && !/^\s*(#{1,6}\s|>|`{3,}|~{3,})/.test(lines[i])
      && !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
      && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i])
      && !BLOCK_TAGS.test(lines[i].trim())) {
      para.push(lines[i]); i++;
    }
    if (para.length) {
      const body = inline(para.join('\n'));
      const isBlock = /^<(figure|div|table|iframe|video|img|p|ul|ol|blockquote|pre)\b/i.test(body)
        && /<\/(figure|div|table|iframe|video|p|ul|ol|blockquote|pre)>$|^<img\b[^>]*>$/i.test(body);
      out += isBlock ? body + '\n' : '<p>' + body + '</p>\n';
    } else i++;
  }

  return out;
}

function splitRow(row) {
  return row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/** 들여쓰기 기준으로 중첩 리스트를 재귀 처리한다. */
function list(lines, start, ctx) {
  const first = lines[start].match(/^(\s*)([-*+]|\d+[.)])\s+/);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const nextIndent = lines[j].match(/^(\s*)/)[1].length;
      const nextItem = lines[j].match(/^(\s*)([-*+]|\d+[.)])\s+/);
      const sameKind = nextItem ? (/\d/.test(nextItem[2]) === ordered) : false;
      if (nextItem && nextIndent === baseIndent && !sameKind) break;
      if ((nextItem && nextIndent >= baseIndent) || nextIndent > baseIndent) { i = j; continue; }
      break;
    }

    const indent = line.match(/^(\s*)/)[1].length;
    const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+([\s\S]*)$/);

    if (m && indent === baseIndent) {
      if (/\d/.test(m[2]) !== ordered) break;
      items.push([m[3]]); i++; continue;
    }
    if (indent > baseIndent && items.length) {
      items[items.length - 1].push(line.slice(Math.min(indent, baseIndent + 2)));
      i++; continue;
    }
    break;
  }

  const body = items.map((chunk) => {
    let text = chunk.join('\n');
    let cls = '';
    const task = text.match(/^\[( |x|X)\]\s+([\s\S]*)$/);
    if (task) {
      cls = ' class="task"';
      text = '<input type="checkbox" disabled' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + '> ' + task[2];
    }
    const rendered = chunk.length > 1
      ? blocks(text.split('\n'), ctx).replace(/^<p>([\s\S]*?)<\/p>\n?/, '$1')
      : inline(text);
    return '<li' + cls + '>' + rendered + '</li>';
  }).join('\n');

  const tag = ordered ? 'ol' : 'ul';
  return ['<' + tag + ' class="md-list">\n' + body + '\n</' + tag + '>\n', i];
}

function codeBlock(code, lang, title) {
  const label = (lang || 'text').toUpperCase();
  const highlighted = highlight(code, lang);
  const lineCount = code.split('\n').length;
  let gutter = '';
  for (let n = 1; n <= lineCount; n++) gutter += '<span>' + n + '</span>';
  return '<div class="code-block" data-lang="' + esc(lang || 'text') + '">\n' +
    '  <div class="code-head"><span class="code-lang">' + esc(title || label) + '</span>' +
    '<button type="button" class="code-copy" aria-label="코드 복사">복사</button></div>\n' +
    '  <div class="code-body"><div class="code-gutter" aria-hidden="true">' + gutter + '</div>' +
    '<pre><code>' + highlighted + '</code></pre></div>\n</div>\n';
}

module.exports = { render, inline };
