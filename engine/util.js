'use strict';
/**
 * Gaon Engine — 공용 유틸리티
 * 날짜 포맷, 슬러그, 파일 입출력 헬퍼를 직접 구현한다.
 */
const fs = require('fs');
const path = require('path');

const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-09-01 10:00' 같은 문자열도 로컬 시간으로 안전하게 해석한다. */
function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const s = String(v || '').trim();
  if (!s) return new Date(NaN);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  return new Date(s);
}

/** 직접 만든 날짜 포맷터. YYYY MM DD HH mm ss / M D H / ddd 를 지원한다. */
function formatDate(v, fmt = 'YYYY.MM.DD') {
  const d = toDate(v);
  if (isNaN(d)) return '';
  const p2 = (n) => String(n).padStart(2, '0');
  const map = {
    YYYY: d.getFullYear(), YY: p2(d.getFullYear() % 100),
    MM: p2(d.getMonth() + 1), M: d.getMonth() + 1,
    DD: p2(d.getDate()), D: d.getDate(),
    HH: p2(d.getHours()), H: d.getHours(),
    mm: p2(d.getMinutes()), ss: p2(d.getSeconds()),
    ddd: WEEK_KO[d.getDay()],
  };
  return String(fmt).replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|ss|ddd/g, (k) => map[k]);
}

function isoDate(v) {
  const d = toDate(v);
  return isNaN(d) ? '' : d.toISOString();
}

/** 한글을 살리는 슬러그. 파일명·앵커 양쪽에서 쓴다. */
function slugify(s) {
  return String(s || '')
    .trim().toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s, n, suffix = '…') {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n).trim() + suffix : t;
}

/** 한국어는 공백 기준 단어 수가 부정확해서 글자 수로 읽는 시간을 잡는다. */
function readingMinutes(html) {
  const chars = stripHtml(html).replace(/\s/g, '').length;
  return Math.max(1, Math.round(chars / 500));
}

function walk(dir, filter) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (!filter || filter(full)) out.push(full);
  }
  return out;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function writeFile(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) n += copyDir(from, to);
    else { ensureDir(path.dirname(to)); fs.copyFileSync(from, to); n++; }
  }
  return n;
}

function rmDir(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

function xmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = {
  toDate, formatDate, isoDate, slugify, stripHtml, truncate, readingMinutes,
  walk, ensureDir, writeFile, copyDir, rmDir, xmlEscape,
};
