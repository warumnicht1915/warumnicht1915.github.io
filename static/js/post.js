/* ============================================================
   post.js — 글 상세 전용
   목차 현재 위치 표시, 조회수 집계, 이미지 확대
   ============================================================ */
(function () {
  'use strict';

  var Store = window.GaonStore;

  /* ── 조회수 1 올리기 ──────────────────────────────── */
  if (Store) {
    var node = document.querySelector('.pmeta [data-views]');
    var url = node && node.dataset.views;
    if (url) {
      Store.countView(url).then(function (n) {
        if (typeof n === 'number' && node.querySelector('b')) {
          node.querySelector('b').textContent = Number(n).toLocaleString('ko-KR');
        }
      });
    }
  }

  /* ── 목차 스크롤 추적 ─────────────────────────────── */
  var toc = document.getElementById('toc');
  if (toc && 'IntersectionObserver' in window) {
    var links = {};
    Array.prototype.forEach.call(toc.querySelectorAll('a'), function (a) {
      links[decodeURIComponent(a.getAttribute('href').slice(1))] = a.parentElement;
    });

    var heads = Array.prototype.filter.call(
      document.querySelectorAll('#postBody .md-h2, #postBody .md-h3'),
      function (h) { return links[h.id]; });

    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      var current = null;
      for (var i = 0; i < heads.length; i++) {
        if (visible[heads[i].id]) { current = heads[i].id; break; }
      }
      if (!current) {
        // 화면에 걸친 제목이 없으면 가장 최근에 지나친 것을 고른다
        var y = window.scrollY + 120;
        heads.forEach(function (h) { if (h.offsetTop <= y) current = h.id; });
      }
      Object.keys(links).forEach(function (id) {
        links[id].classList.toggle('on', id === current);
      });
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

    heads.forEach(function (h) { io.observe(h); });
  }

  /* ── 본문 이미지 클릭하면 크게 보기 ──────────────── */
  var body = document.getElementById('postBody');
  if (body) {
    body.addEventListener('click', function (e) {
      var img = e.target.closest && e.target.closest('.md-figure img');
      if (!img) return;
      var box = document.createElement('div');
      box.style.cssText =
        'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.86);' +
        'display:grid;place-items:center;padding:24px;cursor:zoom-out';
      var big = new Image();
      big.src = img.currentSrc || img.src;
      big.alt = img.alt;
      big.style.cssText = 'max-width:100%;max-height:100%;border-radius:10px';
      box.appendChild(big);
      box.addEventListener('click', function () { box.remove(); });
      document.addEventListener('keydown', function esc(ev) {
        if (ev.key === 'Escape') { box.remove(); document.removeEventListener('keydown', esc); }
      });
      document.body.appendChild(box);
    });
  }
})();
