/* ============================================================
   widgets.js — 사이드바 위젯 구동
   인기 검색어 · 접속자 · 조회수 · 인기 글 · 댓글(giscus) 마운트
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.GAON_CONFIG || {};
  var Store = window.GaonStore;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var fmt = function (n) { return Number(n || 0).toLocaleString('ko-KR'); };

  if (!Store) return;

  /* ── 1. 인기 검색어 ───────────────────────────────── */
  var trendList = $('#trendList');
  var trendStamp = $('#trendStamp');
  var trendChips = $('#trendChips');

  function paintTrends() {
    Store.getTrends((CFG.trends && CFG.trends.size) || 10).then(function (list) {
      if (trendList) {
        trendList.innerHTML = list.map(function (t) {
          return '<li><button type="button" data-kw="' + esc(t.kw) + '">' +
            '<span class="no">' + t.rank + '</span>' +
            '<span class="kw">' + esc(t.kw) + '</span>' +
            '<span class="dt ' + t.delta + '">' + t.deltaText + '</span>' +
            '</button></li>';
        }).join('');
      }
      if (trendChips) {
        trendChips.innerHTML = list.map(function (t) {
          return '<button type="button" data-kw="' + esc(t.kw) + '">' + t.rank + '. ' + esc(t.kw) + '</button>';
        }).join('');
      }
      if (trendStamp) {
        var d = new Date();
        trendStamp.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' 기준';
      }
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  if (trendList || trendChips) {
    paintTrends();
    Store.onTrendsChange(paintTrends);
    setInterval(paintTrends, 60000);

    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-kw]');
      if (!b) return;
      var kw = b.dataset.kw;
      var input = $('#searchInput');
      if (input) {
        input.value = kw;
        input.form && input.form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        location.href = (CFG.baseurl || '') + '/search/?q=' + encodeURIComponent(kw);
      }
    });
  }

  /* 검색 폼이 제출될 때마다 검색어를 집계에 반영한다 */
  $$('form[role="search"]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var input = form.querySelector('input[type="search"]');
      if (input && input.value.trim()) Store.bumpTrend(input.value);
    });
  });

  /* ── 2. 접속자 · 방문자 수 ────────────────────────── */
  var online = $('#onlineCount');
  var chatOnline = $('#chatOnline');
  if (online || chatOnline) {
    Store.watchPresence(function (n) {
      if (online) online.textContent = fmt(n);
      if (chatOnline) chatOnline.textContent = fmt(n);
    });
  }

  var vToday = $('#vToday');
  if (vToday) {
    Store.visitors().then(function (v) {
      vToday.textContent = fmt(v.today);
      var y = $('#vYest'), t = $('#vTotal'), note = $('#vNote'), foot = $('#footVisitors');
      if (y) y.textContent = fmt(v.yesterday);
      if (t) t.textContent = fmt(v.total);
      if (foot) foot.textContent = '오늘 ' + fmt(v.today) + ' · 전체 ' + fmt(v.total);
      if (note) {
        note.textContent = v.shared
          ? '모든 방문자가 함께 보는 실제 집계입니다.'
          : '실시간 DB가 설정되지 않아 이 브라우저 기준으로만 셉니다.';
      }
    });
  }

  /* ── 3. 조회수 표시 ───────────────────────────────── */
  var viewNodes = $$('[data-views]');
  if (viewNodes.length) {
    var urls = viewNodes.map(function (n) { return n.dataset.views; })
      .filter(function (v, i, a) { return v && a.indexOf(v) === i; });

    Store.getViews(urls).then(function (map) {
      viewNodes.forEach(function (n) {
        var v = map[n.dataset.views] || 0;
        var target = n.querySelector('b') || n;
        target.textContent = fmt(v);
      });
      sortPopular(map);
    });
  }

  /** 인기 글 위젯을 실제 조회수 순으로 다시 정렬한다. */
  function sortPopular(map) {
    var list = $('#popularList');
    if (!list) return;
    var items = $$('li', list);
    if (items.length < 2) return;

    var hasData = items.some(function (li) { return (map[li.dataset.url] || 0) > 0; });
    if (!hasData) { renumber(items); return; }

    items.sort(function (a, b) {
      return (map[b.dataset.url] || 0) - (map[a.dataset.url] || 0);
    });
    items.forEach(function (li) { list.appendChild(li); });
    renumber(items);
  }
  function renumber(items) {
    items.forEach(function (li, i) {
      var rk = li.querySelector('.rk');
      if (rk) rk.textContent = i + 1;
    });
  }

  /* ── 4. 댓글(giscus) ──────────────────────────────── */
  var mount = $('#giscusMount');
  if (mount) {
    var g = (CFG.comments && CFG.comments.giscus) || {};
    var ready = CFG.comments && CFG.comments.provider === 'giscus' && g.repoId && g.categoryId;

    if (!ready) {
      var fb = $('#commentsFallback');
      if (fb) fb.hidden = false;
    } else {
      var theme = function () {
        return document.documentElement.dataset.theme === 'dark' ? 'dark_dimmed' : 'light';
      };
      var s = document.createElement('script');
      s.src = 'https://giscus.app/client.js';
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.setAttribute('data-repo', g.repo);
      s.setAttribute('data-repo-id', g.repoId);
      s.setAttribute('data-category', g.category);
      s.setAttribute('data-category-id', g.categoryId);
      s.setAttribute('data-mapping', g.mapping || 'pathname');
      s.setAttribute('data-strict', '0');
      s.setAttribute('data-reactions-enabled', g.reactionsEnabled || '1');
      s.setAttribute('data-emit-metadata', '0');
      s.setAttribute('data-input-position', g.inputPosition || 'top');
      s.setAttribute('data-theme', theme());
      s.setAttribute('data-lang', g.lang || 'ko');
      s.setAttribute('data-loading', 'lazy');
      mount.appendChild(s);

      // 다크모드를 켜고 끌 때 댓글창 테마도 따라가게 한다
      document.addEventListener('gaon:theme', function () {
        var frame = document.querySelector('iframe.giscus-frame');
        if (!frame) return;
        frame.contentWindow.postMessage(
          { giscus: { setConfig: { theme: theme() } } }, 'https://giscus.app');
      });
    }
  }
})();
