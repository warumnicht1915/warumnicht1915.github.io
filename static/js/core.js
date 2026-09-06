/* ============================================================
   core.js — 사이트 공통 동작
   테마 전환, 모바일 메뉴, 읽기 진행바, 맨 위로,
   코드 복사, 링크 복사, 목록 보기 전환
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* ── 테마 ─────────────────────────────────────────── */
  var themeBtn = $('#themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var now = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = now;
      try { localStorage.setItem('gaon.theme', now); } catch (e) {}
      document.dispatchEvent(new CustomEvent('gaon:theme', { detail: now }));
    });
  }

  /* ── 모바일 메뉴 ──────────────────────────────────── */
  var navBtn = $('#navBtn');
  var gnb = $('#gnb');
  var dim = $('#navDim');
  function closeNav() {
    if (!gnb) return;
    gnb.classList.remove('open');
    if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
    if (dim) dim.hidden = true;
  }
  if (navBtn && gnb) {
    navBtn.addEventListener('click', function () {
      var open = gnb.classList.toggle('open');
      navBtn.setAttribute('aria-expanded', String(open));
      if (dim) dim.hidden = !open;
    });
  }
  if (dim) dim.addEventListener('click', closeNav);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });

  /* ── 읽기 진행바 + 맨 위로 ────────────────────────── */
  var bar = $('#progress span');
  var toTop = $('#toTop');
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || 0;
      if (bar) {
        var h = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = (h > 0 ? Math.min(100, (y / h) * 100) : 0) + '%';
      }
      if (toTop) toTop.classList.toggle('show', y > 480);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── 코드 복사 ────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.code-copy');
    if (!btn) return;
    var block = btn.closest('.code-block');
    var code = block && block.querySelector('code');
    if (!code) return;
    copy(code.innerText).then(function (ok) {
      btn.textContent = ok ? '복사됨' : '실패';
      btn.classList.toggle('done', ok);
      setTimeout(function () { btn.textContent = '복사'; btn.classList.remove('done'); }, 1600);
    });
  });

  /* ── 링크 복사 ────────────────────────────────────── */
  var copyLink = $('#copyLink');
  if (copyLink) {
    copyLink.addEventListener('click', function () {
      copy(copyLink.dataset.url || location.href).then(function (ok) {
        var before = copyLink.innerHTML;
        copyLink.textContent = ok ? '복사했습니다' : '복사 실패';
        setTimeout(function () { copyLink.innerHTML = before; }, 1600);
      });
    });
  }

  /** 클립보드 API가 막힌 환경(비 HTTPS 등)에서도 동작하도록 대비한다. */
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ── 카드형 · 목록형 전환 ─────────────────────────── */
  var grid = document.getElementById('postGrid');
  var toggles = $$('.vtoggle button');
  if (grid && toggles.length) {
    var saved = 'grid';
    try { saved = localStorage.getItem('gaon.view') || 'grid'; } catch (e) {}
    apply(saved);
    toggles.forEach(function (b) {
      b.addEventListener('click', function () {
        apply(b.dataset.view);
        try { localStorage.setItem('gaon.view', b.dataset.view); } catch (e) {}
      });
    });
  }
  function apply(view) {
    grid.classList.toggle('rows', view === 'rows');
    toggles.forEach(function (b) { b.classList.toggle('on', b.dataset.view === view); });
  }

  /* 다른 스크립트에서 쓸 수 있게 최소한만 공개한다 */
  window.Gaon = { $: $, $$: $$, copy: copy };
})();
