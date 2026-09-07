/* ============================================================
   owner.js — 블로그 화면 안의 글쓰기 · 수정 · 삭제
   ------------------------------------------------------------
   관리자 토큰이 이 브라우저에 저장돼 있을 때만 동작한다.
   방문자에게는 아무것도 보이지 않고, 아무 요청도 나가지 않는다.

     · 오른쪽 아래 연필 버튼  → 새 글 쓰기
     · 글 상세의 수정 / 삭제 버튼
     · 목록 카드 위의 수정 / 삭제 버튼
   ============================================================ */
(function () {
  'use strict';

  var GH = window.GaonGH;
  var CFG = window.GAON_CONFIG || {};
  var base = CFG.baseurl || '';
  if (!GH || !GH.repo) return;
  if (!GH.getToken()) return;   // 방문자에게는 존재하지 않는 기능

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  document.body.classList.add('is-owner');

  /* ── 토스트 ────────────────────────────────────────── */
  var toast = document.createElement('div');
  toast.className = 'ow-toast';
  toast.hidden = true;
  document.body.appendChild(toast);
  var toastTimer = null;
  function say(text, kind) {
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.className = 'ow-toast ' + (kind || 'info');
    toast.hidden = false;
    if (kind !== 'busy') toastTimer = setTimeout(function () { toast.hidden = true; }, 4500);
  }

  /* ── 확인창 ────────────────────────────────────────── */
  function confirmBox(title, text, danger) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'ad-modal';
      wrap.innerHTML =
        '<div class="ad-modal-box" role="dialog" aria-modal="true">' +
        '<b></b><p></p><div class="ad-modal-btns">' +
        '<button type="button" class="btn-line" data-no>취소</button>' +
        '<button type="button" class="btn ' + (danger ? 'ad-danger' : 'ad-primary') + '" data-yes>' +
        (danger ? '삭제' : '확인') + '</button></div></div>';
      wrap.querySelector('b').textContent = title;
      wrap.querySelector('p').textContent = text;
      document.body.appendChild(wrap);
      var done = function (v) { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-yes]').onclick = function () { done(true); };
      wrap.querySelector('[data-no]').onclick = function () { done(false); };
      wrap.onclick = function (e) { if (e.target === wrap) done(false); };
    });
  }

  /* ── 공통 동작 ─────────────────────────────────────── */
  /* 편집기는 페이지를 옮기지 않고 이 화면 위에 큰 창으로 띄운다.
     (editor-modal.js 가 없으면 예전처럼 /write/ 로 이동한다) */
  function goEdit(srcPath) {
    if (window.GaonEditor) return window.GaonEditor.open(srcPath, afterPublish);
    location.href = base + '/write/?edit=' + encodeURIComponent(srcPath);
  }
  function goNew() {
    if (window.GaonEditor) return window.GaonEditor.open(null, afterPublish);
    location.href = base + '/write/';
  }
  function afterPublish() {
    say('발행했습니다. 1~2분 뒤 사이트에 반영됩니다.', 'ok');
  }

  function removePost(srcPath, title, afterUrl) {
    confirmBox('이 글을 삭제할까요?',
      '“' + title + '” 이 블로그에서 내려갑니다. GitHub 커밋 이력에는 남아서 나중에 되살릴 수 있습니다.',
      true).then(function (yes) {
      if (!yes) return;
      say('삭제하는 중…', 'busy');
      GH.getFile(srcPath)
        .then(function (f) { return GH.deleteFile(srcPath, f.sha, '글 삭제: ' + title); })
        .then(function () {
          say('삭제했습니다. 1~2분 뒤 사이트에 반영됩니다.', 'ok');
          if (afterUrl) setTimeout(function () { location.href = base + afterUrl; }, 1600);
          else setTimeout(function () { location.reload(); }, 1600);
        })
        .catch(function (e) { say(e.message, 'error'); });
    });
  }

  /* ── 1. 떠 있는 글쓰기 버튼 ────────────────────────── */
  var fab = document.createElement('div');
  fab.className = 'ow-fab';
  fab.innerHTML =
    '<button type="button" class="ow-write" title="새 글 쓰기" aria-label="새 글 쓰기">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/>' +
      '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
      '<span>새 글</span></button>' +
    '<a class="ow-panel" href="' + base + '/admin/" title="관리자 페이지">관리</a>';
  document.body.appendChild(fab);
  fab.querySelector('.ow-write').addEventListener('click', goNew);

  /* ── 2. 글 상세의 수정 · 삭제 ──────────────────────── */
  var article = $('.paper.post[data-src]');
  var slot = $('[data-owner-post]');
  if (article && slot) {
    var srcPath = article.dataset.src;
    var title = (($('.paper-h h1') || {}).textContent || '이 글').trim();
    slot.innerHTML =
      '<button type="button" class="ow-mini" data-ow-edit>수정</button>' +
      '<button type="button" class="ow-mini danger" data-ow-del>삭제</button>';
    slot.querySelector('[data-ow-edit]').addEventListener('click', function () { goEdit(srcPath); });
    slot.querySelector('[data-ow-del]').addEventListener('click', function () {
      removePost(srcPath, title, '/');
    });
  }

  /* ── 3. 목록 카드 위의 수정 · 삭제 ─────────────────── */
  $$('.card[data-src]').forEach(function (card) {
    if (!card.dataset.src) return;
    var bar = document.createElement('div');
    bar.className = 'ow-cardbar';
    bar.innerHTML =
      '<button type="button" class="ow-mini" data-ow-edit>수정</button>' +
      '<button type="button" class="ow-mini danger" data-ow-del>삭제</button>';
    card.appendChild(bar);

    var name = (card.querySelector('.card-title') || {}).textContent || '이 글';
    bar.querySelector('[data-ow-edit]').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      goEdit(card.dataset.src);
    });
    bar.querySelector('[data-ow-del]').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      removePost(card.dataset.src, name.trim(), null);
    });
  });

  /* ── 4. 토큰이 아직 살아 있는지 조용히 확인 ────────── */
  GH.me().catch(function () {
    GH.clearToken();
    document.body.classList.remove('is-owner');
    fab.remove();
    say('관리자 토큰이 만료됐습니다. 관리자 페이지에서 다시 연결해 주세요.', 'error');
  });
})();
