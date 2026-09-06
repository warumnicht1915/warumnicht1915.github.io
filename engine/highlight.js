'use strict';
/**
 * Gaon Engine — 코드 문법 하이라이터
 * ----------------------------------
 * 외부 하이라이터를 쓰지 않고, 언어별 규칙(스티키 정규식)을 앞에서부터
 * 가장 먼저 매칭되는 순서로 소비하는 단순 스캐너를 직접 구현했다.
 * 출력 토큰 클래스: tok-com, tok-str, tok-num, tok-key, tok-fn,
 *                  tok-typ, tok-var, tok-op, tok-tag, tok-atr, tok-pun
 */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const R = (src, flags = '') => new RegExp(src, flags + 'y');

const WS = ['', R('\\s+')];
const NUM = ['num', R('0[xXbBoO][0-9a-fA-F_]+n?|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?n?')];
const PUN = ['pun', R('[{}()\\[\\];,.]')];
const OP = ['op', R('[+\\-*/%=<>!&|^~?:@]+')];

function kw(words) { return R('\\b(?:' + words.join('|') + ')\\b'); }

const JS_KEY = ['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','class','extends','super','this','typeof','instanceof','in','of','try','catch','finally','throw','async','await','yield','import','from','export','default','delete','void','static','get','set','as','null','undefined','true','false'];
const PY_KEY = ['def','class','return','if','elif','else','for','while','break','continue','import','from','as','with','try','except','finally','raise','lambda','yield','pass','global','nonlocal','assert','del','in','is','not','and','or','None','True','False','async','await','match','case'];
const SH_KEY = ['if','then','else','elif','fi','for','while','do','done','case','esac','function','return','export','local','source','echo','cd','set','unset','read','shift','exit','trap'];
const SQL_KEY = ['SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','ALTER','DROP','JOIN','LEFT','RIGHT','INNER','OUTER','ON','GROUP','BY','ORDER','LIMIT','OFFSET','HAVING','AS','AND','OR','NOT','NULL','PRIMARY','KEY','INDEX','DISTINCT','COUNT','SUM','AVG','CASE','WHEN','THEN','END'];
const JAVA_KEY = ['public','private','protected','class','interface','extends','implements','static','final','void','new','return','if','else','for','while','switch','case','break','continue','try','catch','finally','throw','throws','import','package','this','super','abstract','enum','record','var','null','true','false','int','long','double','float','boolean','char','String'];
const GO_KEY = ['package','import','func','return','if','else','for','range','switch','case','default','break','continue','type','struct','interface','map','chan','go','defer','var','const','nil','true','false','error','string','int','int64','float64','bool'];

const STR_DQ = ['str', R('"(?:\\\\.|[^"\\\\\\n])*"')];
const STR_SQ = ['str', R("'(?:\\\\.|[^'\\\\\\n])*'")];
const STR_BT = ['str', R('`(?:\\\\.|[^`\\\\])*`')];
const COM_LINE = ['com', R('//[^\\n]*')];
const COM_BLOCK = ['com', R('/\\*[\\s\\S]*?\\*/')];
const COM_HASH = ['com', R('#[^\\n]*')];

const LANGS = {
  javascript: [
    WS, COM_BLOCK, COM_LINE, STR_BT, STR_DQ, STR_SQ,
    ['str', R('/(?![*/])(?:\\\\.|\\[(?:\\\\.|[^\\]\\\\])*\\]|[^/\\\\\\n])+/[gimsuy]*(?=\\s*[;,).\\]}]|\\s*$)')],
    NUM,
    ['key', kw(JS_KEY)],
    ['fn', R('[A-Za-z_$][\\w$]*(?=\\s*\\()')],
    ['typ', R('\\b[A-Z][\\w$]*\\b')],
    ['var', R('[A-Za-z_$][\\w$]*')],
    PUN, OP,
  ],
  python: [
    WS, ['str', R('(?:[rRbBfFuU]{0,2})("""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\')')],
    COM_HASH,
    ['str', R('(?:[rRbBfFuU]{0,2})(?:"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')')],
    NUM,
    ['key', kw(PY_KEY)],
    ['fn', R('[A-Za-z_][\\w]*(?=\\s*\\()')],
    ['typ', R('@[A-Za-z_][\\w.]*')],
    ['var', R('[A-Za-z_][\\w]*')],
    PUN, OP,
  ],
  bash: [
    WS, COM_HASH, STR_DQ, STR_SQ,
    ['var', R('\\$\\{[^}]*\\}|\\$[A-Za-z_][\\w]*|\\$[0-9@*#?]')],
    NUM,
    ['key', kw(SH_KEY)],
    ['atr', R('(?:^|\\s)--?[A-Za-z][\\w-]*')],
    ['fn', R('[A-Za-z_][\\w.-]*(?=\\s)')],
    PUN, OP,
  ],
  html: [
    WS, ['com', R('<!--[\\s\\S]*?-->')],
    ['tag', R('<!?/?[A-Za-z][\\w:-]*')],
    ['str', R('"(?:[^"]*)"|\'(?:[^\']*)\'')],
    ['atr', R('[A-Za-z_:][\\w:.-]*(?=\\s*=)')],
    ['tag', R('/?>')],
    ['op', R('=')],
    ['var', R('[^<>="\'\\s]+')],
  ],
  css: [
    WS, COM_BLOCK,
    ['str', R('"(?:[^"]*)"|\'(?:[^\']*)\'')],
    ['atr', R('--[\\w-]+|[-a-zA-Z]+(?=\\s*:)')],
    ['num', R('#[0-9a-fA-F]{3,8}\\b|\\d[\\d.]*(?:px|rem|em|%|vh|vw|s|ms|deg|fr|ch)?')],
    ['key', R('@[a-zA-Z-]+')],
    ['fn', R('[a-zA-Z-]+(?=\\()')],
    ['typ', R('[.#][\\w-]+|:{1,2}[a-z-]+')],
    ['var', R('[A-Za-z-]+')],
    PUN, OP,
  ],
  json: [
    WS, ['atr', R('"(?:\\\\.|[^"\\\\])*"(?=\\s*:)')],
    ['str', R('"(?:\\\\.|[^"\\\\])*"')],
    NUM, ['key', kw(['true', 'false', 'null'])], PUN, OP,
  ],
  yaml: [
    WS, COM_HASH,
    ['atr', R('^[ \\t]*[-\\w.$][\\w.$ -]*(?=\\s*:)', 'm')],
    ['str', R('"(?:[^"]*)"|\'(?:[^\']*)\'')],
    NUM, ['key', kw(['true', 'false', 'null', 'yes', 'no', 'on', 'off'])],
    ['op', R('[-:>|]')],
    ['var', R('[^\\s:#]+')],
  ],
  sql: [
    WS, ['com', R('--[^\\n]*')], COM_BLOCK, STR_SQ, STR_DQ, NUM,
    ['key', R('\\b(?:' + SQL_KEY.join('|') + ')\\b', 'i')],
    ['fn', R('[A-Za-z_][\\w]*(?=\\s*\\()')],
    ['var', R('[A-Za-z_][\\w.]*')], PUN, OP,
  ],
  java: [
    WS, COM_BLOCK, COM_LINE, STR_DQ, STR_SQ, NUM,
    ['key', kw(JAVA_KEY)],
    ['typ', R('@?\\b[A-Z][\\w$]*\\b')],
    ['fn', R('[A-Za-z_$][\\w$]*(?=\\s*\\()')],
    ['var', R('[A-Za-z_$][\\w$]*')], PUN, OP,
  ],
  go: [
    WS, COM_BLOCK, COM_LINE, STR_BT, STR_DQ, STR_SQ, NUM,
    ['key', kw(GO_KEY)],
    ['fn', R('[A-Za-z_][\\w]*(?=\\s*\\()')],
    ['typ', R('\\b[A-Z][\\w]*\\b')],
    ['var', R('[A-Za-z_][\\w]*')], PUN, OP,
  ],
  markdown: [
    WS, ['key', R('^#{1,6} [^\\n]*', 'm')],
    ['str', R('`[^`\\n]+`')],
    ['fn', R('\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__')],
    ['atr', R('\\[[^\\]\\n]*\\]\\([^)\\n]*\\)')],
    ['com', R('^>[^\\n]*', 'm')],
    ['op', R('^[-*+] |^\\d+\\. ', 'm')],
    ['var', R('[^\\s`*\\[>#-]+')],
  ],
  plain: [WS, ['', R('[\\s\\S]')]],
};

const ALIAS = {
  js: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  py: 'python', py3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
  htm: 'html', xml: 'html', vue: 'html', svg: 'html',
  scss: 'css', sass: 'css', less: 'css',
  yml: 'yaml', md: 'markdown', jsonc: 'json',
  c: 'java', cpp: 'java', 'c++': 'java', cs: 'java', kotlin: 'java', kt: 'java',
  rb: 'python', ruby: 'python', rust: 'go', rs: 'go', php: 'javascript',
  gaon: 'html',
};

function normalize(lang) {
  const l = String(lang || '').trim().toLowerCase();
  return LANGS[l] ? l : (ALIAS[l] || 'plain');
}

/** 코드 문자열을 하이라이트된 HTML로 바꾼다. */
function highlight(code, lang) {
  const rules = LANGS[normalize(lang)];
  const src = String(code);
  let out = '', i = 0, guard = 0;

  while (i < src.length && guard++ < 400000) {
    let hit = false;
    for (const [type, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (!m || m.index !== i || !m[0].length) continue;
      out += type ? `<span class="tok-${type}">${esc(m[0])}</span>` : esc(m[0]);
      i += m[0].length;
      hit = true;
      break;
    }
    if (!hit) { out += esc(src[i]); i++; }
  }
  if (i < src.length) out += esc(src.slice(i));
  return out;
}

module.exports = { highlight, normalize, escapeCode: esc };
