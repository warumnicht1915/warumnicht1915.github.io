'use strict';
/**
 * Gaon Engine — 렌더러
 * 템플릿 파일을 읽어 AST로 캐시하고, 레이아웃 상속을 처리한다.
 *   templates/layouts/*.html   : 페이지 껍데기 (front-matter 의 layout 으로 체이닝)
 *   templates/partials/**.html : {% include %} 대상
 */
const fs = require('fs');
const path = require('path');
const tpl = require('./template');
const fm = require('./frontmatter');

class Renderer {
  constructor(root, extraFilters = {}) {
    this.root = root;
    this.cache = new Map();
    this.filters = Object.assign({}, tpl.filters, extraFilters);
  }

  load(rel) {
    if (this.cache.has(rel)) return this.cache.get(rel);
    const file = path.join(this.root, rel);
    if (!fs.existsSync(file)) throw new Error(`템플릿을 찾을 수 없습니다: ${rel}`);
    const raw = fs.readFileSync(file, 'utf8');
    const { data, body } = fm.split(raw);
    const entry = { meta: data, ast: tpl.parse(body, rel) };
    this.cache.set(rel, entry);
    return entry;
  }

  renderPartial(rel, ctx) {
    const entry = this.load(path.posix.join('partials', rel.replace(/^partials\//, '')));
    return tpl.renderNodes(entry.ast, ctx, this);
  }

  /** 문자열 템플릿을 즉석에서 렌더링 */
  renderString(src, ctx, name = '(inline)') {
    return tpl.renderNodes(tpl.parse(src, name), ctx, this);
  }

  /** 레이아웃 체인을 따라가며 최종 HTML을 만든다. */
  renderLayout(layoutName, ctx, innerHtml) {
    let content = innerHtml;
    let name = layoutName;
    const guard = new Set();

    while (name) {
      if (guard.has(name)) throw new Error(`레이아웃 순환 참조: ${name}`);
      guard.add(name);
      const entry = this.load(path.posix.join('layouts', `${name}.html`));
      const scope = Object.create(ctx);
      scope.content = new tpl.Safe(content);
      content = tpl.renderNodes(entry.ast, scope, this);
      name = entry.meta.layout || null;
    }
    return content;
  }
}

module.exports = { Renderer };
