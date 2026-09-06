/* ============================================================
   search.js — 검색 페이지
   빌드 시 만들어 둔 search-index.json 을 받아 클라이언트에서 찾는다.
   제목 > 태그/카테고리 > 본문 순으로 가중치를 준다.
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.GAON_CONFIG || {};
  var base = CFG.baseurl || '';
  var form = document.getElementById('searchForm');
  var input = document.getElementById('searchInput');
  var status = document.getElementById('searchStatus');
  var results = document.getElementById('searchResults');
  if (!form || !input) return;

  var index = null;
  var loading = null;

  function load() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    loading = fetch(base + '/search-index.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (data) { index = data; return index; })
      .catch(function () { index = []; return index; });
    return loading;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** 검색어 각 토큰이 모두 들어간 글만 남기고 점수를 매긴다. */
  function search(query) {
    var terms = query.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 0; });
    if (!terms.length) return [];

    return index.map(function (p) {
      var title = (p.t || '').toLowerCase();
      var tags = ((p.g || []).join(' ') + ' ' + (p.c || '')).toLowerCase();
      var body = ((p.e || '') + ' ' + (p.b || '')).toLowerCase();
      var score = 0;

      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        var hit = 0;
        if (title.indexOf(t) !== -1) { score += title.indexOf(t) === 0 ? 14 : 10; hit = 1; }
        if (tags.indexOf(t) !== -1) { score += 6; hit = 1; }
        if (body.indexOf(t) !== -1) { score += 2; hit = 1; }
        if (!hit) return null;
      }
      return { post: p, score: score };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; });
  }

  /** 본문에서 검색어 주변을 잘라내고 형광펜을 칠한다. */
  function snippet(post, terms) {
    var body = post.b || post.e || '';
    var low = body.toLowerCase();
    var at = -1;
    for (var i = 0; i < terms.length && at === -1; i++) at = low.indexOf(terms[i]);
    if (at === -1) return esc(post.e || '');

    var start = Math.max(0, at - 50);
    var text = (start > 0 ? '…' : '') + body.slice(start, start + 170) + '…';
    var html = esc(text);
    terms.forEach(function (t) {
      html = html.replace(new RegExp('(' + escRe(esc(t)) + ')', 'gi'), '<mark class="hl">$1</mark>');
    });
    return html;
  }

  function highlight(text, terms) {
    var html = esc(text);
    terms.forEach(function (t) {
      html = html.replace(new RegExp('(' + escRe(esc(t)) + ')', 'gi'), '<mark class="hl">$1</mark>');
    });
    return html;
  }

  function render(query) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    var hits = search(query);

    status.innerHTML = hits.length
      ? '<b>' + esc(query) + '</b> 검색 결과 <b>' + hits.length + '</b>건'
      : '<b>' + esc(query) + '</b> 에 대한 결과가 없습니다. 다른 낱말로 찾아보세요.';

    results.innerHTML = hits.map(function (h) {
      var p = h.post;
      return '<article class="card"><a class="card-a" href="' + p.u + '">' +
        '<div class="card-body">' +
        '<span class="badge">' + esc(p.c) + '</span>' +
        '<h3 class="card-title">' + highlight(p.t, terms) + '</h3>' +
        '<p class="card-desc">' + snippet(p, terms) + '</p>' +
        '<div class="card-meta"><time>' + esc(p.d) + '</time>' +
        (p.g && p.g.length ? '<span>#' + esc(p.g.join(' #')) + '</span>' : '') +
        '</div></div></a></article>';
    }).join('');
  }

  function run(query) {
    query = String(query || '').trim();
    if (!query) {
      status.textContent = '검색어를 입력해 보세요.';
      results.innerHTML = '';
      return;
    }
    status.textContent = '찾는 중…';
    load().then(function () { render(query); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (q && window.GaonStore) window.GaonStore.bumpTrend(q);
    var url = location.pathname + (q ? '?q=' + encodeURIComponent(q) : '');
    history.replaceState(null, '', url);
    run(q);
  });

  /* 입력 중에도 바로 결과를 보여준다 (디바운스) */
  var timer = null;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { run(input.value); }, 220);
  });

  var initial = new URLSearchParams(location.search).get('q') || '';
  if (initial) { input.value = initial; run(initial); }
  input.focus();
})();
