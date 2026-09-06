'use strict';
/**
 * Gaon Engine — front-matter parser
 * ---------------------------------
 * 문서 맨 앞의 `---` 블록을 직접 만든 YAML 서브셋 파서로 읽는다.
 * 외부 라이브러리를 쓰지 않기 위해 필요한 문법만 골라서 구현했다.
 *
 *   지원: 문자열 / 숫자 / 불리언 / null / 날짜문자열
 *         중첩 매핑(들여쓰기 2칸), 블록 시퀀스(- item),
 *         인라인 배열([a, b]), 인라인 객체({k: v}),
 *         따옴표 문자열, # 주석, 여러 줄 문자열(|, >)
 */

const DELIM = /^---\s*$/;

/** 원문에서 front-matter와 본문을 분리한다. */
function split(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (!DELIM.test(lines[0] || '')) return { data: {}, body: text };

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (DELIM.test(lines[i])) { end = i; break; }
  }
  if (end === -1) return { data: {}, body: text };

  return {
    data: parseYaml(lines.slice(1, end).join('\n')),
    body: lines.slice(end + 1).join('\n'),
  };
}

/** 들여쓰기 기반으로 줄을 트리로 만든 뒤 값으로 변환한다. */
function parseYaml(src) {
  const rows = [];
  for (const line of String(src).split('\n')) {
    if (!line.trim()) continue;
    if (/^\s*#/.test(line)) continue;
    rows.push({ indent: line.match(/^\s*/)[0].length, text: line.trim(), raw: line });
  }
  const [value] = buildBlock(rows, 0, 0);
  return value === undefined ? {} : value;
}

/** rows[start] 부터 indent 수준이 유지되는 동안을 하나의 블록으로 읽는다. */
function buildBlock(rows, start, indent) {
  if (start >= rows.length) return [undefined, start];
  const isSeq = rows[start].text.startsWith('- ') || rows[start].text === '-';
  return isSeq ? buildSeq(rows, start, indent) : buildMap(rows, start, indent);
}

function buildSeq(rows, i, indent) {
  const out = [];
  while (i < rows.length && rows[i].indent >= indent) {
    const row = rows[i];
    if (row.indent > indent) { i++; continue; }
    if (!row.text.startsWith('-')) break;

    const inline = row.text.slice(1).trim();
    i++;
    const childIndent = i < rows.length ? rows[i].indent : indent;

    if (inline === '') {
      // - 아래 줄에 내용이 이어지는 형태
      if (childIndent > indent) {
        const [val, next] = buildBlock(rows, i, childIndent);
        out.push(val); i = next;
      } else out.push(null);
    } else if (/^[\w".'-][^:]*:(\s|$)/.test(inline)) {
      // "- key: value" — 시퀀스 항목이 매핑인 경우
      const virtual = [{ indent: 0, text: inline }];
      let j = i;
      while (j < rows.length && rows[j].indent > indent) {
        virtual.push({ indent: rows[j].indent - (indent + 2), text: rows[j].text });
        j++;
      }
      const [val] = buildMap(virtual, 0, 0);
      out.push(val); i = j;
    } else {
      out.push(scalar(inline));
    }
  }
  return [out, i];
}

function buildMap(rows, i, indent) {
  const out = {};
  while (i < rows.length && rows[i].indent >= indent) {
    const row = rows[i];
    if (row.indent > indent) { i++; continue; }

    const m = row.text.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }

    const key = unquote(m[1].trim());
    const rest = stripComment(m[2]);
    i++;

    if (rest === '' || rest === '|' || rest === '>') {
      const childIndent = i < rows.length ? rows[i].indent : -1;
      if (childIndent > indent) {
        if (rest === '|' || rest === '>') {
          const buf = [];
          while (i < rows.length && rows[i].indent > indent) { buf.push(rows[i].text); i++; }
          out[key] = rest === '|' ? buf.join('\n') : buf.join(' ');
        } else {
          const [val, next] = buildBlock(rows, i, childIndent);
          out[key] = val; i = next;
        }
      } else {
        out[key] = null;
      }
    } else {
      out[key] = scalar(rest);
    }
  }
  return [out, i];
}

function stripComment(s) {
  let quote = null, out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { out += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) break;
    out += ch;
  }
  return out.trim();
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  return s;
}

/** 스칼라 문자열을 알맞은 JS 값으로 변환한다. */
function scalar(s) {
  const t = s.trim();
  if (t === '') return '';
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return unquote(t);
  if (t === 'true' || t === 'yes' || t === 'on') return true;
  if (t === 'false' || t === 'no' || t === 'off') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);

  if (t.startsWith('[') && t.endsWith(']')) {
    return splitTop(t.slice(1, -1)).map(scalar).filter((v) => v !== '');
  }
  if (t.startsWith('{') && t.endsWith('}')) {
    const obj = {};
    for (const part of splitTop(t.slice(1, -1))) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      obj[unquote(part.slice(0, idx).trim())] = scalar(part.slice(idx + 1));
    }
    return obj;
  }
  return t;
}

/** 괄호/따옴표 깊이를 지키면서 콤마로 자른다. */
function splitTop(s) {
  const out = []; let buf = '', depth = 0, quote = null;
  for (const ch of s) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

module.exports = { split, parseYaml };
