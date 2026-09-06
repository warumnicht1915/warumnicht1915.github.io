'use strict';
/**
 * Gaon Engine — template engine
 * -----------------------------
 * 직접 만든 템플릿 언어. 문법은 다음 다섯 가지뿐이다.
 *
 *   {{ 값 | 필터: 인자 }}                     출력 (기본 HTML 이스케이프)
 *   {% if 조건 %} {% elif %} {% else %} {% end %}
 *   {% for x in 목록 %} {% empty %} {% end %}   loop.index / first / last / length 제공
 *   {% include "partials/a.html" k=v %}        조각 삽입
 *   {% set 이름 = 값 %}                        지역 변수
 *   {# 주석 #}
 *
 * 컴파일 결과는 AST이며, render 시 재귀적으로 평가한다.
 */

const { formatDate } = require('./util');

class Safe { constructor(v) { this.value = String(v); } toString() { return this.value; } }
const safe = (v) => new Safe(v);

function escapeHtml(v) {
  if (v instanceof Safe) return v.value;
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ───────────────────────── 토크나이저 ───────────────────────── */

function tokenize(src) {
  const tokens = [];
  const re = /\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}|\{#[\s\S]*?#\}/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) tokens.push({ t: 'text', v: src.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ t: 'out', v: m[1].trim() });
    else if (m[2] !== undefined) tokens.push({ t: 'tag', v: m[2].trim() });
    last = re.lastIndex;
  }
  if (last < src.length) tokens.push({ t: 'text', v: src.slice(last) });
  return tokens;
}

/* ───────────────────────── 파서 (AST) ───────────────────────── */

function parse(src, name) {
  const tokens = tokenize(src);
  let i = 0;

  function block(stops) {
    const nodes = [];
    while (i < tokens.length) {
      const tk = tokens[i];
      if (tk.t === 'tag') {
        const kw = tk.v.split(/\s+/)[0];
        if (stops.includes(kw)) return nodes;
      }
      nodes.push(statement());
    }
    if (stops.length) throw new Error(`[${name}] {% ${stops[0]} %} 가 닫히지 않았습니다.`);
    return nodes;
  }

  function statement() {
    const tk = tokens[i++];
    if (tk.t === 'text') return { type: 'text', value: tk.v };
    if (tk.t === 'out') return { type: 'out', expr: parseFiltered(tk.v) };

    const src2 = tk.v;
    const kw = src2.split(/\s+/)[0];
    const rest = src2.slice(kw.length).trim();

    if (kw === 'if') {
      const branches = [{ cond: parseFiltered(rest), body: block(['elif', 'else', 'end']) }];
      let alt = [];
      for (;;) {
        const next = tokens[i];
        const nkw = next.v.split(/\s+/)[0];
        i++;
        if (nkw === 'elif') {
          branches.push({ cond: parseFiltered(next.v.slice(4).trim()), body: block(['elif', 'else', 'end']) });
        } else if (nkw === 'else') {
          alt = block(['end']); i++; break;
        } else break; // end
      }
      return { type: 'if', branches, alt };
    }

    if (kw === 'for') {
      const m = rest.match(/^([\w$]+)\s+in\s+([\s\S]+)$/);
      if (!m) throw new Error(`[${name}] for 문법 오류: ${rest}`);
      const body = block(['empty', 'end']);
      let alt = [];
      const next = tokens[i]; i++;
      if (next.v.split(/\s+/)[0] === 'empty') { alt = block(['end']); i++; }
      return { type: 'for', item: m[1], expr: parseFiltered(m[2]), body, alt };
    }

    if (kw === 'include') {
      const m = rest.match(/^["']([^"']+)["']\s*([\s\S]*)$/);
      if (!m) throw new Error(`[${name}] include 문법 오류: ${rest}`);
      const params = {};
      const pRe = /([\w$]+)\s*=\s*("[^"]*"|'[^']*'|[^,\s]+)/g;
      let pm;
      while ((pm = pRe.exec(m[2]))) params[pm[1]] = parseFiltered(pm[2]);
      return { type: 'include', path: m[1], params };
    }

    if (kw === 'set') {
      const m = rest.match(/^([\w$]+)\s*=\s*([\s\S]+)$/);
      if (!m) throw new Error(`[${name}] set 문법 오류: ${rest}`);
      return { type: 'set', name: m[1], expr: parseFiltered(m[2]) };
    }

    throw new Error(`[${name}] 알 수 없는 태그: {% ${src2} %}`);
  }

  return block([]);
}

/* ──────────────────── 표현식 + 필터 파서 ──────────────────── */

function splitPipes(src) {
  const parts = []; let buf = '', quote = null, depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === '|' && depth === 0 && src[i + 1] !== '|' && src[i - 1] !== '|') { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((s) => s.trim()).filter((s) => s !== '');
}

function parseFiltered(src) {
  const parts = splitPipes(src);
  const base = parseExpr(parts[0]);
  const filters = parts.slice(1).map((f) => {
    const idx = f.indexOf(':');
    if (idx === -1) return { name: f.trim(), args: [] };
    const name = f.slice(0, idx).trim();
    const args = splitArgs(f.slice(idx + 1)).map(parseExpr);
    return { name, args };
  });
  return { kind: 'filtered', base, filters };
}

function splitArgs(s) {
  const out = []; let buf = '', quote = null, depth = 0;
  for (const ch of s) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim() !== '') out.push(buf.trim());
  return out;
}

/** 재귀 하향 파서: or > and > not > 비교 > 단항 */
function parseExpr(src) {
  const s = String(src).trim();
  const or = splitOp(s, ['or']);
  if (or.length > 1) return { kind: 'or', parts: or.map(parseExpr) };
  const and = splitOp(s, ['and']);
  if (and.length > 1) return { kind: 'and', parts: and.map(parseExpr) };
  if (/^not\s+/.test(s)) return { kind: 'not', expr: parseExpr(s.slice(4)) };

  const cmp = splitOp(s, ['==', '!=', '>=', '<=', '>', '<', 'contains', 'in'], true);
  if (cmp) return { kind: 'cmp', op: cmp.op, left: parseExpr(cmp.left), right: parseExpr(cmp.right) };

  if (s.startsWith('(') && s.endsWith(')')) return parseExpr(s.slice(1, -1));
  return parseAtom(s);
}

/** 따옴표 밖에서만 연산자를 찾는다. */
function splitOp(s, ops, single) {
  const parts = [];
  let buf = '', quote = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;

    let hit = null;
    if (depth === 0) {
      for (const op of ops) {
        if (s.substr(i, op.length) !== op) continue;
        if (/^[a-z]+$/.test(op)) {
          const before = i === 0 ? ' ' : s[i - 1];
          const after = s[i + op.length] === undefined ? ' ' : s[i + op.length];
          if (!/\s/.test(before) || !/\s/.test(after)) continue;
        } else if ((op === '>' || op === '<') && s[i + 1] === '=') {
          continue;
        }
        hit = op; break;
      }
    }

    if (hit) {
      if (single) return { op: hit, left: buf, right: s.slice(i + hit.length) };
      parts.push(buf);
      buf = '';
      i += hit.length - 1;
      continue;
    }
    buf += ch;
  }
  if (single) return null;
  parts.push(buf);
  return parts;
}

function parseAtom(s) {
  const t = s.trim();
  if (t === '') return { kind: 'lit', value: '' };
  if (/^-?\d+$/.test(t)) return { kind: 'lit', value: parseInt(t, 10) };
  if (/^-?\d*\.\d+$/.test(t)) return { kind: 'lit', value: parseFloat(t) };
  if (t === 'true') return { kind: 'lit', value: true };
  if (t === 'false') return { kind: 'lit', value: false };
  if (t === 'null' || t === 'nil') return { kind: 'lit', value: null };
  if ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'"))) {
    return { kind: 'lit', value: t.slice(1, -1) };
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    return { kind: 'arr', items: splitArgs(t.slice(1, -1)).map(parseExpr) };
  }
  return { kind: 'path', path: t };
}

/* ───────────────────────── 평가기 ───────────────────────── */

function lookup(ctx, path) {
  const steps = String(path).match(/[^.[\]"']+|\["[^"]*"\]|\['[^']*'\]|\[\d+\]/g) || [];
  let cur = ctx;
  for (let raw of steps) {
    if (cur === undefined || cur === null) return undefined;
    let key = raw;
    if (raw.startsWith('[')) key = raw.slice(1, -1).replace(/^["']|["']$/g, '');
    if (key === 'size' || key === 'length') {
      if (Array.isArray(cur) || typeof cur === 'string') { cur = cur.length; continue; }
      if (cur && typeof cur === 'object') { cur = Object.keys(cur).length; continue; }
    }
    cur = cur[key];
  }
  return cur;
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v === undefined || v === null || v === false || v === '' || v === 0) return false;
  return true;
}

function evalExpr(node, ctx, engine) {
  switch (node.kind) {
    case 'filtered': {
      let v = evalExpr(node.base, ctx, engine);
      for (const f of node.filters) {
        const fn = engine.filters[f.name];
        if (!fn) throw new Error(`알 수 없는 필터: ${f.name}`);
        v = fn(v, ...f.args.map((a) => evalExpr(a, ctx, engine)));
      }
      return v;
    }
    case 'lit': return node.value;
    case 'arr': return node.items.map((n) => evalExpr(n, ctx, engine));
    case 'path': return lookup(ctx, node.path);
    case 'not': return !truthy(evalExpr(node.expr, ctx, engine));
    case 'and': return node.parts.every((p) => truthy(evalExpr(p, ctx, engine)));
    case 'or': return node.parts.some((p) => truthy(evalExpr(p, ctx, engine)));
    case 'cmp': {
      const a = evalExpr(node.left, ctx, engine);
      const b = evalExpr(node.right, ctx, engine);
      switch (node.op) {
        case '==': return a === b || String(a) === String(b);
        case '!=': return !(a === b || String(a) === String(b));
        case '>': return Number(a) > Number(b);
        case '<': return Number(a) < Number(b);
        case '>=': return Number(a) >= Number(b);
        case '<=': return Number(a) <= Number(b);
        case 'contains':
          if (Array.isArray(a)) return a.map(String).includes(String(b));
          return String(a == null ? '' : a).includes(String(b));
        case 'in':
          if (Array.isArray(b)) return b.map(String).includes(String(a));
          return String(b == null ? '' : b).includes(String(a));
      }
      return false;
    }
  }
  return '';
}

function renderNodes(nodes, ctx, engine) {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text': out += n.value; break;
      case 'out': {
        const v = evalExpr(n.expr, ctx, engine);
        if (v === undefined || v === null || v === false) break;
        out += escapeHtml(v);
        break;
      }
      case 'if': {
        let done = false;
        for (const b of n.branches) {
          if (truthy(evalExpr(b.cond, ctx, engine))) { out += renderNodes(b.body, ctx, engine); done = true; break; }
        }
        if (!done) out += renderNodes(n.alt, ctx, engine);
        break;
      }
      case 'for': {
        const raw = evalExpr(n.expr, ctx, engine);
        const list = Array.isArray(raw)
          ? raw
          : (raw && typeof raw === 'object' ? Object.keys(raw).map((k) => ({ key: k, value: raw[k] })) : []);
        if (!list.length) { out += renderNodes(n.alt, ctx, engine); break; }
        list.forEach((item, idx) => {
          const scope = Object.create(ctx);
          scope[n.item] = item;
          scope.loop = {
            index: idx + 1, index0: idx, first: idx === 0,
            last: idx === list.length - 1, length: list.length, odd: idx % 2 === 1,
          };
          out += renderNodes(n.body, scope, engine);
        });
        break;
      }
      case 'include': {
        const scope = Object.create(ctx);
        for (const k of Object.keys(n.params)) scope[k] = evalExpr(n.params[k], ctx, engine);
        out += engine.renderPartial(n.path, scope);
        break;
      }
      case 'set':
        ctx[n.name] = evalExpr(n.expr, ctx, engine);
        break;
    }
  }
  return out;
}

/* ───────────────────────── 기본 필터 ───────────────────────── */

const filters = {
  raw: (v) => safe(v == null ? '' : v),
  escape: (v) => escapeHtml(v),
  default: (v, d) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? d : v),
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
  capitalize: (v) => { const s = String(v ?? ''); return s.charAt(0).toUpperCase() + s.slice(1); },
  trim: (v) => String(v ?? '').trim(),
  size: (v) => (v == null ? 0 : (Array.isArray(v) || typeof v === 'string' ? v.length : Object.keys(v).length)),
  first: (v) => (Array.isArray(v) ? v[0] : String(v ?? '').charAt(0)),
  last: (v) => (Array.isArray(v) ? v[v.length - 1] : String(v ?? '').slice(-1)),
  join: (v, sep = ', ') => (Array.isArray(v) ? v.join(sep) : String(v ?? '')),
  split: (v, sep = ',') => String(v ?? '').split(sep),
  limit: (v, n) => (Array.isArray(v) ? v.slice(0, n) : v),
  offset: (v, n) => (Array.isArray(v) ? v.slice(n) : v),
  reverse: (v) => (Array.isArray(v) ? v.slice().reverse() : String(v ?? '').split('').reverse().join('')),
  sort: (v) => (Array.isArray(v) ? v.slice().sort((a, b) => String(a).localeCompare(String(b), 'ko')) : v),
  sort_by: (v, key) => (Array.isArray(v) ? v.slice().sort((a, b) => String(lookup(a, key)).localeCompare(String(lookup(b, key)), 'ko')) : v),
  where: (v, key, val) => (Array.isArray(v) ? v.filter((o) => String(lookup(o, key)) === String(val)) : v),
  reject: (v, key, val) => (Array.isArray(v) ? v.filter((o) => String(lookup(o, key)) !== String(val)) : v),
  map: (v, key) => (Array.isArray(v) ? v.map((o) => lookup(o, key)) : v),
  json: (v) => safe(JSON.stringify(v === undefined ? null : v)),
  date: (v, fmt = 'YYYY.MM.DD') => formatDate(v, fmt),
  number: (v) => Number(v || 0).toLocaleString('ko-KR'),
  plus: (v, n) => Number(v || 0) + Number(n || 0),
  minus: (v, n) => Number(v || 0) - Number(n || 0),
  times: (v, n) => Number(v || 0) * Number(n || 0),
  divided: (v, n) => Math.floor(Number(v || 0) / Number(n || 1)),
  replace: (v, a, b) => String(v ?? '').split(a).join(b),
  strip_html: (v) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  truncate: (v, n = 100, suffix = '…') => {
    const s = String(v ?? '');
    return s.length > n ? s.slice(0, n).trim() + suffix : s;
  },
  slugify: (v) => String(v ?? '').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-'),
  urlencode: (v) => encodeURIComponent(String(v ?? '')),
  keys: (v) => (v && typeof v === 'object' ? Object.keys(v) : []),
  values: (v) => (v && typeof v === 'object' ? Object.values(v) : []),
};

module.exports = { parse, renderNodes, evalExpr, filters, escapeHtml, safe, Safe, lookup, truthy };
